-- Prijava „nedostatak na terenu“: bez ručnog RN merenja — samo postojeći workflow iz field_reports + triggere.
-- Hitno Nabavka/Proizvodnja: poruka sa pozicijom i brojem posla.

DROP FUNCTION IF EXISTS public.report_missing_on_site(uuid, text, text, text);

DROP FUNCTION IF EXISTS public.notify_procurement_production_urgent_site_missing(uuid, text);

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
BEGIN
  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

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
    v_title,
    v_desc,
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

GRANT EXECUTE ON FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.list_sales_installation_problem_followup_work_orders();

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
  alert_key text,
  worker_report_context text
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
    ('wo:' || w.id::text) AS alert_key,
    LEFT(
      trim(
        both E'\n' FROM concat_ws(
          E'\n',
          CASE
            WHEN fr.id IS NOT NULL AND cardinality(COALESCE(fr.missing_items, ARRAY[]::text[])) > 0 THEN
              'Nedostaje / nije isporučeno: ' || array_to_string(fr.missing_items, ', ')
          END,
          CASE
            WHEN fr.id IS NOT NULL AND cardinality(COALESCE(fr.additional_needs, ARRAY[]::text[])) > 0 THEN
              'Tražena dopuna: ' || array_to_string(fr.additional_needs, ', ')
          END,
          CASE WHEN fr.id IS NOT NULL AND NULLIF(trim(fr.measurements), '') IS NOT NULL THEN fr.measurements END,
          CASE WHEN fr.id IS NOT NULL AND NULLIF(trim(fr.issues), '') IS NOT NULL THEN fr.issues END
        )
      ),
      4000
    ) AS worker_report_context
  FROM public.work_orders w
  JOIN public.jobs j ON j.id = w.job_id
  JOIN public.customers c ON c.id = j.customer_id
  LEFT JOIN public.field_reports fr ON fr.id = w.automation_field_report_id
  WHERE w.status IN ('pending'::public.work_order_status, 'in_progress'::public.work_order_status)
    AND NOT public.work_order_has_montaza_installation_team(w.team_id)
    AND w.automation_field_report_id IS NOT NULL
    AND w.type IN (
      'installation'::public.work_order_type,
      'site_visit'::public.work_order_type
    );
END;
$func$;

ALTER FUNCTION public.list_sales_installation_problem_followup_work_orders() SET search_path TO public;

GRANT EXECUTE ON FUNCTION public.list_sales_installation_problem_followup_work_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_sales_installation_problem_followup_work_orders() TO service_role;

ALTER TABLE public.work_orders DROP COLUMN IF EXISTS installation_site_followup;
