-- Montaža/Teren: aktivnosti su vezane za job_id; polise su filtrirale work_orders po tipu,
-- pa INSERT (npr. posle terenskog izveštaja) nije prolazio kad tim radi i druge tipove RN.
-- Usklađujemo sa poslovima na kojima tim ima bilo koji radni nalog.

DROP POLICY IF EXISTS montaza_activities_select ON public.activities;
DROP POLICY IF EXISTS montaza_activities_insert ON public.activities;
DROP POLICY IF EXISTS montaza_activities_update ON public.activities;
DROP POLICY IF EXISTS teren_activities_select ON public.activities;
DROP POLICY IF EXISTS teren_activities_insert ON public.activities;
DROP POLICY IF EXISTS teren_activities_update ON public.activities;

CREATE POLICY montaza_activities_select ON public.activities
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY montaza_activities_insert ON public.activities
  FOR INSERT TO authenticated
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY montaza_activities_update ON public.activities
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY teren_activities_select ON public.activities
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY teren_activities_insert ON public.activities
  FOR INSERT TO authenticated
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY teren_activities_update ON public.activities
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );
