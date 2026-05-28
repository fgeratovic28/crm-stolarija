-- Finansije i nabavka vide RN (SELECT) radi kontrolne table / banera i doslednosti sa pristupom poslovima.
-- Kancelarija i admin već imaju politike na work_orders.

DROP POLICY IF EXISTS finance_read_work_orders_select ON public.work_orders;
CREATE POLICY finance_read_work_orders_select ON public.work_orders
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'finance'::public.user_role);

DROP POLICY IF EXISTS procurement_read_work_orders_select ON public.work_orders;
CREATE POLICY procurement_read_work_orders_select ON public.work_orders
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'procurement'::public.user_role);
