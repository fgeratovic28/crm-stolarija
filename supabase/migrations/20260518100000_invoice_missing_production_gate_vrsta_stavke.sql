-- Situation 1 triage: korak „Proizvodnja“ posle prijema sirovina + polje vrsta_stavke na vanrednoj stavki (samo za ovaj tok).

-- ---------------------------------------------------------------------------
-- 1) Vrsta stavke (gotov vs sirovine) — podrazumevano sirovine.
-- ---------------------------------------------------------------------------

ALTER TABLE public.procurement_ad_hoc_items
  ADD COLUMN IF NOT EXISTS vrsta_stavke text;

UPDATE public.procurement_ad_hoc_items
SET vrsta_stavke = 'sirovine_za_proizvodnju'
WHERE vrsta_stavke IS NULL;

ALTER TABLE public.procurement_ad_hoc_items
  ALTER COLUMN vrsta_stavke SET DEFAULT 'sirovine_za_proizvodnju',
  ALTER COLUMN vrsta_stavke SET NOT NULL;

ALTER TABLE public.procurement_ad_hoc_items
  DROP CONSTRAINT IF EXISTS procurement_ad_hoc_items_vrsta_stavke_chk;

ALTER TABLE public.procurement_ad_hoc_items
  ADD CONSTRAINT procurement_ad_hoc_items_vrsta_stavke_chk CHECK (
    vrsta_stavke IN ('gotov_proizvod', 'sirovine_za_proizvodnju')
  );

COMMENT ON COLUMN public.procurement_ad_hoc_items.vrsta_stavke IS
  'Za hitni triage: gotov_proizvod (spreman za ugradnju) | sirovine_za_proizvodnju (čeka proizvodnju). Redovne vanredne stavke ostaju na podrazumevanoj vrednosti.';

-- ---------------------------------------------------------------------------
-- 2) Veza triage ↔ magacin: čeka proizvodnju posle prijema sirovina.
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoice_missing_site_procurement
  ADD COLUMN IF NOT EXISTS awaiting_production_at timestamptz;

COMMENT ON COLUMN public.invoice_missing_site_procurement.awaiting_production_at IS
  'Magacin primio robu (received); sirovine — sledeći korak je proizvodnja pre zakaživanja ugradnje.';

-- ---------------------------------------------------------------------------
-- 3) create_procurement_ad_hoc_item: novi parametar (podrazumevano sirovine).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid);
DROP FUNCTION IF EXISTS public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.create_procurement_ad_hoc_item(
  p_order_id uuid,
  p_description text,
  p_article_code text,
  p_quantity numeric,
  p_unit text,
  p_notes text,
  p_attachment_file_id uuid,
  p_work_order text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_length_mm numeric DEFAULT NULL,
  p_vrsta_stavke text DEFAULT 'sirovine_za_proizvodnju'
)
RETURNS public.procurement_ad_hoc_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role public.user_role;
  v_new_id uuid := gen_random_uuid();
  v_barcode text;
  v_row public.procurement_ad_hoc_items;
  v_length numeric;
  v_vrsta text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni';
  END IF;

  v_role := public.get_current_user_role();
  IF v_role IS NULL OR v_role NOT IN (
    'admin'::public.user_role,
    'procurement'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nemate dozvolu za dodavanje vanredne stavke';
  END IF;

  IF p_description IS NULL OR length(trim(p_description)) < 1 THEN
    RAISE EXCEPTION 'Naziv vanredne stavke je obavezan';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Količina mora biti veća od 0';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.material_orders WHERE id = p_order_id
  ) THEN
    RAISE EXCEPTION 'Narudžbina nije pronađena';
  END IF;

  IF p_length_mm IS NOT NULL AND p_length_mm <= 0 THEN
    v_length := NULL;
  ELSE
    v_length := p_length_mm;
  END IF;

  v_vrsta := lower(trim(coalesce(p_vrsta_stavke, '')));
  IF v_vrsta NOT IN ('gotov_proizvod', 'sirovine_za_proizvodnju') THEN
    v_vrsta := 'sirovine_za_proizvodnju';
  END IF;

  v_barcode := public.procurement_short_barcode('A', v_new_id);

  INSERT INTO public.procurement_ad_hoc_items (
    id,
    order_id,
    description,
    article_code,
    quantity,
    unit,
    notes,
    attachment_file_id,
    barcode,
    status,
    created_by,
    work_order,
    position,
    color,
    length_mm,
    vrsta_stavke
  )
  VALUES (
    v_new_id,
    p_order_id,
    trim(p_description),
    nullif(trim(coalesce(p_article_code, '')), ''),
    p_quantity,
    coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'kom'),
    nullif(trim(coalesce(p_notes, '')), ''),
    p_attachment_file_id,
    v_barcode,
    'needs_order',
    auth.uid(),
    nullif(trim(coalesce(p_work_order, '')), ''),
    nullif(trim(coalesce(p_position, '')), ''),
    nullif(trim(coalesce(p_color, '')), ''),
    v_length,
    v_vrsta
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric, text) TO service_role;

