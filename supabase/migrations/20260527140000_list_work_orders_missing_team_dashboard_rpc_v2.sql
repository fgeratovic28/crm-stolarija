-- v2: provera uloge preko get_current_user_role (isti izvor kao RLS); NULL uloga = odbijeno.
-- Uključen i RN proizvodnje bez tima (dispečing).

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
      'installation'::public.work_order_type,
      'production'::public.work_order_type
    )
    AND j.status NOT IN ('canceled'::public.job_status, 'completed'::public.job_status)
  ORDER BY j.job_number DESC
  LIMIT 400;
END;
$func$;

ALTER FUNCTION public.list_work_orders_missing_team_for_dashboard() SET search_path TO public;
