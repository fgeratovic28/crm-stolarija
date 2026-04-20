-- Nakon što su nove vrednosti job_status commit-ovane (prethodna migracija):
-- premapiranje redova, recompute_job_status i SLA funkcija.

UPDATE public.jobs
SET status = 'measuring'::public.job_status
WHERE status = 'active'::public.job_status;

UPDATE public.jobs
SET status = 'in_production'::public.job_status
WHERE status IN (
  'in_progress'::public.job_status,
  'waiting_materials'::public.job_status
);

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
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  IF v_current = 'complaint'::public.job_status THEN
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

  v_scheduled :=
    v_meas_phase_done
    AND v_prod_done_effective
    AND (
      (v_has_inst AND v_install_all_pending)
      OR ((NOT v_has_inst) AND v_has_prod AND v_prod_done)
    );

  v_in_production :=
    v_meas_phase_done
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
  ELSIF v_meas_in_progress THEN
    v_next := 'measuring'::public.job_status;
  ELSIF v_scheduled THEN
    v_next := 'scheduled'::public.job_status;
  ELSIF v_in_production THEN
    v_next := 'in_production'::public.job_status;
  ELSE
    v_next := 'new'::public.job_status;
  END IF;

  IF v_next IS NOT DISTINCT FROM v_current THEN
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  UPDATE public.jobs
  SET status = v_next
  WHERE id = p_job_id;

  RETURN QUERY VALUES (true::boolean, v_current::public.job_status, v_next::public.job_status);
END;
$func$;

REVOKE ALL ON FUNCTION public.recompute_job_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_job_status(uuid) TO authenticated;

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
