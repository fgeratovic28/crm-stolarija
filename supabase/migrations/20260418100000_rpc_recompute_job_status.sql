-- Server-side recompute so auto status works for all roles (RLS would otherwise block
-- client-side UPDATE on jobs for procurement/production/etc., causing 0 rows updated
-- with no error).

CREATE OR REPLACE FUNCTION public.recompute_job_status(p_job_id uuid)
RETURNS TABLE (
  did_update boolean,
  previous_status job_status,
  next_status job_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_current job_status;
  v_locked boolean;
  v_next job_status;
  v_all_wo_completed boolean;
  v_has_in_progress boolean;
  v_has_pending boolean;
  v_has_materials boolean;
  v_has_blocking_mat boolean;
  v_wo_count int;
BEGIN
  SELECT j.status, COALESCE(j.status_locked, false)
  INTO v_current, v_locked
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found: %', p_job_id;
  END IF;

  IF v_locked OR v_current IN ('complaint'::job_status, 'service'::job_status) THEN
    RETURN QUERY SELECT false, v_current, v_current;
    RETURN;
  END IF;

  SELECT COUNT(*)::int INTO v_wo_count FROM public.work_orders w WHERE w.job_id = p_job_id;

  v_all_wo_completed := v_wo_count > 0 AND NOT EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.status IS DISTINCT FROM 'completed'::work_order_status
  );

  v_has_in_progress := EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.status = 'in_progress'::work_order_status
  );

  v_has_pending := EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.status = 'pending'::work_order_status
  );

  v_has_materials := EXISTS (
    SELECT 1 FROM public.material_orders m WHERE m.job_id = p_job_id
  );

  v_has_blocking_mat := EXISTS (
    SELECT 1 FROM public.material_orders m
    WHERE m.job_id = p_job_id AND m.delivery_status IS DISTINCT FROM 'delivered'::delivery_status
  );

  IF v_all_wo_completed THEN
    v_next := 'completed'::job_status;
  ELSIF v_has_in_progress THEN
    v_next := 'in_progress'::job_status;
  ELSIF v_has_pending AND v_has_blocking_mat THEN
    v_next := 'waiting_materials'::job_status;
  ELSIF v_has_pending THEN
    v_next := 'active'::job_status;
  ELSIF v_has_materials AND v_has_blocking_mat THEN
    v_next := 'waiting_materials'::job_status;
  ELSIF v_has_materials THEN
    v_next := 'active'::job_status;
  ELSE
    v_next := v_current;
  END IF;

  IF v_next IS NOT DISTINCT FROM v_current THEN
    RETURN QUERY SELECT false, v_current, v_current;
    RETURN;
  END IF;

  UPDATE public.jobs
  SET status = v_next
  WHERE id = p_job_id;

  RETURN QUERY SELECT true, v_current, v_next;
END;
$func$;

REVOKE ALL ON FUNCTION public.recompute_job_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_job_status(uuid) TO authenticated;
