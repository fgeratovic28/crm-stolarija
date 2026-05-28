-- Kada je RN dopune (magacin) završen ili otkazan, briše se `invoice_missing_part_secured` za taj RN,
-- da nova prijava iste pozicije može da pokrene novi hitni tok (nabavka / magacin).
-- Čišćenje i pre novog hitnog obaveštenja / RPC-ova ako je red ostao u bazi a RN je već terminalan.

CREATE OR REPLACE FUNCTION public.invoice_missing_secured_delete_stale_for_position(p_job_id uuid, p_position_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $h$
DECLARE
  v_key text;
BEGIN
  v_key := lower(trim(COALESCE(p_position_key, '')));
  IF v_key IS NULL OR length(v_key) = 0 OR p_job_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.invoice_missing_part_secured s
  USING public.work_orders w
  WHERE s.job_id = p_job_id
    AND s.position_key = v_key
    AND s.followup_work_order_id = w.id
    AND w.status IN (
      'completed'::public.work_order_status,
      'canceled'::public.work_order_status
    );
END;
$h$;

ALTER FUNCTION public.invoice_missing_secured_delete_stale_for_position(uuid, text) SET search_path TO public;

REVOKE ALL ON FUNCTION public.invoice_missing_secured_delete_stale_for_position(uuid, text) FROM PUBLIC;

COMMENT ON FUNCTION public.invoice_missing_secured_delete_stale_for_position(uuid, text) IS
  'Briše zapis magacina za (posao, poziciju) ako je prateći RN ugradnje završen ili otkazan.';

CREATE OR REPLACE FUNCTION public.trg_work_orders_cleanup_invoice_missing_secured_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $tg$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.invoice_missing_part_secured
    WHERE followup_work_order_id = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IN (
       'completed'::public.work_order_status,
       'canceled'::public.work_order_status
     )
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    DELETE FROM public.invoice_missing_part_secured
    WHERE followup_work_order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$tg$;

ALTER FUNCTION public.trg_work_orders_cleanup_invoice_missing_secured_fn() SET search_path TO public;

DROP TRIGGER IF EXISTS trg_work_orders_cleanup_invoice_missing_secured ON public.work_orders;
CREATE TRIGGER trg_work_orders_cleanup_invoice_missing_secured
  AFTER UPDATE OF status OR DELETE ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_work_orders_cleanup_invoice_missing_secured_fn();

REVOKE ALL ON FUNCTION public.trg_work_orders_cleanup_invoice_missing_secured_fn() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.notify_procurement_production_urgent_site_missing(
  p_job_id uuid,
  p_position text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_number text;
  v_pos text;
  v_title text;
  v_desc text;
  v_dedupe text;
  v_meta jsonb;
BEGIN
  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  PERFORM public.invoice_missing_secured_delete_stale_for_position(p_job_id, lower(v_pos));

  SELECT j.job_number::text INTO v_job_number
  FROM public.jobs j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_job_number := COALESCE(NULLIF(trim(COALESCE(v_job_number, '')), ''), '?');

  v_title := 'Hitno: Proizvodnja/Nabavka za Poziciju ' || v_pos || ' (Posao ' || v_job_number || ')';
  v_title := LEFT(v_title, 500);

  v_desc := 'Proverite naručivanje / proizvodnju za poziciju ' || v_pos || ' na poslu ' || v_job_number || '.';

  v_meta := jsonb_build_object('kind', 'invoice_missing', 'position', v_pos);

  v_dedupe := 'urgent-site-miss:' || p_job_id::text || ':' || v_pos;

  INSERT INTO public.user_notifications AS un (
    user_id,
    notification_type,
    title,
    description,
    priority,
    job_id,
    read,
    dedupe_key,
    meta
  )
  SELECT
    u.id,
    'urgent_on_site_missing',
    v_title,
    v_desc,
    'high',
    p_job_id,
    false,
    v_dedupe || ':' || u.id::text,
    v_meta
  FROM public.users AS u
  WHERE u.role IN (
      'procurement'::public.user_role,
      'production'::public.user_role,
      'admin'::public.user_role
    )
    AND COALESCE(u.active, true) IS TRUE
  ON CONFLICT (dedupe_key) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    meta = EXCLUDED.meta,
    read = false,
    created_at = now();
END;
$func$;

ALTER FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) SET search_path TO public;

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

REVOKE ALL ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) TO service_role;

COMMENT ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) IS
  'Magacin „deo obezbeđen“: briše zastareli secured ako je RN dopune završen; idempotentno po (job_id, position_key).';

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
  'Kreira internu narudžbinu + vanrednu stavku; pre toga uklanja zastareli secured ako je RN dopune završen.';
