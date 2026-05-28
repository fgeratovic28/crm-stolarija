-- Situation 1 (hitno nedostatak sa predračuna): triage — magacin vs nabavka, sinhronizacija sa procurement_ad_hoc_items.

-- ---------------------------------------------------------------------------
-- Jezgro: kreira RN ugradnje + secured red + gasi hitna obaveštenja (bez auth).
-- Koristi ga i trigger posle prijema vanredne stavke.
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
BEGIN
  v_link_id := NULL;
  v_ah_id := NULL;
  v_ah_status := NULL;

  -- Aktivna nabavka: ako je stavka već poručena, ne dozvoljavamo „magacin“ prečicu.
  SELECT l.id, a.id, a.status
  INTO v_link_id, v_ah_id, v_ah_status
  FROM public.invoice_missing_site_procurement l
  INNER JOIN public.procurement_ad_hoc_items a ON a.id = l.ad_hoc_item_id
  WHERE l.job_id = p_job_id
    AND l.position_key = lower(trim(COALESCE(p_position, '')))
    AND l.completed_at IS NULL
  FOR UPDATE OF a;

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

COMMENT ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) IS
  'Interno: zatvara hitni nedostatak (RN ugradnje + secured + read notifikacije).';

-- ---------------------------------------------------------------------------
-- Javni RPC: ista uloga kao ranije, sada delegira na core.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.secure_invoice_missing_part_schedule_installation(
  p_job_id uuid,
  p_position text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role INTO v_role FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  RETURN public.invoice_missing_part_secure_core(p_job_id, p_position);
END;
$func$;

ALTER FUNCTION public.secure_invoice_missing_part_schedule_installation(uuid, text) SET search_path TO public;

-- ---------------------------------------------------------------------------
-- Veza hitnog alerta → narudžbina + vanredna stavka (Zahtev za nabavku).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoice_missing_site_procurement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  position_key text NOT NULL,
  position_display text NOT NULL,
  material_order_id uuid NOT NULL REFERENCES public.material_orders (id) ON DELETE CASCADE,
  ad_hoc_item_id uuid NOT NULL REFERENCES public.procurement_ad_hoc_items (id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_missing_site_procurement_open_uidx
  ON public.invoice_missing_site_procurement (job_id, position_key)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_missing_site_procurement_job
  ON public.invoice_missing_site_procurement (job_id);

CREATE INDEX IF NOT EXISTS idx_invoice_missing_site_procurement_ad_hoc_open
  ON public.invoice_missing_site_procurement (ad_hoc_item_id)
  WHERE completed_at IS NULL;

COMMENT ON TABLE public.invoice_missing_site_procurement IS
  'Triage „Prosledi u nabavku“ za hitan nedostatak sa terena: otvoreno dok stavka ne stigne (received) ili se otkaže.';

ALTER TABLE public.invoice_missing_site_procurement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_missing_site_procurement_select_roles ON public.invoice_missing_site_procurement;
CREATE POLICY invoice_missing_site_procurement_select_roles ON public.invoice_missing_site_procurement
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() IN (
    'admin'::public.user_role,
    'procurement'::public.user_role,
    'production'::public.user_role
  ));

DROP POLICY IF EXISTS invoice_missing_site_procurement_write_roles ON public.invoice_missing_site_procurement;
CREATE POLICY invoice_missing_site_procurement_write_roles ON public.invoice_missing_site_procurement
  FOR ALL TO authenticated
  USING (public.get_current_user_role() IN (
    'admin'::public.user_role,
    'procurement'::public.user_role
  ))
  WITH CHECK (public.get_current_user_role() IN (
    'admin'::public.user_role,
    'procurement'::public.user_role
  ));

-- ---------------------------------------------------------------------------
-- Prosledi u nabavku: nova narudžbina (interni zahtev) + vanredna stavka.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoice_missing_send_to_procurement(p_job_id uuid, p_position text)
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
    NULL::numeric
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
    'barcode', v_row.barcode
  );
END;
$fn$;

ALTER FUNCTION public.invoice_missing_send_to_procurement(uuid, text) SET search_path TO public;

REVOKE ALL ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text) TO service_role;

COMMENT ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text) IS
  'Kreira internu narudžbinu + vanrednu stavku za hitan nedostatak; alert ostaje otvoren.';

-- ---------------------------------------------------------------------------
-- Trigger: received → zakaži ugradnju i zatvori vezu; canceled → ukloni vezu (ponovo crveni tok).
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
        PERFORM public.invoice_missing_part_secure_core(r.job_id, r.position_display);
        UPDATE public.invoice_missing_site_procurement l
        SET completed_at = now()
        WHERE l.id = r.id;
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

DROP TRIGGER IF EXISTS procurement_ad_hoc_items_invoice_missing_sync ON public.procurement_ad_hoc_items;
CREATE TRIGGER procurement_ad_hoc_items_invoice_missing_sync
  AFTER UPDATE OF status ON public.procurement_ad_hoc_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_procurement_ad_hoc_invoice_missing_sync();

REVOKE ALL ON FUNCTION public.trg_procurement_ad_hoc_invoice_missing_sync() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
