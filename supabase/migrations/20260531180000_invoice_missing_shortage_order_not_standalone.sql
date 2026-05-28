-- „Prosledi u nabavku“ (hitno: nedostatak sa predračuna na ugradnji) više ne pravi novu
-- samostalnu narudžbinu tipa „Hitno — zahtev sa terena“, već **Porudžbinu po nedostatku**
-- vezanu za postojeću (roditeljsku) narudžbinu materijala na poslu.
-- Označena je kolonom `site_missing_from_installation` radi UI (cena, predračun, mejl dobavljaču).
-- Kada se triage zapis završi, shortage narudžbina se automatski zatvara (`materials_received`).

ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS site_missing_from_installation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.material_orders.site_missing_from_installation IS
  'TRUE: Porudžbina po nedostatku kreirana iz hitnog alerta „nedostatak sa ugradnje“; dozvoljen predračun/cena kao kod standardne nabavke.';

-- Zatvori shortage narudžbinu kada se triage red označi kao završen (primljeno / proizvodnja potvrdila).
CREATE OR REPLACE FUNCTION public.trg_invoice_missing_site_procurement_complete_close_shortage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tr$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.completed_at IS NOT NULL
     AND (OLD.completed_at IS NULL) THEN
    UPDATE public.material_orders mo
    SET
      delivery_status = 'materials_received'::public.delivery_status,
      delivered_ok = true,
      delivery_date = coalesce(mo.delivery_date, CURRENT_DATE)
    WHERE mo.id = NEW.material_order_id
      AND COALESCE(mo.site_missing_from_installation, false) = true
      AND mo.delivery_status IS DISTINCT FROM 'materials_received'::public.delivery_status;
  END IF;
  RETURN NEW;
END;
$tr$;

DROP TRIGGER IF EXISTS invoice_missing_site_procurement_complete_close_shortage
  ON public.invoice_missing_site_procurement;
CREATE TRIGGER invoice_missing_site_procurement_complete_close_shortage
  AFTER UPDATE OF completed_at ON public.invoice_missing_site_procurement
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_invoice_missing_site_procurement_complete_close_shortage();

-- Pri otkazivanju vanredne stavke (needs_order): zatvori i shortage „hitno“ narudžbinu.
CREATE OR REPLACE FUNCTION public.trg_procurement_ad_hoc_invoice_missing_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tr$
DECLARE
  r public.invoice_missing_site_procurement%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'received' THEN
      SELECT * INTO r
      FROM public.invoice_missing_site_procurement l
      WHERE l.ad_hoc_item_id = NEW.id
        AND l.completed_at IS NULL
      LIMIT 1;

      IF FOUND THEN
        IF COALESCE(NEW.vrsta_stavke, 'sirovine_za_proizvodnju') = 'gotov_proizvod' THEN
          PERFORM public.invoice_missing_part_secure_core(r.job_id, r.position_display);
          UPDATE public.invoice_missing_site_procurement l
          SET completed_at = now(),
              awaiting_production_at = NULL
          WHERE l.id = r.id;
        ELSE
          UPDATE public.invoice_missing_site_procurement l
          SET awaiting_production_at = now()
          WHERE l.id = r.id;
        END IF;
      END IF;
    ELSIF NEW.status = 'canceled' THEN
      UPDATE public.material_orders mo
      SET
        delivery_status = 'materials_received'::public.delivery_status,
        delivered_ok = true,
        delivery_date = coalesce(mo.delivery_date, CURRENT_DATE),
        notes = coalesce(mo.notes, '')
          || E'\n[AUTO] Vanredna stavka otkazana — zatvorena Porudžbina po nedostatku (hitno sa ugradnje).'
      FROM public.invoice_missing_site_procurement l
      WHERE l.ad_hoc_item_id = NEW.id
        AND l.completed_at IS NULL
        AND mo.id = l.material_order_id
        AND COALESCE(mo.site_missing_from_installation, false) = true;

      DELETE FROM public.invoice_missing_site_procurement l
      WHERE l.ad_hoc_item_id = NEW.id
        AND l.completed_at IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$tr$;

CREATE OR REPLACE FUNCTION public.invoice_missing_send_to_procurement(
  p_job_id uuid,
  p_position text,
  p_vrsta_stavke text DEFAULT 'sirovine_za_proizvodnju'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_pos text;
  v_pos_key text;
  v_job_number text;
  v_parent_id uuid;
  v_parent_supplier text;
  v_parent_supplier_id uuid;
  v_parent_contact text;
  v_parent_material public.material_type;
  v_mo_id uuid;
  v_desc text;
  v_notes text;
  v_row public.procurement_ad_hoc_items;
  v_link_id uuid;
  v_vrsta text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role INTO v_role FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  PERFORM public.invoice_missing_secured_delete_stale_for_position(p_job_id, v_pos_key);

  v_vrsta := lower(trim(coalesce(p_vrsta_stavke, '')));
  IF v_vrsta NOT IN ('gotov_proizvod', 'sirovine_za_proizvodnju') THEN
    v_vrsta := 'sirovine_za_proizvodnju';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_missing_site_procurement l
    WHERE l.job_id = p_job_id
      AND l.position_key = v_pos_key
      AND l.completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Za ovu poziciju je već kreiran zahtev u nabavci.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_missing_part_secured s
    WHERE s.job_id = p_job_id AND s.position_key = v_pos_key
  ) THEN
    RAISE EXCEPTION 'Dopuna ugradnje je već zakažena za ovu poziciju.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_notifications un
    WHERE un.job_id = p_job_id
      AND un.notification_type = 'urgent_on_site_missing'
      AND un.read = false
      AND lower(trim(COALESCE(un.meta->>'position', ''))) = v_pos_key
  ) THEN
    RAISE EXCEPTION 'Nema aktivnog hitnog obaveštenja za ovu poziciju.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id) THEN
    RAISE EXCEPTION 'Posao nije pronađen' USING ERRCODE = '23514';
  END IF;

  SELECT j.job_number::text INTO v_job_number FROM public.jobs j WHERE j.id = p_job_id;
  v_job_number := COALESCE(NULLIF(trim(COALESCE(v_job_number, '')), ''), '?');

  -- Roditeljska narudžbina: poslednja „standardna" na poslu (prioritet primljene / na isporuci).
  SELECT mo.id, mo.supplier, mo.supplier_id, mo.supplier_contact, mo.material_type
  INTO v_parent_id, v_parent_supplier, v_parent_supplier_id, v_parent_contact, v_parent_material
  FROM public.material_orders mo
  WHERE mo.job_id = p_job_id
    AND COALESCE(mo.is_shortage_order, false) = false
  ORDER BY
    CASE mo.delivery_status
      WHEN 'materials_received'::public.delivery_status THEN 0
      WHEN 'received_with_issues'::public.delivery_status THEN 1
      WHEN 'waiting_for_delivery'::public.delivery_status THEN 2
      WHEN 'sent_to_supplier'::public.delivery_status THEN 3
      WHEN 'waiting_for_payment'::public.delivery_status THEN 4
      ELSE 5
    END,
    mo.created_at DESC
  LIMIT 1;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION
      'Za ovaj posao nema osnovne narudžbine materijala. Dodajte standardnu narudžbinu pre „Prosledi u nabavku“.'
      USING ERRCODE = '23514';
  END IF;

  v_mo_id := gen_random_uuid();

  INSERT INTO public.material_orders (
    id,
    job_id,
    supplier,
    supplier_id,
    supplier_contact,
    material_type,
    request_date,
    delivery_status,
    delivered_ok,
    paid,
    payment_status,
    supplier_price,
    notes,
    parent_order_id,
    is_shortage_order,
    site_missing_from_installation,
    nb_lines
  )
  VALUES (
    v_mo_id,
    p_job_id,
    coalesce(nullif(trim(v_parent_supplier), ''), '—'),
    v_parent_supplier_id,
    coalesce(nullif(trim(v_parent_contact), ''), ''),
    v_parent_material,
    CURRENT_DATE,
    'pending'::public.delivery_status,
    false,
    false,
    'pending',
    0,
    '[AUTO] Porudžbina po nedostatku — hitan nedostatak sa ugradnje (predračun). Pozicija: ' || v_pos
      || '. Posao: ' || v_job_number || '. Referenca parent: ' || substr(v_parent_id::text, 1, 8) || '.',
    v_parent_id,
    true,
    true,
    '[]'::jsonb
  );

  v_desc := 'Nedostaje na ugradnji — poz. ' || v_pos;
  v_notes := 'Automatski zahtev sa kontrolne table (hitno). Posao ' || v_job_number || '.';

  SELECT * INTO v_row
  FROM public.create_procurement_ad_hoc_item(
    v_mo_id,
    v_desc,
    NULL::text,
    1::numeric,
    'kom',
    v_notes,
    NULL::uuid,
    NULL::text,
    v_pos,
    NULL::text,
    NULL::numeric,
    v_vrsta
  );

  INSERT INTO public.invoice_missing_site_procurement (
    job_id,
    position_key,
    position_display,
    material_order_id,
    ad_hoc_item_id,
    created_by
  )
  VALUES (
    p_job_id,
    v_pos_key,
    v_pos,
    v_mo_id,
    v_row.id,
    v_uid
  )
  RETURNING id INTO v_link_id;

  RETURN jsonb_build_object(
    'link_id', v_link_id,
    'material_order_id', v_mo_id,
    'ad_hoc_item_id', v_row.id,
    'barcode', v_row.barcode,
    'vrsta_stavke', v_vrsta,
    'parent_order_id', v_parent_id,
    'is_shortage_order', true
  );
END;
$fn$;

ALTER FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) SET search_path TO public;

REVOKE ALL ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) IS
  'Kreira Porudžbinu po nedostatku (hitno sa ugradnje) + vanrednu stavku; parent = poslednja standardna narudžbina na poslu.';

NOTIFY pgrst, 'reload schema';
