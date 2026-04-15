-- Radni nalog mora biti vezan i za posao i za tim.
-- Postojeći podaci ostaju netaknuti, ali novi/izmenjeni redovi moraju imati team_id.
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_team_id_required
  CHECK (team_id IS NOT NULL) NOT VALID;

-- Usklađivanje RLS za timske role: svako vidi/menja samo naloge svog tima,
-- uz eksplicitni WITH CHECK da i insert/update ostanu u okviru sopstvenog tima.
DROP POLICY IF EXISTS production_work_orders ON public.work_orders;
DROP POLICY IF EXISTS montaza_work_orders ON public.work_orders;
DROP POLICY IF EXISTS teren_work_orders ON public.work_orders;

CREATE POLICY production_work_orders ON public.work_orders
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'production'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type IN ('production', 'measurement', 'measurement_verification')
  )
  WITH CHECK (
    get_current_user_role() = 'production'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type IN ('production', 'measurement', 'measurement_verification')
  );

CREATE POLICY montaza_work_orders ON public.work_orders
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type = 'installation'
  )
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type = 'installation'
  );

CREATE POLICY teren_work_orders ON public.work_orders
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type IN (
      'measurement',
      'measurement_verification',
      'complaint',
      'service',
      'site_visit',
      'control_visit'
    )
  )
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    AND type IN (
      'measurement',
      'measurement_verification',
      'complaint',
      'service',
      'site_visit',
      'control_visit'
    )
  );
