-- Radni nalozi za montažu/teren su od 20260414195500 vidljivi celom timu (bez filtera po type),
-- ali su polise na field_reports i dalje zahtevale "svoj" tip naloga — INSERT je padao sa 42501
-- iako korisnik vidi radni nalog. Usklađujemo opseg sa work_orders (samo tim).

DROP POLICY IF EXISTS montaza_field_reports ON public.field_reports;
DROP POLICY IF EXISTS teren_field_reports ON public.field_reports;

CREATE POLICY montaza_field_reports ON public.field_reports
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND work_order_id IN (
      SELECT id
      FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    get_current_user_role() = 'montaza'
    AND work_order_id IN (
      SELECT id
      FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    )
  );

CREATE POLICY teren_field_reports ON public.field_reports
  FOR ALL TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND work_order_id IN (
      SELECT id
      FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    get_current_user_role() = 'teren'
    AND work_order_id IN (
      SELECT id
      FROM public.work_orders
      WHERE team_id IN (SELECT team_id FROM public.users WHERE id = auth.uid())
    )
  );
