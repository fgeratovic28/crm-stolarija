-- Timske uloge treba da vide sve naloge svog tima, bez filtriranja po tipu.
-- Zadržavamo ograničenje po timu i read-only pravilo iz ranijih migracija.

DROP POLICY IF EXISTS montaza_work_orders ON public.work_orders;
DROP POLICY IF EXISTS teren_work_orders ON public.work_orders;
DROP POLICY IF EXISTS montaza_work_orders_select ON public.work_orders;
DROP POLICY IF EXISTS montaza_work_orders_update_status ON public.work_orders;
DROP POLICY IF EXISTS teren_work_orders_select ON public.work_orders;
DROP POLICY IF EXISTS teren_work_orders_update_status ON public.work_orders;

CREATE POLICY montaza_work_orders_select ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY montaza_work_orders_update_status ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY teren_work_orders_select ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY teren_work_orders_update_status ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
  )
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS montaza_read_jobs ON public.jobs;
DROP POLICY IF EXISTS teren_read_jobs ON public.jobs;

CREATE POLICY montaza_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND id IN (
      SELECT job_id
      FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    )
  );

CREATE POLICY teren_read_jobs ON public.jobs
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND id IN (
      SELECT job_id
      FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    )
  );
