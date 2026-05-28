-- Posle prihvatanja finalne ponude posle merenja: status „Finalna ponuda prihvaćena / Čeka uplatu“
-- dok nema evidentirane uplate posle prihvatanja; zatim „Spremno za rad“.
-- Ispravlja regresiju u 20260516200000 gde je posao bez narudžbine materijala odmah
-- prelazio u ready_for_work bez uplate.
-- Poslata finalna ponuda u post-mernom ciklusu → final_quote_sent, čak i ako postoji
-- starija prihvaćena ponuda van tog ciklusa (npr. početna pre merenja).

ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'final_quote_accepted_pending_payment';

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
  v_has_accepted_quote boolean;
  v_has_material_order boolean;
  v_all_materials_delivered boolean;
  v_has_active_procurement_complaints boolean;
  v_has_active_shortage_orders boolean;
  v_post_measurement_keep_initial boolean;
  v_meas_finished_at timestamptz;
  v_post_meas_quote_accepted boolean;
  v_post_meas_quote_sent boolean;
  v_accept_anchor timestamptz;
  v_ready_for_work_ok boolean;
BEGIN
  SELECT j.status, COALESCE(j.status_locked, false), COALESCE(j.post_measurement_keep_initial_quote, false)
  INTO v_current, v_locked, v_post_measurement_keep_initial
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found: %', p_job_id;
  END IF;

  IF v_locked OR v_current IN (
    'service'::public.job_status,
    'quote_sent'::public.job_status,
    'final_quote_sent'::public.job_status
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

  IF v_current = 'installation_problem'::public.job_status THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (installation_problem exit): %', SQLERRM;
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
        AND NOT public.material_order_delivery_resolved(mo.delivery_status)
    );

  v_has_active_procurement_complaints := public.job_has_active_procurement_complaints(p_job_id);
  v_has_active_shortage_orders := public.job_has_active_shortage_orders(p_job_id);

  SELECT MAX(fr.created_at)
  INTO v_meas_finished_at
  FROM public.field_reports fr
  INNER JOIN public.work_orders w ON w.id = fr.work_order_id
  WHERE w.job_id = p_job_id
    AND w.type IN (
      'measurement'::public.work_order_type,
      'measurement_verification'::public.work_order_type
    )
    AND fr.completed IS TRUE;

  v_post_meas_quote_accepted := EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.job_id = p_job_id
      AND q.status = 'accepted'::public.quote_status
      AND (
        (v_meas_finished_at IS NOT NULL AND q.created_at >= v_meas_finished_at)
        OR (v_meas_finished_at IS NULL AND COALESCE(q.version_number, 1) > 1)
      )
  );

  v_post_meas_quote_sent := EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.job_id = p_job_id
      AND q.status = 'sent'::public.quote_status
      AND (
        (v_meas_finished_at IS NOT NULL AND q.created_at >= v_meas_finished_at)
        OR (v_meas_finished_at IS NULL AND COALESCE(q.version_number, 1) > 1)
      )
  );

  v_accept_anchor := NULL;
  IF v_post_meas_quote_accepted THEN
    SELECT MAX(GREATEST(COALESCE(q.updated_at, q.created_at), q.created_at))
    INTO v_accept_anchor
    FROM public.quotes q
    WHERE q.job_id = p_job_id
      AND q.status = 'accepted'::public.quote_status
      AND (
        (v_meas_finished_at IS NOT NULL AND q.created_at >= v_meas_finished_at)
        OR (v_meas_finished_at IS NULL AND COALESCE(q.version_number, 1) > 1)
      );
  END IF;

  IF v_post_measurement_keep_initial AND v_meas_finished_at IS NOT NULL THEN
    IF v_accept_anchor IS NULL THEN
      v_accept_anchor := v_meas_finished_at;
    ELSE
      v_accept_anchor := GREATEST(v_accept_anchor, v_meas_finished_at);
    END IF;
  END IF;

  v_ready_for_work_ok :=
    (v_post_meas_quote_accepted OR v_post_measurement_keep_initial)
    AND v_accept_anchor IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.job_id = p_job_id
        AND COALESCE(p.amount, 0) > 0
        AND COALESCE(p.created_at, (p.date::timestamp + interval '12 hours')) >= v_accept_anchor
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
    AND (
      NOT v_has_material_order
      OR (
        v_all_materials_delivered
        AND NOT v_has_active_procurement_complaints
        AND NOT v_has_active_shortage_orders
      )
    )
    AND NOT v_meas_in_progress
    AND NOT v_scheduled
    AND NOT v_inst_in_progress
    AND NOT v_inst_job_done;

  IF EXISTS (
    SELECT 1
    FROM public.field_reports fr
    INNER JOIN public.work_orders w ON w.id = fr.work_order_id
    INNER JOIN public.jobs j ON j.id = w.job_id
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
      AND fr.everything_ok IS FALSE
      AND j.first_completed_at IS NULL
  ) THEN
    v_next := 'installation_problem'::public.job_status;
  ELSIF v_inst_job_done THEN
    v_next := 'completed'::public.job_status;
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
  ELSIF v_measurement_completed AND v_has_material_order AND v_all_materials_delivered AND v_has_active_procurement_complaints THEN
    v_next := 'waiting_material'::public.job_status;
  ELSIF v_measurement_completed AND v_has_material_order AND v_all_materials_delivered AND v_has_active_shortage_orders THEN
    v_next := 'waiting_material'::public.job_status;
  ELSIF v_current = 'waiting_material'::public.job_status
      AND v_has_material_order
      AND v_all_materials_delivered
      AND NOT v_has_active_procurement_complaints
      AND NOT v_has_active_shortage_orders
      AND v_meas_phase_done THEN
    v_next := 'in_production'::public.job_status;
  ELSIF v_measurement_completed
        AND v_post_meas_quote_sent
        AND NOT v_post_meas_quote_accepted THEN
    v_next := 'final_quote_sent'::public.job_status;
  ELSIF v_measurement_completed AND v_has_accepted_quote AND NOT v_has_material_order THEN
    IF v_post_meas_quote_accepted OR v_post_measurement_keep_initial THEN
      IF v_ready_for_work_ok THEN
        v_next := 'ready_for_work'::public.job_status;
      ELSE
        v_next := 'final_quote_accepted_pending_payment'::public.job_status;
      END IF;
    ELSE
      v_next := 'measurement_processing'::public.job_status;
    END IF;
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
GRANT EXECUTE ON FUNCTION public.recompute_job_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.run_job_sla_stale_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $sla$
DECLARE
  v_days int;
  inserted int := 0;
BEGIN
  SELECT COALESCE(NULLIF(job_stale_status_days, 0), 7)
  INTO v_days
  FROM public.app_settings
  WHERE id = 1;

  IF v_days IS NULL OR v_days < 1 THEN
    v_days := 7;
  END IF;

  INSERT INTO public.activities (job_id, type, description, date, system_key)
  SELECT
    c.id,
    'other'::public.communication_type,
    '[AUTO] SLA upozorenje: Posao ' || c.job_number
      || ' u statusu «'
      || CASE c.status::text
        WHEN 'new' THEN 'Upit'
        WHEN 'quote_sent' THEN 'Ponuda poslata'
        WHEN 'final_quote_sent' THEN 'Poslata finalna ponuda'
        WHEN 'final_quote_accepted_pending_payment' THEN 'Finalna ponuda prihvaćena / Čeka uplatu'
        WHEN 'measuring' THEN 'Merenje'
        WHEN 'in_production' THEN 'U proizvodnji'
        WHEN 'installation_in_progress' THEN 'Ugradnja u toku'
        WHEN 'scheduled' THEN 'Čeka ugradnju'
        ELSE c.status::text
      END
      || '» bez promene statusa najmanje '
      || (c.period_n * v_days)
      || ' dana (poslednja promena statusa: '
      || to_char(c.status_changed_at, 'DD.MM.YYYY')
      || ').',
    now(),
    'sla-stale:' || c.id::text || ':p' || c.period_n::text
  FROM (
    SELECT
      j.id,
      j.job_number,
      j.status,
      j.status_changed_at,
      FLOOR(
        EXTRACT(EPOCH FROM (now() - j.status_changed_at)) / 86400.0 / v_days
      )::int AS period_n
    FROM public.jobs j
    WHERE j.status IN (
        'new'::public.job_status,
        'quote_sent'::public.job_status,
        'final_quote_sent'::public.job_status,
        'final_quote_accepted_pending_payment'::public.job_status,
        'measuring'::public.job_status,
        'in_production'::public.job_status
      )
      AND COALESCE(j.status_locked, false) IS NOT TRUE
      AND (now() - j.status_changed_at) >= make_interval(days => v_days)
  ) c
  WHERE c.period_n >= 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.activities a
      WHERE a.job_id = c.id
        AND a.system_key = ('sla-stale:' || c.id::text || ':p' || c.period_n::text)
    );

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$sla$;

ALTER FUNCTION public.run_job_sla_stale_reminders() SET search_path TO public;

REVOKE ALL ON FUNCTION public.run_job_sla_stale_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_job_sla_stale_reminders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_job_sla_stale_reminders() TO service_role;

NOTIFY pgrst, 'reload schema';
