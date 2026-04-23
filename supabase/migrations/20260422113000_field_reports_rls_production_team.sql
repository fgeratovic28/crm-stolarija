-- Proizvodnja: izveštaji samo za proizvodne naloge dodeljene istom timu kao korisnik.
-- Obezbeđuje da korisnik production ne može upisivati/čitati field_reports van svog tima.

DROP POLICY IF EXISTS production_field_reports ON public.field_reports;

CREATE POLICY production_field_reports ON public.field_reports
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'production'
    AND (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = work_order_id
        AND wo.type = 'production'::public.work_order_type
        AND wo.team_id = (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    get_current_user_role() = 'production'
    AND (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = work_order_id
        AND wo.type = 'production'::public.work_order_type
        AND wo.team_id = (SELECT u.team_id FROM public.users u WHERE u.id = auth.uid())
    )
  );
