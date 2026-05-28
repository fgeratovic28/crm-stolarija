-- Nabavka menja material_orders, pa klijent beleži promenu u activities (upsertSystemActivity).
-- Bez ove politike INSERT u activities pada sa 42501 za ulogu procurement.

DROP POLICY IF EXISTS procurement_all_activities ON public.activities;

CREATE POLICY procurement_all_activities ON public.activities
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'procurement'::public.user_role)
  WITH CHECK (public.get_current_user_role() = 'procurement'::public.user_role);

COMMENT ON POLICY procurement_all_activities ON public.activities IS
  'Procurement: CRUD na activities (isto kao office) — potrebno za automatske zapise posle izmene isporuke / narudžbine.';
