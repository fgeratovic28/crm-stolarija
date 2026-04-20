-- Teren/Montaža: izveštaji samo za radne naloge dodeljene istom timu kao korisnik.
-- Eksplicitno: users.team_id mora biti postavljen i mora da se poklapa sa work_orders.team_id.

DROP POLICY IF EXISTS montaza_field_reports ON public.field_reports;
DROP POLICY IF EXISTS teren_field_reports ON public.field_reports;

CREATE POLICY montaza_field_reports ON public.field_reports
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = work_order_id
        AND wo.team_id = (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = work_order_id
        AND wo.team_id = (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY teren_field_reports ON public.field_reports
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = work_order_id
        AND wo.team_id = (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = work_order_id
        AND wo.team_id = (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );
