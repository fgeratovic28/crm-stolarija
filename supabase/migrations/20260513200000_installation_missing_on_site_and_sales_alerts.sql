-- Montaža: prijava nedostatka na terenu + Prodaja: widget upozorenja (otkazani poslovi + prateći RN bez dodele montažnog tima).

-- 1) Oznaka RN-a koji je prateći od problema na ugradnji / dopunskog merenja (van standardnog workflow-a).
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS installation_site_followup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_orders.installation_site_followup IS
  'RN kreiran kao prateći (npr. dopunsko merenje posle prijave „nedostaje na terenu“); koristi Prodaja widget.';

-- 2) Beleške Prodaje uz stavku upozorenja (persistira se po alert_key).
CREATE TABLE IF NOT EXISTS public.sales_alert_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL,
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_alert_notes_alert_key_uidx UNIQUE (alert_key)
);

CREATE INDEX IF NOT EXISTS idx_sales_alert_notes_updated
  ON public.sales_alert_notes(updated_at DESC);

ALTER TABLE public.sales_alert_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_alert_notes_office_admin ON public.sales_alert_notes;
CREATE POLICY sales_alert_notes_office_admin ON public.sales_alert_notes
  FOR ALL TO authenticated
  USING (public.get_current_user_role() IN ('office'::public.user_role, 'admin'::public.user_role))
  WITH CHECK (public.get_current_user_role() IN ('office'::public.user_role, 'admin'::public.user_role));

-- 3) Da li je na RN dodeljen tim koji ima bar jednog aktivnog korisnika u ulozi montaža.
CREATE OR REPLACE FUNCTION public.work_order_has_montaza_installation_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO public
AS $fn$
  SELECT p_team_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.team_id = p_team_id
        AND COALESCE(u.active, true) IS TRUE
        AND u.role = 'montaza'::public.user_role
    );
$fn$;

COMMENT ON FUNCTION public.work_order_has_montaza_installation_team(uuid) IS
  'Prodaja upozorenja: RN se skida sa liste kada je dodeljen tim sa montažerima.';

