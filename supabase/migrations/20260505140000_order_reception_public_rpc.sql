-- Javni pregled prijema (bez prijave) + rešavanje reklamacije nabavke.

CREATE OR REPLACE FUNCTION public.get_material_order_reception_public(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', mo.id,
    'deliveryStatus', mo.delivery_status::text,
    'materialType', mo.material_type::text,
    'supplier', COALESCE(s.name, mo.supplier, ''),
    'supplierContact', COALESCE(s.contact_person, mo.supplier_contact, ''),
    'requestDate', mo.request_date::text,
    'expectedDelivery', mo.expected_delivery_date::text,
    'notes', mo.notes,
    'jobNumber', j.job_number,
    'nbLines', mo.nb_lines
  )
  FROM public.material_orders mo
  LEFT JOIN public.suppliers s ON s.id = mo.supplier_id
  LEFT JOIN public.jobs j ON j.id = mo.job_id
  WHERE mo.id = p_order_id;
$$;

COMMENT ON FUNCTION public.get_material_order_reception_public(uuid) IS
  'Bezbedan JSON za javni pregled stranice prijema (bez cena); anon + ulogovani.';

REVOKE ALL ON FUNCTION public.get_material_order_reception_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_material_order_reception_public(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_material_order_reception_public(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_material_order_reception_public(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_procurement_complaint(p_complaint_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Morate biti prijavljeni';
  END IF;
  IF public.get_current_user_role() IS NULL
     OR public.get_current_user_role() NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
    RAISE EXCEPTION 'Nemate dozvolu';
  END IF;

  UPDATE public.procurement_complaints
  SET status = 'resolved'
  WHERE id = p_complaint_id
    AND status = 'urgent_pending';

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_procurement_complaint(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_procurement_complaint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_procurement_complaint(uuid) TO service_role;
