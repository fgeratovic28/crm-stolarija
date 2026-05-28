-- Situation 1 (hitno nedostatak sa predračuna): uklanjanje vanredne stavke iz triage toka;
-- „Prosledi u nabavku“ otvara modal (UI) i šalje `p_payload` — kreira se Porudžbina po nedostatku sa `nb_lines`.
-- `requires_production`: false = gotov deo, true = sirovine (Excel).
-- Posle prijema u magacinu: ako nije proizvodnja → odmah secure_core (sivi tok); ako jeste → ljubičasta faza.

ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS requires_production boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.material_orders.requires_production IS
  'Za hitnu Porudžbinu po nedostatku sa ugradnje: TRUE = posle prijema čeka se proizvodnja pre zakaživanja ugradnje.';

-- Link više ne mora imati vanrednu stavku (ad_hoc).
ALTER TABLE public.invoice_missing_site_procurement
  ALTER COLUMN ad_hoc_item_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Prijem shortage narudžbine (site_missing_from_installation): grananje.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_material_orders_invoice_missing_site_reception_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tr$
DECLARE
  r record;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.delivery_status IS NOT DISTINCT FROM OLD.delivery_status THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.site_missing_from_installation, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.delivery_status IS DISTINCT FROM 'materials_received'::public.delivery_status THEN
    RETURN NEW;
  END IF;

  SELECT l.id, l.job_id, l.position_display, l.completed_at
  INTO r
  FROM public.invoice_missing_site_procurement l
  WHERE l.material_order_id = NEW.id
    AND l.completed_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.requires_production, false) THEN
    UPDATE public.invoice_missing_site_procurement l
    SET awaiting_production_at = now()
    WHERE l.id = r.id
      AND l.awaiting_production_at IS NULL;
  ELSE
    PERFORM public.invoice_missing_part_secure_core(r.job_id, r.position_display);
    UPDATE public.invoice_missing_site_procurement l
    SET completed_at = now(),
        awaiting_production_at = NULL
    WHERE l.id = r.id;
  END IF;

  RETURN NEW;
END;
$tr$;

DROP TRIGGER IF EXISTS material_orders_invoice_missing_site_reception ON public.material_orders;
CREATE TRIGGER material_orders_invoice_missing_site_reception
  AFTER UPDATE OF delivery_status ON public.material_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_material_orders_invoice_missing_site_reception_fn();

