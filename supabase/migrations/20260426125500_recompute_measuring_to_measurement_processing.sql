-- Fix: kada je posao u "Merenje" i merni RN su završeni, status mora preći u "Obrada mera".
-- Ovo osigurava tranziciju i za role koje zbog RLS ne mogu direktno da UPDATE-uju jobs sa klijenta.

CREATE OR REPLACE FUNCTION public.recompute_job_status(p_job_id uuid)
RETURNS TABLE (
  did_update boolean,
  previous_status public.job_status,
  next_status public.job_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_current public.job_status;
  v_locked boolean;
  v_next public.job_status;
  v_has_meas boolean;
  v_meas_unfinished boolean;
  v_meas_phase_done boolean;
  v_measurement_completed boolean;
  v_meas_in_progress boolean;
  v_has_prod boolean;
  v_prod_unfinished boolean;
  v_prod_done boolean;
  v_prod_done_effective boolean;
  v_has_inst boolean;
  v_inst_unfinished boolean;
  v_inst_job_done boolean;
  v_inst_in_progress boolean;
  v_install_all_pending boolean;
  v_scheduled boolean;
  v_in_production boolean;
  v_bad_install_report boolean;
  v_has_accepted_quote boolean;
  v_has_material_order boolean;
  v_all_materials_delivered boolean;
BEGIN
  SELECT j.status, COALESCE(j.status_locked, false)
  INTO v_current, v_locked
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found: %', p_job_id;
  END IF;

  IF v_locked OR v_current IN (
    'service'::public.job_status,
    'quote_sent'::public.job_status
  ) THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (early exit): %', SQLERRM;
    END;
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  IF v_current = 'complaint'::public.job_status THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (complaint exit): %', SQLERRM;
    END;
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  v_has_meas := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'measurement'::public.work_order_type,
        'measurement_verification'::public.work_order_type
      )
  );

  v_meas_unfinished := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'measurement'::public.work_order_type,
        'measurement_verification'::public.work_order_type
      )
      AND w.status NOT IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status)
  );

  v_has_prod := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.type = 'production'::public.work_order_type
  );

  v_meas_phase_done :=
    (v_has_meas AND NOT v_meas_unfinished)
    OR ((NOT v_has_meas) AND v_has_prod);

  v_measurement_completed := v_has_meas AND NOT v_meas_unfinished;

  v_meas_in_progress := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'measurement'::public.work_order_type,
        'measurement_verification'::public.work_order_type
      )
      AND w.status = 'in_progress'::public.work_order_status
  );

  v_prod_unfinished := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'production'::public.work_order_type
      AND w.status NOT IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status)
  );

  v_prod_done :=
    v_has_prod
    AND NOT v_prod_unfinished
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'production'::public.work_order_type
        AND w.status = 'completed'::public.work_order_status
    );

  v_prod_done_effective := (NOT v_has_prod) OR v_prod_done;

  v_has_inst := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.type = 'installation'::public.work_order_type
  );

  v_inst_unfinished := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status NOT IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status)
  );

  v_inst_job_done :=
    v_has_inst
    AND NOT v_inst_unfinished
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status = 'completed'::public.work_order_status
    );

  v_inst_in_progress := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'in_progress'::public.work_order_status
  );

  v_install_all_pending :=
    v_has_inst
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status IS DISTINCT FROM 'pending'::public.work_order_status
    );

  v_has_accepted_quote := EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.job_id = p_job_id
      AND q.status = 'accepted'::public.quote_status
  );

  v_has_material_order := EXISTS (
    SELECT 1
    FROM public.material_orders mo
    WHERE mo.job_id = p_job_id
  );

  v_all_materials_delivered :=
    v_has_material_order
    AND NOT EXISTS (
      SELECT 1
      FROM public.material_orders mo
      WHERE mo.job_id = p_job_id
        AND COALESCE(mo.delivery_status::text, '') <> 'delivered'
    );

  v_scheduled :=
    v_meas_phase_done
    AND v_prod_done_effective
    AND (
      (v_has_inst AND v_install_all_pending)
      OR ((NOT v_has_inst) AND v_has_prod AND v_prod_done)
    );

  v_in_production :=
    v_meas_phase_done
    AND (NOT v_has_material_order OR v_all_materials_delivered)
    AND NOT v_meas_in_progress
    AND NOT v_scheduled
    AND NOT v_inst_in_progress
    AND NOT v_inst_job_done;

  v_bad_install_report := EXISTS (
    SELECT 1
    FROM public.field_reports fr
    INNER JOIN public.work_orders w ON w.id = fr.work_order_id
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
      AND fr.everything_ok IS FALSE
  );

  IF v_inst_job_done THEN
    IF v_bad_install_report THEN
      v_next := 'complaint'::public.job_status;
    ELSE
      v_next := 'completed'::public.job_status;
    END IF;
  ELSIF v_inst_in_progress THEN
    v_next := 'installation_in_progress'::public.job_status;
  ELSIF v_has_meas AND NOT v_meas_phase_done THEN
    v_next := 'measuring'::public.job_status;
  ELSIF v_current = 'measuring'::public.job_status AND v_measurement_completed THEN
    v_next := 'measurement_processing'::public.job_status;
  ELSIF v_measurement_completed AND NOT v_has_accepted_quote THEN
    v_next := 'measurement_processing'::public.job_status;
  ELSIF v_measurement_completed AND v_has_material_order AND NOT v_all_materials_delivered THEN
    v_next := 'waiting_material'::public.job_status;
  ELSIF v_measurement_completed AND v_has_accepted_quote AND NOT v_has_material_order THEN
    v_next := 'ready_for_work'::public.job_status;
  ELSIF v_scheduled THEN
    v_next := 'scheduled'::public.job_status;
  ELSIF v_in_production THEN
    v_next := 'in_production'::public.job_status;
  ELSE
    v_next := 'new'::public.job_status;
  END IF;

  IF v_next IS NOT DISTINCT FROM v_current THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (no status change): %', SQLERRM;
    END;
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  UPDATE public.jobs
  SET status = v_next
  WHERE id = p_job_id;

  BEGIN
    PERFORM public.ensure_workflow_work_orders(p_job_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ensure_workflow_work_orders (after status update): %', SQLERRM;
  END;

  RETURN QUERY VALUES (true::boolean, v_current::public.job_status, v_next::public.job_status);
END;
$func$;

REVOKE ALL ON FUNCTION public.recompute_job_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_job_status(uuid) TO authenticated;
