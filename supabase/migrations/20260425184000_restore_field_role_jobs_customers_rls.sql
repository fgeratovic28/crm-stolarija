-- Restore field-team visibility on jobs/customers after role-matrix reset.
-- Without these SELECT policies, montaza/teren/production users cannot read
-- job/customer data for their assigned work orders (address/phone/map/details).

DROP POLICY IF EXISTS production_read_jobs ON public.jobs;
DROP POLICY IF EXISTS montaza_read_jobs ON public.jobs;
DROP POLICY IF EXISTS teren_read_jobs ON public.jobs;

CREATE POLICY production_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.job_id = public.jobs.id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY montaza_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.job_id = public.jobs.id
        AND w.type = 'installation'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY teren_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.job_id = public.jobs.id
        AND w.type IN ('measurement', 'measurement_verification', 'complaint', 'service', 'site_visit', 'control_visit')
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

DROP POLICY IF EXISTS production_read_customers ON public.customers;
DROP POLICY IF EXISTS montaza_read_customers ON public.customers;
DROP POLICY IF EXISTS teren_read_customers ON public.customers;

CREATE POLICY production_read_customers ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.work_orders w ON w.job_id = j.id
      JOIN public.users u ON u.id = auth.uid()
      WHERE j.customer_id = public.customers.id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY montaza_read_customers ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.work_orders w ON w.job_id = j.id
      JOIN public.users u ON u.id = auth.uid()
      WHERE j.customer_id = public.customers.id
        AND w.type = 'installation'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY teren_read_customers ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.work_orders w ON w.job_id = j.id
      JOIN public.users u ON u.id = auth.uid()
      WHERE j.customer_id = public.customers.id
        AND w.type IN ('measurement', 'measurement_verification', 'complaint', 'service', 'site_visit', 'control_visit')
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );
