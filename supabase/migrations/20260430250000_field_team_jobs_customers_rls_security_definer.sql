-- Timovi production/montaza/teren: SELECT na jobs/customers koristio je EXISTS/podupite
-- koji ponovo aktiviraju RLS na jobs↔customers↔work_orders i mogu baciti grešku
-- (beskonačna rekurzija ili interna greška evaluatora) → PostgREST 500 na REST upitima.
-- Ove funkcije rade istu logiku kao ranije politike, ali kao SECURITY DEFINER
-- čitaju podatke bez ugniježđenog RLS-a (samo provera tima i auth.uid()).

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
      AND w.type = 'production'::public.work_order_type
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
      AND w.type = 'installation'::public.work_order_type
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
      AND w.type = ANY (
        ARRAY[
          'measurement'::public.work_order_type,
          'measurement_verification'::public.work_order_type,
          'complaint'::public.work_order_type,
          'service'::public.work_order_type,
          'site_visit'::public.work_order_type,
          'control_visit'::public.work_order_type
        ]
      )
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
      AND w.type = 'production'::public.work_order_type
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
      AND w.type = 'installation'::public.work_order_type
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
      AND w.type = ANY (
        ARRAY[
          'measurement'::public.work_order_type,
          'measurement_verification'::public.work_order_type,
          'complaint'::public.work_order_type,
          'service'::public.work_order_type,
          'site_visit'::public.work_order_type,
          'control_visit'::public.work_order_type
        ]
      )
      AND u.active IS TRUE
      AND u.team_id IS NOT NULL
      AND u.team_id = w.team_id
  );
$$;

REVOKE ALL ON FUNCTION public.rls_job_visible_to_production_team(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_job_visible_to_montaza_team(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_job_visible_to_teren_team(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_customer_visible_to_production_team(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_customer_visible_to_montaza_team(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_customer_visible_to_teren_team(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rls_job_visible_to_production_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_job_visible_to_montaza_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_job_visible_to_teren_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_customer_visible_to_production_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_customer_visible_to_montaza_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_customer_visible_to_teren_team(uuid) TO authenticated;

DROP POLICY IF EXISTS production_read_jobs ON public.jobs;
CREATE POLICY production_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'::public.user_role
    AND public.rls_job_visible_to_production_team(id)
  );

DROP POLICY IF EXISTS montaza_read_jobs ON public.jobs;
CREATE POLICY montaza_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'::public.user_role
    AND public.rls_job_visible_to_montaza_team(id)
  );

DROP POLICY IF EXISTS teren_read_jobs ON public.jobs;
CREATE POLICY teren_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'teren'::public.user_role
    AND public.rls_job_visible_to_teren_team(id)
  );

DROP POLICY IF EXISTS production_read_customers ON public.customers;
CREATE POLICY production_read_customers ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'::public.user_role
    AND public.rls_customer_visible_to_production_team(id)
  );

DROP POLICY IF EXISTS montaza_read_customers ON public.customers;
CREATE POLICY montaza_read_customers ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'::public.user_role
    AND public.rls_customer_visible_to_montaza_team(id)
  );

DROP POLICY IF EXISTS teren_read_customers ON public.customers;
CREATE POLICY teren_read_customers ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'teren'::public.user_role
    AND public.rls_customer_visible_to_teren_team(id)
  );
