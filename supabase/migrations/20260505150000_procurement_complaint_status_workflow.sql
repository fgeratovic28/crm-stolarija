-- Workflow statusa reklamacije nabavke + RPC za izmenu (umesto jednog „Reši”).

UPDATE public.procurement_complaints
SET status = 'resolved_items_replaced'
WHERE status = 'resolved';

UPDATE public.procurement_complaints
SET status = 'urgent_pending'
WHERE status NOT IN (
  'urgent_pending',
  'awaiting_supplier_response',
  'refunded_credit_note',
  'resolved_items_replaced'
);

ALTER TABLE public.procurement_complaints
  DROP CONSTRAINT IF EXISTS procurement_complaints_status_allowed;

ALTER TABLE public.procurement_complaints
  ADD CONSTRAINT procurement_complaints_status_allowed CHECK (
    status IN (
      'urgent_pending',
      'awaiting_supplier_response',
      'refunded_credit_note',
      'resolved_items_replaced'
    )
  );

COMMENT ON COLUMN public.procurement_complaints.status IS
  'urgent_pending | awaiting_supplier_response | refunded_credit_note | resolved_items_replaced';

DROP FUNCTION IF EXISTS public.resolve_procurement_complaint(uuid);

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
  RETURN n > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.update_procurement_complaint_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_procurement_complaint_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_procurement_complaint_status(uuid, text) TO service_role;
