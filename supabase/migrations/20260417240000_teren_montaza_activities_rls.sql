-- Teren i Montaža: sistem aktivnosti (npr. posle terenskog izveštaja) upisuje u activities.
-- Do sada su politike postojale samo za admin/office, pa je INSERT padao sa 42501.

CREATE POLICY montaza_activities_select ON public.activities
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT job_id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type = 'installation'
    )
  );

CREATE POLICY montaza_activities_insert ON public.activities
  FOR INSERT TO authenticated
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT job_id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type = 'installation'
    )
  );

CREATE POLICY montaza_activities_update ON public.activities
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT job_id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type = 'installation'
    )
  )
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT job_id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type = 'installation'
    )
  );

CREATE POLICY teren_activities_select ON public.activities
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT job_id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type IN (
          'measurement',
          'measurement_verification',
          'complaint',
          'service',
          'site_visit',
          'control_visit'
        )
    )
  );

CREATE POLICY teren_activities_insert ON public.activities
  FOR INSERT TO authenticated
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT job_id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type IN (
          'measurement',
          'measurement_verification',
          'complaint',
          'service',
          'site_visit',
          'control_visit'
        )
    )
  );

CREATE POLICY teren_activities_update ON public.activities
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT job_id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type IN (
          'measurement',
          'measurement_verification',
          'complaint',
          'service',
          'site_visit',
          'control_visit'
        )
    )
  )
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT job_id FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
        AND type IN (
          'measurement',
          'measurement_verification',
          'complaint',
          'service',
          'site_visit',
          'control_visit'
        )
    )
  );
