-- Dashboard: lista RN merenja / ugradnje bez dodeljenog tima (team_id NULL).
-- Direktan SELECT na work_orders za nabavku/finansije pada na RLS; zato SECURITY DEFINER RPC sa proverom uloge.

CREATE OR REPLACE FUNCTION public.list_work_orders_missing_team_for_dashboard()
RETURNS TABLE (
  work_order_id uuid,
  job_id uuid,
  job_number text,
  customer_name text,
  wo_type public.work_order_type,
  wo_description text,
  wo_status public.work_order_status
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
      AND u.active IS TRUE
      AND u.role IN (
        'admin'::public.user_role,
        'office'::public.user_role,
        'finance'::public.user_role,
        'procurement'::public.user_role
      )
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
    w.status AS wo_status
  FROM public.work_orders w
  JOIN public.jobs j ON j.id = w.job_id
  JOIN public.customers c ON c.id = j.customer_id
  WHERE w.team_id IS NULL
    AND w.status IN ('pending'::public.work_order_status, 'in_progress'::public.work_order_status)
    AND w.type IN (
      'measurement'::public.work_order_type,
      'measurement_verification'::public.work_order_type,
      'installation'::public.work_order_type
    )
    AND j.status NOT IN ('canceled'::public.job_status, 'completed'::public.job_status)
  ORDER BY j.job_number DESC
  LIMIT 400;
END;
$func$;

ALTER FUNCTION public.list_work_orders_missing_team_for_dashboard() SET search_path TO public;

REVOKE ALL ON FUNCTION public.list_work_orders_missing_team_for_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_work_orders_missing_team_for_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_work_orders_missing_team_for_dashboard() TO service_role;
