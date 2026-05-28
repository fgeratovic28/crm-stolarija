-- Porudžbina po nedostatku se sada može zatvoriti i preko refundacije reklamacija:
-- ako su sve reklamacije povezane sa shortage linijama u terminalnom statusu
-- (`resolved_received` ili `canceled_refunded`), shortage se automatski markira kao
-- završen (`materials_received`). UI onda razlikuje „Refundirano" vs „Nadoknada primljena".

CREATE OR REPLACE FUNCTION public.maybe_close_shortage_for_complaint(p_complaint_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_shortage record;
  v_pending_count int;
BEGIN
  IF p_complaint_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_shortage IN
    SELECT mo.id, mo.delivery_status, coalesce(mo.nb_lines, '[]'::jsonb) AS lines
    FROM public.material_orders mo
    WHERE mo.is_shortage_order = true
      AND mo.delivery_status IS DISTINCT FROM 'materials_received'::public.delivery_status
      AND mo.delivery_status IS DISTINCT FROM 'received_with_issues'::public.delivery_status
      AND mo.nb_lines IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(mo.nb_lines, '[]'::jsonb)) AS line
        WHERE (line->'shortage_source'->>'complaint_id') = p_complaint_id::text
      )
  LOOP
    SELECT COUNT(*) INTO v_pending_count
    FROM jsonb_array_elements(v_shortage.lines) AS line
    INNER JOIN public.procurement_complaints pc
      ON pc.id = (line->'shortage_source'->>'complaint_id')::uuid
    WHERE pc.status IN ('reported_issue', 'awaiting_delivery');

    IF v_pending_count = 0 THEN
      UPDATE public.material_orders
      SET delivery_status = 'materials_received'::public.delivery_status,
          delivered_ok = true,
          delivery_date = coalesce(delivery_date, CURRENT_DATE)
      WHERE id = v_shortage.id;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.maybe_close_shortage_for_complaint(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.maybe_close_shortage_for_complaint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.maybe_close_shortage_for_complaint(uuid) TO service_role;

COMMENT ON FUNCTION public.maybe_close_shortage_for_complaint(uuid) IS
  'Zatvori Porudžbinu po nedostatku ako su sve njene linije vezane za terminalne reklamacije (refundirano ili primljeno).';

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
  v_job_id uuid;
  v_normalized text;
  v_previous_status text;
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

  v_normalized := trim(p_status);
  IF v_normalized NOT IN (
    'reported_issue',
    'awaiting_delivery',
    'canceled_refunded',
    'resolved_received'
  ) THEN
    RAISE EXCEPTION 'Nepoznat status reklamacije';
  END IF;

  SELECT status, order_id
    INTO v_previous_status, v_order_id
  FROM public.procurement_complaints
  WHERE id = p_complaint_id;

  IF v_previous_status IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.procurement_complaints
  SET status = v_normalized,
      resolved_at = CASE
        WHEN v_normalized IN ('resolved_received', 'canceled_refunded') THEN coalesce(resolved_at, now())
        ELSE NULL
      END,
      resolved_by = CASE
        WHEN v_normalized IN ('resolved_received', 'canceled_refunded') THEN coalesce(resolved_by, auth.uid())
        ELSE NULL
      END
  WHERE id = p_complaint_id;

  GET DIAGNOSTICS n = ROW_COUNT;

  IF n > 0 THEN
    IF v_normalized = 'awaiting_delivery' AND v_previous_status IS DISTINCT FROM 'awaiting_delivery' THEN
      BEGIN
        PERFORM public.ensure_shortage_order_for_complaint(p_complaint_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ensure_shortage_order_for_complaint nije uspeo: %', SQLERRM;
      END;
    END IF;

    -- Ako reklamacija pređe u terminalni status, proveri da li shortage može da se zatvori.
    IF v_normalized IN ('resolved_received', 'canceled_refunded')
       AND v_previous_status IS DISTINCT FROM v_normalized THEN
      BEGIN
        PERFORM public.maybe_close_shortage_for_complaint(p_complaint_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'maybe_close_shortage_for_complaint nije uspeo: %', SQLERRM;
      END;
    END IF;

    IF v_order_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_active_count
      FROM public.procurement_complaints
      WHERE order_id = v_order_id
        AND status IN ('reported_issue', 'awaiting_delivery');

      IF v_active_count = 0 THEN
        UPDATE public.material_orders
        SET delivery_status = 'materials_received'
        WHERE id = v_order_id
          AND delivery_status = 'received_with_issues';
      END IF;

      SELECT mo.job_id INTO v_job_id
      FROM public.material_orders mo
      WHERE mo.id = v_order_id;

      IF v_job_id IS NOT NULL THEN
        BEGIN
          PERFORM public.recompute_job_status(v_job_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'recompute_job_status posle promene statusa reklamacije: %', SQLERRM;
        END;
      END IF;
    END IF;
  END IF;

  RETURN n > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.update_procurement_complaint_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_procurement_complaint_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_procurement_complaint_status(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