-- ---------------------------------------------------------------------------
-- secure_core: legacy ad_hoc + novi shortage bez ad_hoc.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoice_missing_part_secure_core(p_job_id uuid, p_position text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $core$
DECLARE
  v_pos text;
  v_pos_key text;
  v_wo_id uuid;
  v_desc text;
  v_existing_wo uuid;
  v_secured_id uuid;
  v_link_id uuid;
  v_ah_id uuid;
  v_ah_status text;
  v_await_prod timestamptz;
  v_mo_id uuid;
  v_mo_status public.delivery_status;
BEGIN
  v_link_id := NULL;
  v_ah_id := NULL;
  v_ah_status := NULL;
  v_await_prod := NULL;
  v_mo_id := NULL;
  v_mo_status := NULL;

  SELECT l.id, a.id, a.status, l.awaiting_production_at
  INTO v_link_id, v_ah_id, v_ah_status, v_await_prod
  FROM public.invoice_missing_site_procurement l
  INNER JOIN public.procurement_ad_hoc_items a ON a.id = l.ad_hoc_item_id
  WHERE l.job_id = p_job_id
    AND l.position_key = lower(trim(COALESCE(p_position, '')))
    AND l.completed_at IS NULL
  FOR UPDATE OF a, l
  LIMIT 1;

  IF v_link_id IS NOT NULL THEN
    IF v_ah_status = 'ordered'::text THEN
      RAISE EXCEPTION
        'Nabavka: stavka je već poručena. Sačekajte prijem u magacin ili se obratite nabavci za storno.'
        USING ERRCODE = '23514';
    ELSIF v_ah_status = 'needs_order'::text THEN
      UPDATE public.procurement_ad_hoc_items
      SET status = 'canceled'
      WHERE id = v_ah_id;
      DELETE FROM public.invoice_missing_site_procurement
      WHERE id = v_link_id;
    ELSIF v_ah_status = 'received'::text AND v_await_prod IS NOT NULL THEN
      RAISE EXCEPTION
        'Roba je primljena i čeka proizvodnju. Koristite dugme „Proizvedeno — Zakaži ugradnju“ na kontrolnoj tabli.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_link_id IS NULL THEN
    SELECT l.id, mo.id, mo.delivery_status, l.awaiting_production_at
    INTO v_link_id, v_mo_id, v_mo_status, v_await_prod
    FROM public.invoice_missing_site_procurement l
    INNER JOIN public.material_orders mo ON mo.id = l.material_order_id
    WHERE l.job_id = p_job_id
      AND l.position_key = lower(trim(COALESCE(p_position, '')))
      AND l.completed_at IS NULL
      AND l.ad_hoc_item_id IS NULL
      AND COALESCE(mo.site_missing_from_installation, false) = true
    FOR UPDATE OF mo, l
    LIMIT 1;

    IF v_link_id IS NOT NULL THEN
      IF v_mo_status IN (
        'sent_to_supplier'::public.delivery_status,
        'waiting_for_payment'::public.delivery_status,
        'waiting_for_delivery'::public.delivery_status
      ) THEN
        RAISE EXCEPTION
          'Nabavka: porudžbina je već poslata / na isporuci. Sačekajte prijem u magacin ili se obratite nabavci za storno.'
          USING ERRCODE = '23514';
      ELSIF v_mo_status IN ('pending'::public.delivery_status, 'email_sent'::public.delivery_status) THEN
        UPDATE public.material_orders mo
        SET
          delivery_status = 'materials_received'::public.delivery_status,
          delivered_ok = true,
          delivery_date = coalesce(mo.delivery_date, CURRENT_DATE)
        WHERE mo.id = v_mo_id;
        DELETE FROM public.invoice_missing_site_procurement
        WHERE id = v_link_id;
      ELSIF v_mo_status = 'materials_received'::public.delivery_status AND v_await_prod IS NOT NULL THEN
        RAISE EXCEPTION
          'Roba je primljena i čeka proizvodnju. Koristite dugme „Proizvedeno — Zakaži ugradnju“ na kontrolnoj tabli.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  PERFORM public.invoice_missing_secured_delete_stale_for_position(p_job_id, v_pos_key);

  SELECT s.id, s.followup_work_order_id
  INTO v_secured_id, v_existing_wo
  FROM public.invoice_missing_part_secured s
  WHERE s.job_id = p_job_id
    AND s.position_key = v_pos_key
  LIMIT 1;

  IF v_secured_id IS NOT NULL THEN
    UPDATE public.user_notifications un
    SET read = true
    WHERE un.job_id = p_job_id
      AND un.notification_type = 'urgent_on_site_missing'
      AND (
        lower(trim(COALESCE(un.meta->>'position', ''))) = v_pos_key
        OR COALESCE(un.meta->>'position', '') = v_pos
      );

    IF v_existing_wo IS NOT NULL THEN
      RETURN v_existing_wo;
    END IF;

    v_desc := LEFT(
      '[AUTO] Dopuna ugradnje — deo obezbeđen (poz. ' || v_pos || '). Zakažite montažu za ugradnju nedostajućeg dela.',
      6000
    );

    INSERT INTO public.work_orders (
      job_id,
      type,
      description,
      date,
      status,
      team_id,
      automation_field_report_id
    )
    VALUES (
      p_job_id,
      'installation'::public.work_order_type,
      v_desc,
      CURRENT_DATE,
      'pending'::public.work_order_status,
      NULL,
      NULL
    )
    RETURNING id INTO v_wo_id;

    UPDATE public.invoice_missing_part_secured
    SET followup_work_order_id = v_wo_id
    WHERE id = v_secured_id;

    RETURN v_wo_id;
  END IF;

  v_desc := LEFT(
    '[AUTO] Dopuna ugradnje — deo obezbeđen (poz. ' || v_pos || '). Zakažite montažu za ugradnju nedostajućeg dela.',
    6000
  );

  INSERT INTO public.work_orders (
    job_id,
    type,
    description,
    date,
    status,
    team_id,
    automation_field_report_id
  )
  VALUES (
    p_job_id,
    'installation'::public.work_order_type,
    v_desc,
    CURRENT_DATE,
    'pending'::public.work_order_status,
    NULL,
    NULL
  )
  RETURNING id INTO v_wo_id;

  INSERT INTO public.invoice_missing_part_secured (job_id, position_key, followup_work_order_id, created_by)
  VALUES (p_job_id, v_pos_key, v_wo_id, auth.uid());

  UPDATE public.user_notifications un
  SET read = true
  WHERE un.job_id = p_job_id
    AND un.notification_type = 'urgent_on_site_missing'
    AND (
      lower(trim(COALESCE(un.meta->>'position', ''))) = v_pos_key
      OR COALESCE(un.meta->>'position', '') = v_pos
    );

  RETURN v_wo_id;
END;
$core$;

ALTER FUNCTION public.invoice_missing_part_secure_core(uuid, text) SET search_path TO public;

-- ---------------------------------------------------------------------------
-- Potvrda proizvodnje: legacy ad_hoc + novi shortage (primljeno, čeka proizvodnju).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoice_missing_confirm_production_schedule_installation(
  p_job_id uuid,
  p_position text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cf$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_pos text;
  v_pos_key text;
  v_link_id uuid;
  v_wo uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role INTO v_role FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role NOT IN (
    'admin'::public.user_role,
    'production'::public.user_role,
    'procurement'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  SELECT l.id
  INTO v_link_id
  FROM public.invoice_missing_site_procurement l
  WHERE l.job_id = p_job_id
    AND l.position_key = v_pos_key
    AND l.completed_at IS NULL
    AND l.awaiting_production_at IS NOT NULL
    AND (
      (
        l.ad_hoc_item_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.procurement_ad_hoc_items a
          WHERE a.id = l.ad_hoc_item_id
            AND a.status = 'received'
            AND a.vrsta_stavke = 'sirovine_za_proizvodnju'
        )
      )
      OR (
        l.ad_hoc_item_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.material_orders mo
          WHERE mo.id = l.material_order_id
            AND mo.delivery_status = 'materials_received'::public.delivery_status
            AND COALESCE(mo.requires_production, false) = true
        )
      )
    )
  FOR UPDATE
  LIMIT 1;

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION 'Nema otvorenog koraka „čeka proizvodnju“ za ovu poziciju.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.invoice_missing_site_procurement l
  SET awaiting_production_at = NULL
  WHERE l.id = v_link_id;

  v_wo := public.invoice_missing_part_secure_core(p_job_id, v_pos);

  UPDATE public.invoice_missing_site_procurement l
  SET completed_at = now()
  WHERE l.id = v_link_id;

  RETURN v_wo;
END;
$cf$;

ALTER FUNCTION public.invoice_missing_confirm_production_schedule_installation(uuid, text) SET search_path TO public;

-- ---------------------------------------------------------------------------
-- Legacy trigger na vanrednoj stavci (samo kada postoji veza sa ad_hoc).
-- ---------------------------------------------------------------------------

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
        AND l.ad_hoc_item_id IS NOT NULL
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

-- ---------------------------------------------------------------------------
-- Novi RPC: jsonb payload umesto vrsta_stavke + bez ad_hoc.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.invoice_missing_send_to_procurement(uuid, text, text);
DROP FUNCTION IF EXISTS public.invoice_missing_send_to_procurement(uuid, text);

CREATE OR REPLACE FUNCTION public.invoice_missing_send_to_procurement(
  p_job_id uuid,
  p_position text,
  p_payload jsonb
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
  v_notes text;
  v_link_id uuid;
  v_kind text;
  v_item text;
  v_qty numeric;
  v_unit text;
  v_nb_lines jsonb;
  v_items_json jsonb;
  v_requires_prod boolean;
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
    RAISE EXCEPTION 'Dopuna ugradnje je već zakažana za ovu poziciju.' USING ERRCODE = '23514';
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

  v_kind := lower(trim(coalesce(p_payload->>'order_kind', '')));
  IF v_kind NOT IN ('gotov_deo', 'sirovine') THEN
    RAISE EXCEPTION 'Izaberite tip porudžbine (gotov_deo ili sirovine).' USING ERRCODE = '23514';
  END IF;

  IF v_kind = 'gotov_deo' THEN
    v_item := nullif(trim(coalesce(p_payload->>'item_name', '')), '');
    v_qty := coalesce((p_payload->>'quantity')::numeric, 0);
    IF v_item IS NULL OR length(v_item) < 1 OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Za gotov deo unesite naziv stavke i količinu veću od 0.' USING ERRCODE = '23514';
    END IF;
    v_unit := coalesce(nullif(trim(coalesce(p_payload->>'unit', '')), ''), 'kom');
    v_nb_lines := jsonb_build_array(
      jsonb_strip_nulls(
        jsonb_build_object(
          'description', v_item,
          'quantity', v_qty,
          'unit', v_unit,
          'lineNet', 0,
          'materialType', v_parent_material::text,
          'procurementMeta', jsonb_build_object('article', v_item, 'position', v_pos)
        )
      )
    );
    v_items_json := NULL;
    v_requires_prod := false;
  ELSE
    v_nb_lines := p_payload->'nb_lines';
    IF v_nb_lines IS NULL OR jsonb_typeof(v_nb_lines) <> 'array' OR jsonb_array_length(v_nb_lines) < 1 THEN
      RAISE EXCEPTION 'Za sirovine dodajte bar jednu stavku (Excel / tabela).' USING ERRCODE = '23514';
    END IF;
    v_items_json := p_payload->'items_json';
    v_requires_prod := true;
  END IF;

  v_mo_id := gen_random_uuid();
  v_notes := '[AUTO] Porudžbina po nedostatku — hitan nedostatak sa ugradnje (predračun). Pozicija: ' || v_pos
    || '. Posao: ' || v_job_number || '. Referenca parent: ' || substr(v_parent_id::text, 1, 8) || '.';

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
    requires_production,
    nb_lines,
    items_json
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
    v_notes,
    v_parent_id,
    true,
    true,
    v_requires_prod,
    v_nb_lines,
    v_items_json
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
    NULL,
    v_uid
  )
  RETURNING id INTO v_link_id;

  RETURN jsonb_build_object(
    'link_id', v_link_id,
    'material_order_id', v_mo_id,
    'parent_order_id', v_parent_id,
    'requires_production', v_requires_prod,
    'order_kind', v_kind
  );
END;
$fn$;

ALTER FUNCTION public.invoice_missing_send_to_procurement(uuid, text, jsonb) SET search_path TO public;

REVOKE ALL ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, jsonb) IS
  'Kreira Porudžbinu po nedostatku (nb_lines) za hitan nedostatak; payload: order_kind gotov_deo|sirovine.';

NOTIFY pgrst, 'reload schema';
