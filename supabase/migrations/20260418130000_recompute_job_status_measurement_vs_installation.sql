-- Posao je "Završen" tek kada je završena ugradnja (tip installation), ne posle merenja.
-- Posle merenja/kontrole mera → scheduled (čeka montažu), ako nema drugih blokirajućih naloga.

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
  v_has_materials boolean;
  v_has_blocking_mat boolean;
  v_any_in_progress boolean;
  v_has_any_pending boolean;
  v_has_non_install_pending boolean;
  v_has_meas boolean;
  v_meas_phase_done boolean;
  v_has_inst boolean;
  v_inst_job_done boolean;
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

  v_has_materials := EXISTS (
    SELECT 1 FROM public.material_orders m WHERE m.job_id = p_job_id
  );

  v_has_blocking_mat := EXISTS (
    SELECT 1 FROM public.material_orders m
    WHERE m.job_id = p_job_id AND m.delivery_status IS DISTINCT FROM 'delivered'::delivery_status
  );

  v_any_in_progress := EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.status = 'in_progress'::work_order_status
  );

  v_has_any_pending := EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.status = 'pending'::work_order_status
  );

  v_has_non_install_pending := EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IS DISTINCT FROM 'installation'::work_order_type
      AND w.status = 'pending'::work_order_status
  );

  v_has_meas := EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'measurement'::work_order_type,
        'measurement_verification'::work_order_type
      )
  );

  v_meas_phase_done := v_has_meas AND NOT EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'measurement'::work_order_type,
        'measurement_verification'::work_order_type
      )
      AND w.status NOT IN ('completed'::work_order_status, 'canceled'::work_order_status)
  );

  v_has_inst := EXISTS (
    SELECT 1 FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.type = 'installation'::work_order_type
  );

  v_inst_job_done := v_has_inst
    AND NOT EXISTS (
      SELECT 1 FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::work_order_type
        AND w.status NOT IN ('completed'::work_order_status, 'canceled'::work_order_status)
    )
    AND EXISTS (
      SELECT 1 FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::work_order_type
        AND w.status = 'completed'::work_order_status
    );

  IF v_inst_job_done THEN
    v_next := 'completed'::job_status;
  ELSIF v_any_in_progress THEN
    v_next := 'in_progress'::job_status;
  ELSIF (v_has_any_pending AND v_has_blocking_mat)
    OR (NOT v_has_any_pending AND v_has_materials AND v_has_blocking_mat) THEN
    v_next := 'waiting_materials'::job_status;
  ELSIF v_has_any_pending THEN
    IF v_meas_phase_done AND NOT v_inst_job_done AND NOT v_has_non_install_pending THEN
      v_next := 'scheduled'::job_status;
    ELSE
      v_next := 'active'::job_status;
    END IF;
  ELSIF v_has_materials AND v_has_blocking_mat THEN
    v_next := 'waiting_materials'::job_status;
  ELSIF v_has_materials THEN
    v_next := 'active'::job_status;
  ELSIF v_meas_phase_done AND NOT v_inst_job_done AND NOT v_any_in_progress THEN
    v_next := 'scheduled'::job_status;
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
