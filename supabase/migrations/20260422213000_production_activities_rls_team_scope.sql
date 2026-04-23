-- Production tim mora da može da upiše sistemske aktivnosti (npr. posle čuvanja izveštaja),
-- ali samo za poslove na kojima je dodeljen njihov tim kroz production radni nalog.

DROP POLICY IF EXISTS production_activities_select ON public.activities;
DROP POLICY IF EXISTS production_activities_insert ON public.activities;
DROP POLICY IF EXISTS production_activities_update ON public.activities;

CREATE POLICY production_activities_select ON public.activities
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'production'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.type = 'production'
        AND wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY production_activities_insert ON public.activities
  FOR INSERT TO authenticated
  WITH CHECK (
    get_current_user_role() = 'production'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.type = 'production'
        AND wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY production_activities_update ON public.activities
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'production'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.type = 'production'
        AND wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    get_current_user_role() = 'production'
    AND job_id IN (
      SELECT wo.job_id
      FROM public.work_orders wo
      WHERE wo.type = 'production'
        AND wo.team_id IN (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );
