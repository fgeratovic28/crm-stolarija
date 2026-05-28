-- Align jobs/customers SELECT for field roles with work_orders visibility:
-- montaza/teren/production users can SELECT any work order assigned to their team.
-- Prior policies required a work order whose *type* matched the role (e.g. montaza only
-- installation), so assigned service/complaint/installation cross-role WOs returned
-- work_orders rows but nested job/customer embeds were null (no phone, address, map).

CREATE OR REPLACE FUNCTION public.rls_job_visible_to_production_team(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    JOIN public.users u ON u.id = (SELECT auth.uid())
    WHERE w.job_id = p_job_id
      AND u.active IS TRUE
      AND u.team_id IS NOT NULL
      AND u.team_id = w.team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_job_visible_to_montaza_team(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    JOIN public.users u ON u.id = (SELECT auth.uid())
    WHERE w.job_id = p_job_id
      AND u.active IS TRUE
      AND u.team_id IS NOT NULL
      AND u.team_id = w.team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_job_visible_to_teren_team(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    JOIN public.users u ON u.id = (SELECT auth.uid())
    WHERE w.job_id = p_job_id
      AND u.active IS TRUE
      AND u.team_id IS NOT NULL
      AND u.team_id = w.team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_customer_visible_to_production_team(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.work_orders w ON w.job_id = j.id
    JOIN public.users u ON u.id = (SELECT auth.uid())
    WHERE j.customer_id = p_customer_id
      AND u.active IS TRUE
      AND u.team_id IS NOT NULL
      AND u.team_id = w.team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_customer_visible_to_montaza_team(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.work_orders w ON w.job_id = j.id
    JOIN public.users u ON u.id = (SELECT auth.uid())
    WHERE j.customer_id = p_customer_id
      AND u.active IS TRUE
      AND u.team_id IS NOT NULL
      AND u.team_id = w.team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_customer_visible_to_teren_team(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.work_orders w ON w.job_id = j.id
    JOIN public.users u ON u.id = (SELECT auth.uid())
    WHERE j.customer_id = p_customer_id
      AND u.active IS TRUE
      AND u.team_id IS NOT NULL
      AND u.team_id = w.team_id
  );
$$;
