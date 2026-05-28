-- Reset and align key RLS policies with the requested role matrix:
-- admin: full access
-- office: full sales + finance data
-- finance: customers + jobs + payments
-- procurement: suppliers + material orders + vehicles
-- production/montaza/teren: only own work orders and own field reports

DO $$
DECLARE
  policy_rec RECORD;
BEGIN
  FOR policy_rec IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'customers',
        'jobs',
        'payments',
        'material_orders',
        'suppliers',
        'vehicles',
        'work_orders',
        'field_reports'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I;',
      policy_rec.policyname,
      policy_rec.tablename
    );
  END LOOP;
END
$$;

-- customers
CREATE POLICY admin_all_customers ON public.customers
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY office_all_customers ON public.customers
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'office')
  WITH CHECK (public.get_current_user_role() = 'office');

CREATE POLICY finance_read_customers ON public.customers
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'finance');

-- jobs
CREATE POLICY admin_all_jobs ON public.jobs
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY office_all_jobs ON public.jobs
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'office')
  WITH CHECK (public.get_current_user_role() = 'office');

CREATE POLICY finance_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'finance');

CREATE POLICY procurement_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'procurement');

-- payments (finansije)
CREATE POLICY admin_all_payments ON public.payments
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY office_all_payments ON public.payments
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'office')
  WITH CHECK (public.get_current_user_role() = 'office');

CREATE POLICY finance_all_payments ON public.payments
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'finance')
  WITH CHECK (public.get_current_user_role() = 'finance');

-- material_orders
CREATE POLICY admin_all_material_orders ON public.material_orders
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY procurement_all_material_orders ON public.material_orders
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'procurement')
  WITH CHECK (public.get_current_user_role() = 'procurement');

-- suppliers
CREATE POLICY admin_all_suppliers ON public.suppliers
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY procurement_all_suppliers ON public.suppliers
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'procurement')
  WITH CHECK (public.get_current_user_role() = 'procurement');

-- vehicles
CREATE POLICY admin_all_vehicles ON public.vehicles
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY procurement_all_vehicles ON public.vehicles
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'procurement')
  WITH CHECK (public.get_current_user_role() = 'procurement');

-- work_orders
CREATE POLICY admin_all_work_orders ON public.work_orders
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY office_read_work_orders ON public.work_orders
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'office');

CREATE POLICY production_own_work_orders ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'
    AND type = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  );

CREATE POLICY production_update_own_work_orders ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'production'
    AND type = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'production'
    AND type = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  );

CREATE POLICY montaza_own_work_orders ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  );

CREATE POLICY montaza_update_own_work_orders ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  );

CREATE POLICY teren_own_work_orders ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  );

CREATE POLICY teren_update_own_work_orders ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = public.work_orders.team_id
    )
  );

-- field_reports
CREATE POLICY admin_all_field_reports ON public.field_reports
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY office_read_field_reports ON public.field_reports
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'office');

CREATE POLICY production_own_field_reports ON public.field_reports
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY production_insert_own_field_reports ON public.field_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY production_update_own_field_reports ON public.field_reports
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'production'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND w.type = 'production'
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY montaza_own_field_reports ON public.field_reports
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY montaza_insert_own_field_reports ON public.field_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY montaza_update_own_field_reports ON public.field_reports
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'montaza'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY teren_own_field_reports ON public.field_reports
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY teren_insert_own_field_reports ON public.field_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );

CREATE POLICY teren_update_own_field_reports ON public.field_reports
  FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  )
  WITH CHECK (
    public.get_current_user_role() = 'teren'
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      JOIN public.users u ON u.id = auth.uid()
      WHERE w.id = public.field_reports.work_order_id
        AND u.active IS TRUE
        AND u.team_id IS NOT NULL
        AND u.team_id = w.team_id
    )
  );
