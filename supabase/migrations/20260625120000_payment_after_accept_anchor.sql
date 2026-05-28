-- Uplata posle prihvatanja finalne: bez +12h; isti kalendarski dan ili created/updated_at >= anchor.
-- payments.updated_at se osvežava pri izmeni uplate.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.payments
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN updated_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.payments_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_set_updated_at ON public.payments;
CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.payments_set_updated_at();

CREATE OR REPLACE FUNCTION public.payment_qualifies_after_accept_anchor(
  p_amount numeric,
  p_created_at timestamptz,
  p_updated_at timestamptz,
  p_date date,
  p_accept_anchor timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO public
AS $$
  SELECT COALESCE(p_amount, 0) > 0
    AND p_accept_anchor IS NOT NULL
    AND (
      COALESCE(p_updated_at, p_created_at) >= p_accept_anchor
      OR p_date >= (timezone('Europe/Belgrade', p_accept_anchor))::date
    );
$$;

REVOKE ALL ON FUNCTION public.payment_qualifies_after_accept_anchor(numeric, timestamptz, timestamptz, date, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_qualifies_after_accept_anchor(numeric, timestamptz, timestamptz, date, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payment_qualifies_after_accept_anchor(numeric, timestamptz, timestamptz, date, timestamptz) TO service_role;

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
  v_parent_job_id uuid;
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
  v_job_total numeric;
  v_job_paid numeric;
  v_unpaid numeric;
  v_install_final_report_ok boolean;
BEGIN
  SELECT j.status, COALESCE(j.status_locked, false), COALESCE(j.post_measurement_keep_initial_quote, false), j.parent_job_id
  INTO v_current, v_locked, v_post_measurement_keep_initial, v_parent_job_id
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found: %', p_job_id;
  END IF;

  IF v_locked OR v_current = 'service'::public.job_status
     OR (
       v_current = 'final_quote_sent'::public.job_status
       AND v_parent_job_id IS NULL
     )
     OR (
       v_parent_job_id IS NULL
       AND v_current = 'quote_sent'::public.job_status
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

    IF EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status = 'in_progress'::public.work_order_status
    ) THEN
      UPDATE public.jobs
      SET status = 'installation_in_progress'::public.job_status
      WHERE id = p_job_id;
      RETURN QUERY VALUES (
        true::boolean,
        v_current::public.job_status,
        'installation_in_progress'::public.job_status
      );
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.field_reports fr
      INNER JOIN public.work_orders w ON w.id = fr.work_order_id
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status NOT IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status)
        AND COALESCE(nullif(trim(fr.details->>'arrivedAt'), ''), '') <> ''
    ) THEN
      UPDATE public.jobs
      SET status = 'installation_in_progress'::public.job_status
      WHERE id = p_job_id;
      RETURN QUERY VALUES (
        true::boolean,
        v_current::public.job_status,
        'installation_in_progress'::public.job_status
      );
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status = 'pending'::public.work_order_status
    ) THEN
      UPDATE public.jobs
      SET status = 'scheduled'::public.job_status
      WHERE id = p_job_id;
      RETURN QUERY VALUES (
        true::boolean,
        v_current::public.job_status,
        'scheduled'::public.job_status
      );
      RETURN;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status NOT IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status)
    )
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status = 'completed'::public.work_order_status
    )
    AND EXISTS (
      SELECT 1
      FROM public.field_reports fr
      INNER JOIN public.work_orders w ON w.id = fr.work_order_id
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status = 'completed'::public.work_order_status
        AND fr.everything_ok IS DISTINCT FROM FALSE
        AND (
          fr.completed IS TRUE
          OR COALESCE(nullif(trim(fr.details->>'finishedAt'), ''), '') <> ''
        )
    ) THEN
      UPDATE public.jobs
      SET status = 'completed'::public.job_status
      WHERE id = p_job_id;
      RETURN QUERY VALUES (
        true::boolean,
        v_current::public.job_status,
        'completed'::public.job_status
      );
      RETURN;
    END IF;

    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  -- Pod-posao (parent_job_id): isti recompute kao roditelj; merenje se preskače isključivanjem RN merenja
  -- i forsiranim flagovima ispod (bez posebne grane).

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

  IF v_parent_job_id IS NOT NULL THEN
    v_meas_phase_done := true;
    v_measurement_completed := true;
    v_meas_in_progress := false;
  END IF;

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
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status NOT IN ('canceled'::public.work_order_status, 'completed'::public.work_order_status)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status NOT IN ('canceled'::public.work_order_status, 'completed'::public.work_order_status)
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

  IF v_parent_job_id IS NOT NULL THEN
    v_post_meas_quote_accepted := v_has_accepted_quote;
    v_post_meas_quote_sent := EXISTS (
      SELECT 1
      FROM public.quotes q
      WHERE q.job_id = p_job_id
        AND q.status = 'sent'::public.quote_status
    );
  END IF;

  v_accept_anchor := NULL;
  IF v_post_meas_quote_accepted THEN
    IF v_parent_job_id IS NOT NULL THEN
      SELECT MAX(GREATEST(COALESCE(q.updated_at, q.created_at), q.created_at))
      INTO v_accept_anchor
      FROM public.quotes q
      WHERE q.job_id = p_job_id
        AND q.status = 'accepted'::public.quote_status;
    ELSE
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
  END IF;

  IF v_post_measurement_keep_initial AND v_meas_finished_at IS NOT NULL THEN
    IF v_accept_anchor IS NULL THEN
      v_accept_anchor := v_meas_finished_at;
    ELSE
      v_accept_anchor := GREATEST(v_accept_anchor, v_meas_finished_at);
    END IF;
  END IF;

  IF v_parent_job_id IS NOT NULL THEN
    v_ready_for_work_ok :=
      v_has_accepted_quote
      AND v_accept_anchor IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.job_id = p_job_id
          AND COALESCE(p.amount, 0) > 0
          AND public.payment_qualifies_after_accept_anchor(
            p.amount, p.created_at, p.updated_at, p.date, v_accept_anchor
          )
      );
  ELSE
    v_ready_for_work_ok :=
      (v_post_meas_quote_accepted OR v_post_measurement_keep_initial)
      AND v_accept_anchor IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.job_id = p_job_id
          AND COALESCE(p.amount, 0) > 0
          AND public.payment_qualifies_after_accept_anchor(
            p.amount, p.created_at, p.updated_at, p.date, v_accept_anchor
          )
      );
  END IF;

  v_scheduled :=
    v_meas_phase_done
    AND (
      (v_has_inst AND v_install_all_pending)
      OR (
        v_prod_done_effective
        AND (NOT v_has_inst)
        AND v_has_prod
        AND v_prod_done
      )
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

  SELECT COALESCE(j.total_price, 0)
  INTO v_job_total
  FROM public.jobs j
  WHERE j.id = p_job_id;

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_job_paid
  FROM public.payments p
  WHERE p.job_id = p_job_id;

  v_unpaid := v_job_total - v_job_paid;

  v_install_final_report_ok := EXISTS (
    SELECT 1
    FROM public.field_reports fr
    INNER JOIN public.work_orders w ON w.id = fr.work_order_id
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
      AND fr.completed IS TRUE
  );

  IF EXISTS (
    SELECT 1
    FROM public.field_reports fr
    INNER JOIN public.work_orders w ON w.id = fr.work_order_id
    INNER JOIN public.jobs j ON j.id = w.job_id
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
      AND fr.everything_ok IS FALSE
      AND COALESCE(fr.addon_quote_site_request, false) = false
      AND j.first_completed_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.work_orders w_open
    WHERE w_open.job_id = p_job_id
      AND w_open.type = 'installation'::public.work_order_type
      AND w_open.status NOT IN (
        'completed'::public.work_order_status,
        'canceled'::public.work_order_status
      )
  ) THEN
    v_next := 'installation_problem'::public.job_status;
  ELSIF v_has_inst
    AND NOT v_inst_in_progress
    AND NOT v_inst_unfinished
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status = 'canceled'::public.work_order_status
    )
    AND NOT v_inst_job_done THEN
    v_next := 'installation_problem'::public.job_status;
  ELSIF v_inst_job_done AND v_install_final_report_ok THEN
    IF v_unpaid > 0.009 THEN
      v_next := 'installation_done_unpaid'::public.job_status;
    ELSE
      v_next := 'completed'::public.job_status;
    END IF;
  ELSIF v_inst_job_done THEN
    v_next := 'completed'::public.job_status;
  ELSIF v_inst_in_progress THEN
    v_next := 'installation_in_progress'::public.job_status;
  ELSIF v_parent_job_id IS NULL AND v_has_meas AND NOT v_meas_phase_done THEN
    v_next := 'measuring'::public.job_status;
  ELSIF v_parent_job_id IS NULL AND v_current = 'measuring'::public.job_status AND v_measurement_completed THEN
    v_next := 'measurement_processing'::public.job_status;
  ELSIF v_parent_job_id IS NULL AND v_measurement_completed AND NOT v_has_accepted_quote THEN
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
  ELSIF v_parent_job_id IS NULL
        AND v_measurement_completed
        AND v_post_meas_quote_sent
        AND NOT v_post_meas_quote_accepted THEN
    v_next := 'final_quote_sent'::public.job_status;
  ELSIF v_parent_job_id IS NOT NULL AND v_scheduled THEN
    v_next := 'scheduled'::public.job_status;
  ELSIF v_measurement_completed AND v_has_accepted_quote AND NOT v_has_material_order THEN
    IF v_post_meas_quote_accepted OR v_post_measurement_keep_initial THEN
      IF v_ready_for_work_ok THEN
        v_next := 'ready_for_work'::public.job_status;
      ELSE
        v_next := 'final_quote_accepted_pending_payment'::public.job_status;
      END IF;
    ELSE
      v_next := CASE
        WHEN v_parent_job_id IS NOT NULL THEN 'new'::public.job_status
        ELSE 'measurement_processing'::public.job_status
      END;
    END IF;
  ELSIF v_scheduled THEN
    v_next := 'scheduled'::public.job_status;
  -- Pod-posao: pre v_in_production kako novi child job ne bi završio u "U proizvodnji"
  ELSIF v_parent_job_id IS NOT NULL AND NOT v_ready_for_work_ok THEN
    IF v_has_accepted_quote THEN
      v_next := 'final_quote_accepted_pending_payment'::public.job_status;
    ELSIF v_post_meas_quote_sent OR v_current = 'final_quote_sent'::public.job_status THEN
      v_next := 'quote_sent'::public.job_status;
    ELSE
      v_next := 'new'::public.job_status;
    END IF;
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

NOTIFY pgrst, 'reload schema';
