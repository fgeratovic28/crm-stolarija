-- Public per-order redirect: QR sa PDF-a (reklamacije / vanredne) vodi na /r/order/:orderId?kind=adhoc|complaint.
-- Magacin (prijavljen) → /order-reception/:orderId; spoljni posetilac → fajl priloga (ad-hoc), inače fallback poruka.

DROP FUNCTION IF EXISTS public.get_procurement_order_public_redirect(uuid, text);
CREATE OR REPLACE FUNCTION public.get_procurement_order_public_redirect(p_order_id uuid, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kind text := lower(coalesce(p_kind, ''));
  v_supplier text;
  v_attachment_url text;
  v_attachment_name text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order ID je obavezan';
  END IF;
  IF v_kind NOT IN ('adhoc', 'complaint') THEN
    v_kind := 'adhoc';
  END IF;

  SELECT mo.supplier
    INTO v_supplier
  FROM public.material_orders mo
  WHERE mo.id = p_order_id
  LIMIT 1;

  IF v_supplier IS NULL THEN
    RAISE EXCEPTION 'Porudzbina nije pronadjena';
  END IF;

  IF v_kind = 'adhoc' THEN
    SELECT f.storage_url, f.filename
      INTO v_attachment_url, v_attachment_name
    FROM public.procurement_ad_hoc_items a
    INNER JOIN public.files f ON f.id = a.attachment_file_id
    WHERE a.order_id = p_order_id
      AND a.attachment_file_id IS NOT NULL
      AND a.status IN ('reported_issue', 'awaiting_delivery')
    ORDER BY a.created_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'kind', v_kind,
    'supplier', v_supplier,
    'attachment_url', v_attachment_url,
    'attachment_name', v_attachment_name
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) TO service_role;

COMMENT ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) IS
  'Public redirect: vraca podatke porudžbine + (za ad-hoc) URL prvog priloga pending stavke. Koristi se na /r/order/:orderId.';
