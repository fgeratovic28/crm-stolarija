-- Kontrolna tabla (sivi baner): poslovi „prihvaćeno“ gde još treba u potpunosti zakazati merenje (tim + datum).
-- Isključeni su poslovi koji već imaju RN merenja bez tima — oni su u listi „Prodaja — merenje (bez tima)“.

DROP FUNCTION IF EXISTS public.list_accepted_scheduled_measurements_for_dashboard();

CREATE OR REPLACE FUNCTION public.list_accepted_needs_measurement_schedule_for_dashboard()
RETURNS TABLE (
  work_order_id uuid,
  job_id uuid,
  job_number text,
  customer_name text,
  wo_type public.work_order_type,
  wo_description text,
  wo_status public.work_order_status,
  scheduled_date date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_role public.user_role;
BEGIN
  v_role := public.get_current_user_role();
  IF v_role IS NULL
     OR v_role NOT IN (
       'admin'::public.user_role,
       'office'::public.user_role,
       'finance'::public.user_role,
       'procurement'::public.user_role
     ) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    w.id AS work_order_id,
    j.id AS job_id,
    j.job_number::text AS job_number,
    COALESCE(NULLIF(trim(c.name::text), ''), '—') AS customer_name,
    COALESCE(w.type, 'measurement'::public.work_order_type) AS wo_type,
    COALESCE(
      NULLIF(trim(both ' ' FROM w.description), ''),
      'Potrebno je zakazati merenje i dodeliti tim (kartica posla).'
    ) AS wo_description,
    COALESCE(w.status, 'pending'::public.work_order_status) AS wo_status,
    w.date AS scheduled_date
  FROM public.jobs j
  JOIN public.customers c ON c.id = j.customer_id
  LEFT JOIN LATERAL (
    SELECT wo.id, wo.type, wo.description, wo.status, wo.date, wo.team_id
    FROM public.work_orders wo
    WHERE wo.job_id = j.id
      AND wo.type IN (
        'measurement'::public.work_order_type,
        'measurement_verification'::public.work_order_type
      )
      AND wo.status IN (
        'pending'::public.work_order_status,
        'in_progress'::public.work_order_status
      )
    ORDER BY wo.date NULLS LAST, wo.id DESC
    LIMIT 1
  ) w ON true
  WHERE j.status = 'accepted'::public.job_status
    -- Još nema merenja sa i timom i datumom
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_orders wx
      WHERE wx.job_id = j.id
        AND wx.type IN (
          'measurement'::public.work_order_type,
          'measurement_verification'::public.work_order_type
        )
        AND wx.status IN (
          'pending'::public.work_order_status,
          'in_progress'::public.work_order_status
        )
        AND wx.team_id IS NOT NULL
        AND wx.date IS NOT NULL
    )
    -- Bez duplog prikaza: RN merenja bez tima već ide u drugu listu banera
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_orders w2
      WHERE w2.job_id = j.id
        AND w2.type IN (
          'measurement'::public.work_order_type,
          'measurement_verification'::public.work_order_type
        )
        AND w2.status IN (
          'pending'::public.work_order_status,
          'in_progress'::public.work_order_status
        )
        AND w2.team_id IS NULL
    )
  ORDER BY j.job_number DESC
  LIMIT 200;
END;
$func$;

ALTER FUNCTION public.list_accepted_needs_measurement_schedule_for_dashboard() SET search_path TO public;

REVOKE ALL ON FUNCTION public.list_accepted_needs_measurement_schedule_for_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_accepted_needs_measurement_schedule_for_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_accepted_needs_measurement_schedule_for_dashboard() TO service_role;

COMMENT ON FUNCTION public.list_accepted_needs_measurement_schedule_for_dashboard() IS
  'Dashboard: prihvaćeni poslovi gde treba završiti zakazivanje merenja (tim + datum), bez duplog lista za RN bez tima.';

NOTIFY pgrst, 'reload schema';
