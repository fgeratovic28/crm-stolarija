-- Ažuriranje RPC-ja da automatski menja delivery_status narudžbine
-- kada su sve reklamacije za tu narudžbinu rešene.

CREATE OR REPLACE FUNCTION public.update_procurement_complaint_status(
  p_complaint_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n int;
  v_order_id uuid;
  v_active_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Morate biti prijavljeni';
  END IF;
  IF public.get_current_user_role() IS NULL
     OR public.get_current_user_role() NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
    RAISE EXCEPTION 'Nemate dozvolu';
  END IF;

  IF p_status IS NULL OR trim(p_status) = '' THEN
    RAISE EXCEPTION 'Status je obavezan';
  END IF;

  IF trim(p_status) NOT IN (
    'urgent_pending',
    'awaiting_supplier_response',
    'refunded_credit_note',
    'resolved_items_replaced'
  ) THEN
    RAISE EXCEPTION 'Nepoznat status reklamacije';
  END IF;

  UPDATE public.procurement_complaints
  SET status = trim(p_status)
  WHERE id = p_complaint_id;

  GET DIAGNOSTICS n = ROW_COUNT;

  IF n > 0 THEN
    SELECT order_id INTO v_order_id
    FROM public.procurement_complaints
    WHERE id = p_complaint_id;

    IF v_order_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_active_count
      FROM public.procurement_complaints
      WHERE order_id = v_order_id
        AND status IN ('urgent_pending', 'awaiting_supplier_response');

      IF v_active_count = 0 THEN
        UPDATE public.material_orders
        SET delivery_status = 'materials_received'
        WHERE id = v_order_id
          AND delivery_status = 'received_with_issues';
      END IF;
    END IF;
  END IF;

  RETURN n > 0;
END;
$fn$;
