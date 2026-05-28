ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_work_orders ON public.work_orders;
CREATE POLICY office_work_orders ON public.work_orders
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'office'::public.user_role)
  WITH CHECK (public.get_current_user_role() = 'office'::public.user_role);