-- 4) Lista pratećih RN za Prodaja widget (SECURITY DEFINER + provera uloge).
CREATE OR REPLACE FUNCTION public.list_sales_installation_problem_followup_work_orders()
RETURNS TABLE (
  work_order_id uuid,
  job_id uuid,
  job_number text,
  customer_name text,
  wo_type public.work_order_type,
  wo_description text,
  wo_date date,
  wo_status public.work_order_status,
  alert_key text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('office'::public.user_role, 'admin'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    w.id AS work_order_id,
    j.id AS job_id,
    j.job_number::text AS job_number,
    COALESCE(NULLIF(trim(c.name::text), ''), '—') AS customer_name,
    w.type AS wo_type,
    COALESCE(w.description, '') AS wo_description,
    w.date AS wo_date,
    w.status AS wo_status,
    ('wo:' || w.id::text) AS alert_key
  FROM public.work_orders w
  JOIN public.jobs j ON j.id = w.job_id
  JOIN public.customers c ON c.id = j.customer_id
  WHERE w.status IN ('pending'::public.work_order_status, 'in_progress'::public.work_order_status)
    AND NOT public.work_order_has_montaza_installation_team(w.team_id)
    AND (
      (
        w.automation_field_report_id IS NOT NULL
        AND w.type IN (
          'installation'::public.work_order_type,
          'site_visit'::public.work_order_type
        )
      )
      OR COALESCE(w.installation_site_followup, false) = true
    );
END;
$func$;

ALTER FUNCTION public.list_sales_installation_problem_followup_work_orders() SET search_path TO public;

GRANT EXECUTE ON FUNCTION public.list_sales_installation_problem_followup_work_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_sales_installation_problem_followup_work_orders() TO service_role;

-- 5) Hitno obaveštenje Nabavci / Proizvodnji (predračun — greška firme).
CREATE OR REPLACE FUNCTION public.notify_procurement_production_urgent_site_missing(
  p_job_id uuid,
  p_description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_number text;
  v_dedupe text;
BEGIN
  SELECT j.job_number::text INTO v_job_number
  FROM public.jobs j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_dedupe := 'urgent-site-miss:' || p_job_id::text || ':' || gen_random_uuid()::text;

  INSERT INTO public.user_notifications AS un (
    user_id,
    notification_type,
    title,
    description,
    priority,
    job_id,
    read,
    dedupe_key
  )
  SELECT
    u.id,
    'urgent_on_site_missing',
    'HITNO: nedostatak sa ugradnje (predračun)',
    'Posao ' || COALESCE(NULLIF(trim(v_job_number), ''), '?')
      || '. ' || COALESCE(NULLIF(trim(p_description), ''), 'Proverite poziciju i naručite/proizvedite odmah.'),
    'high',
    p_job_id,
    false,
    v_dedupe || ':' || u.id::text
  FROM public.users AS u
  WHERE u.role IN (
      'procurement'::public.user_role,
      'production'::public.user_role,
      'admin'::public.user_role
    )
    AND COALESCE(u.active, true) IS TRUE;
END;
$func$;

ALTER FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) SET search_path TO public;

-- 6) Prijava sa terena (Montaža): predračun / dopunsko merenje.
CREATE OR REPLACE FUNCTION public.report_missing_on_site(
  p_source_installation_work_order_id uuid,
  p_flow text,
  p_position_number text DEFAULT NULL,
  p_measurements_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_team_id uuid;
  v_wo record;
  v_job_id uuid;
  v_pos text;
  v_meas text;
  v_new_wo_id uuid;
  v_desc text;
  v_notify_body text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role, u.team_id
  INTO v_role, v_team_id
  FROM public.users u
  WHERE u.id = v_uid;

  IF v_role IS DISTINCT FROM 'montaza'::public.user_role THEN
    RAISE EXCEPTION 'Samo Montaža može prijaviti nedostatak na terenu' USING ERRCODE = '42501';
  END IF;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Korisnik nema dodeljen tim' USING ERRCODE = '23514';
  END IF;

  IF p_flow NOT IN ('proforma_company', 'extra_measurement') THEN
    RAISE EXCEPTION 'Nepoznat tip prijave' USING ERRCODE = '23514';
  END IF;

  SELECT w.id, w.job_id, w.type, w.team_id, w.status
  INTO v_wo
  FROM public.work_orders w
  WHERE w.id = p_source_installation_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Radni nalog nije pronađen' USING ERRCODE = 'P0002';
  END IF;

  IF v_wo.type IS DISTINCT FROM 'installation'::public.work_order_type THEN
    RAISE EXCEPTION 'Prijava je dozvoljena samo sa naloga ugradnje' USING ERRCODE = '23514';
  END IF;

  IF v_wo.team_id IS DISTINCT FROM v_team_id THEN
    RAISE EXCEPTION 'Nalog ne pripada vašem timu' USING ERRCODE = '42501';
  END IF;

  IF v_wo.status IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status) THEN
    RAISE EXCEPTION 'Nalog je završen ili otkazan' USING ERRCODE = '23514';
  END IF;

  v_job_id := v_wo.job_id;

  IF p_flow = 'proforma_company' THEN
    v_pos := NULLIF(trim(COALESCE(p_position_number, '')), '');
    IF v_pos IS NULL THEN
      RAISE EXCEPTION 'Broj pozicije je obavezan' USING ERRCODE = '23514';
    END IF;

    v_notify_body := 'Stavka JE na predračunu. Pozicija: ' || v_pos || '.';
    PERFORM public.notify_procurement_production_urgent_site_missing(v_job_id, v_notify_body);

    INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
    VALUES (
      v_job_id,
      'other'::public.communication_type,
      '[TEREN] Prijava nedostatka: na predračunu, pozicija ' || v_pos || '. Hitno obaveštenje poslato Nabavci/Proizvodnji.',
      NOW(),
      'missing-on-site-proforma:' || p_source_installation_work_order_id::text || ':' || gen_random_uuid()::text,
      v_uid
    );

    RETURN jsonb_build_object('ok', true, 'flow', 'proforma_company');
  END IF;

  -- extra_measurement
  v_meas := NULLIF(trim(COALESCE(p_measurements_description, '')), '');
  IF v_meas IS NULL THEN
    RAISE EXCEPTION 'Mere i opis su obavezni' USING ERRCODE = '23514';
  END IF;

  v_desc := LEFT(
    trim(both E'\n' FROM concat_ws(
      E'\n',
      '[AUTO] Dopunsko merenje — klijent želi merenje za novu ponudu (prijava Montaže sa terena).',
      v_meas
    )),
    6000
  );

  INSERT INTO public.work_orders (
    job_id,
    type,
    description,
    date,
    status,
    team_id,
    installation_site_followup,
    automation_field_report_id
  )
  VALUES (
    v_job_id,
    'measurement'::public.work_order_type,
    v_desc,
    CURRENT_DATE,
    'pending'::public.work_order_status,
    NULL,
    true,
    NULL
  )
  RETURNING id INTO v_new_wo_id;

  INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
  VALUES (
    v_job_id,
    'other'::public.communication_type,
    '[AUTO] Otvoren prateći nalog merenja zbog prijave „nedostaje na terenu“ (klijent traži novu ponudu).',
    NOW(),
    'missing-on-site-measure-wo:' || v_new_wo_id::text,
    v_uid
  );

  PERFORM public.recompute_job_status(v_job_id);

  RETURN jsonb_build_object(
    'ok', true,
    'flow', 'extra_measurement',
    'measurement_work_order_id', v_new_wo_id
  );
END;
$func$;

ALTER FUNCTION public.report_missing_on_site(uuid, text, text, text) SET search_path TO public;

GRANT EXECUTE ON FUNCTION public.report_missing_on_site(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_missing_on_site(uuid, text, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) TO service_role;
