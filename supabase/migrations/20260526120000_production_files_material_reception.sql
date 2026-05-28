-- Prijem materijala (magacin / uloga production): slike oštećenja idu u `files` sa
-- category = supplier i material_order_id (vidi ItemReceptionModal).
-- Postojeća politika production_files dozvoljava samo category = work_order, pa INSERT pada na RLS.

DROP POLICY IF EXISTS production_material_order_supplier_files_select ON public.files;
CREATE POLICY production_material_order_supplier_files_select ON public.files
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'::public.user_role
    AND material_order_id IS NOT NULL
    AND category = 'supplier'::public.file_category
  );

DROP POLICY IF EXISTS production_material_order_supplier_files_insert ON public.files;
CREATE POLICY production_material_order_supplier_files_insert ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'production'::public.user_role
    AND material_order_id IS NOT NULL
    AND category = 'supplier'::public.file_category
  );

-- Brisanje samo sopstvenih otpremanja (ne dira nabavčeve priloge iste narudžbine).
DROP POLICY IF EXISTS production_material_order_supplier_files_delete_own ON public.files;
CREATE POLICY production_material_order_supplier_files_delete_own ON public.files
  FOR DELETE TO authenticated
  USING (
    public.get_current_user_role() = 'production'::public.user_role
    AND material_order_id IS NOT NULL
    AND category = 'supplier'::public.file_category
    AND uploaded_by IS NOT DISTINCT FROM auth.uid()
  );

COMMENT ON POLICY production_material_order_supplier_files_select ON public.files IS
  'Magacin (production): pregled prilog uz narudžbinu materijala (supplier + material_order_id), npr. fotografije prijema.';
COMMENT ON POLICY production_material_order_supplier_files_insert ON public.files IS
  'Magacin: otpremanje slika pri prijemu stavke (supplier + material_order_id).';
COMMENT ON POLICY production_material_order_supplier_files_delete_own ON public.files IS
  'Magacin: brisanje samo fajlova koje je isti korisnik otpremio (uploaded_by = auth.uid()).';