COMMENT ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric, text) IS
  'Kreira vanrednu stavku; opciono vrsta_stavke (gotov_proizvod | sirovine_za_proizvodnju) za hitni triage.';

-- ---------------------------------------------------------------------------
-- 4) Jezgro secure: blokada ako je roba primljena ali čeka proizvodnju.
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
  v_existing uuid;
  v_link_id uuid;
  v_ah_id uuid;
  v_ah_status text;
  v_await_prod timestamptz;
BEGIN
  v_link_id := NULL;
  v_ah_id := NULL;
  v_ah_status := NULL;
  v_await_prod := NULL;

  SELECT l.id, a.id, a.status, l.awaiting_production_at
  INTO v_link_id, v_ah_id, v_ah_status, v_await_prod
  FROM public.invoice_missing_site_procurement l
  INNER JOIN public.procurement_ad_hoc_items a ON a.id = l.ad_hoc_item_id
  WHERE l.job_id = p_job_id
    AND l.position_key = lower(trim(COALESCE(p_position, '')))
    AND l.completed_at IS NULL
  FOR UPDATE;

  IF v_link_id IS NOT NULL THEN
    IF v_ah_status = 'ordered' THEN
      RAISE EXCEPTION
        'Nabavka: stavka je već poručena. Sačekajte prijem u magacin ili se obratite nabavci za storno.'
        USING ERRCODE = '23514';
    ELSIF v_ah_status = 'needs_order' THEN
      UPDATE public.procurement_ad_hoc_items
      SET status = 'canceled'
      WHERE id = v_ah_id;
      DELETE FROM public.invoice_missing_site_procurement
      WHERE id = v_link_id;
    ELSIF v_ah_status = 'received' AND v_await_prod IS NOT NULL THEN
      RAISE EXCEPTION
        'Roba je primljena i čeka proizvodnju. Koristite dugme „Proizvedeno — Zakaži ugradnju“ na kontrolnoj tabli.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  SELECT s.followup_work_order_id
  INTO v_existing
  FROM public.invoice_missing_part_secured s
  WHERE s.job_id = p_job_id AND s.position_key = v_pos_key;

  IF v_existing IS NOT NULL THEN
    UPDATE public.user_notifications un
    SET read = true
    WHERE un.job_id = p_job_id
      AND un.notification_type = 'urgent_on_site_missing'
      AND COALESCE(un.meta->>'position', '') = v_pos;

    RETURN v_existing;
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
    AND COALESCE(un.meta->>'position', '') = v_pos;

  RETURN v_wo_id;
END;
$core$;

REVOKE ALL ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5) invoice_missing_send_to_procurement: treći argument vrsta_stavke.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.invoice_missing_send_to_procurement(uuid, text);

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

  v_mo_id := gen_random_uuid();

  INSERT INTO public.material_orders (
    id,
    job_id,
    supplier,
    supplier_id,
    material_type,
    request_date,
    delivery_status,
    delivered_ok,
    paid,
    payment_status,
    supplier_price,
    notes
  )
  VALUES (
    v_mo_id,
    p_job_id,
    'Hitno — zahtev sa terena (nedostatak)',
    NULL,
    'other'::public.material_type,
    CURRENT_DATE,
    'pending'::public.delivery_status,
    false,
    false,
    'pending',
    0,
    '[AUTO] Kreirano iz hitnog alerta „nedostatak sa ugradnje“. Pozicija: ' || v_pos || '. Posao: ' || v_job_number || '.'
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
    'vrsta_stavke', v_vrsta
  );
END;
$fn$;

ALTER FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) SET search_path TO public;

REVOKE ALL ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, text) IS
  'Kreira internu narudžbinu + vanrednu stavku; p_vrsta_stavke: gotov_proizvod | sirovine_za_proizvodnju.';

-- ---------------------------------------------------------------------------
-- 6) Potvrda proizvodnje → RN ugradnje (posle ljubičaste faze).
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
  v_ah_id uuid;
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

  SELECT l.id, l.ad_hoc_item_id
  INTO v_link_id, v_ah_id
  FROM public.invoice_missing_site_procurement l
  INNER JOIN public.procurement_ad_hoc_items a ON a.id = l.ad_hoc_item_id
  WHERE l.job_id = p_job_id
    AND l.position_key = v_pos_key
    AND l.completed_at IS NULL
    AND l.awaiting_production_at IS NOT NULL
    AND a.status = 'received'
    AND a.vrsta_stavke = 'sirovine_za_proizvodnju'
  FOR UPDATE;

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

REVOKE ALL ON FUNCTION public.invoice_missing_confirm_production_schedule_installation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_confirm_production_schedule_installation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_missing_confirm_production_schedule_installation(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7) Trigger: received — grananje po vrsta_stavke.
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
      DELETE FROM public.invoice_missing_site_procurement l
      WHERE l.ad_hoc_item_id = NEW.id
        AND l.completed_at IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$tr$;

REVOKE ALL ON FUNCTION public.trg_procurement_ad_hoc_invoice_missing_sync() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
