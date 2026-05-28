-- Nabavka menja status posla („U proizvodnju”) direktno — nema obradu u nabavci.
DROP POLICY IF EXISTS procurement_update_jobs ON public.jobs;
CREATE POLICY procurement_update_jobs ON public.jobs
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'procurement')
  WITH CHECK (public.get_current_user_role() = 'procurement');

-- Nabavka upravlja radnicima (CRUD + bolovanja).
DROP POLICY IF EXISTS procurement_all_workers ON public.workers;
CREATE POLICY procurement_all_workers ON public.workers
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'procurement')
  WITH CHECK (public.get_current_user_role() = 'procurement');

DROP POLICY IF EXISTS procurement_all_worker_sick_leaves ON public.worker_sick_leaves;
CREATE POLICY procurement_all_worker_sick_leaves ON public.worker_sick_leaves
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'procurement')
  WITH CHECK (public.get_current_user_role() = 'procurement');
