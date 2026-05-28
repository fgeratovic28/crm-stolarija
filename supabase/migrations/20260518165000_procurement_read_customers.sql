CREATE POLICY procurement_read_customers ON public.customers
  FOR SELECT
  TO authenticated
  USING (get_current_user_role() = 'procurement');
