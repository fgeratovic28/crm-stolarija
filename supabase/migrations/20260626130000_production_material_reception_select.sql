-- Magacin (uloga production): SELECT na porudžbinama spremnim za prijem.
-- Osigurava vidljivost statusa „čeka isporuku“ i povezanih tokova (shortage, primljeno sa problemom).

DROP POLICY IF EXISTS production_read_material_orders ON public.material_orders;

CREATE POLICY production_read_material_orders ON public.material_orders
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'production'::public.user_role
    AND (
      delivery_status IN (
        'waiting_for_delivery'::public.delivery_status,
        'received_with_issues'::public.delivery_status,
        'shipped'::public.delivery_status,
        'delivered'::public.delivery_status,
        'partial'::public.delivery_status
      )
      OR (
        is_shortage_order = true
        AND delivery_status IS DISTINCT FROM 'materials_received'::public.delivery_status
      )
    )
  );

COMMENT ON POLICY production_read_material_orders ON public.material_orders IS
  'Magacin (proizvodnja): čeka isporuku, legacy isporuka u tranzitu, primljeno sa problemom, aktivne shortage porudžbine.';
