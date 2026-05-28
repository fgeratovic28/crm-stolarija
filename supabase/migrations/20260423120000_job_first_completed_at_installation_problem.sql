-- Posao: prvi završetak (garancijski “start”) + status „Ugradnja – problem” u toku ugradnje.
-- 1) Kolona; 2) enum; 3) trigger za first_completed_at; 4) ažuriranje grananja izveštaja;
-- 5) recompute_job_status; 6) RPC posle uspešnog site_visit (teren) izveštaja.

-- ---------------------------------------------------------------------------
-- 1) Kolona
-- ---------------------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS first_completed_at timestamptz;

COMMENT ON COLUMN public.jobs.first_completed_at IS
  'Kada je posao prvi put prešao u status „Završen” (completed). Ne prepisuje se posle reklamacije/servisa.';

-- ---------------------------------------------------------------------------
-- 2) Novi job status
-- ---------------------------------------------------------------------------
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'installation_problem';

-- ---------------------------------------------------------------------------
-- 3) Prvi prelazak u Završen: postavi first_completed_at jednom
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jobs_set_first_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $trig$
BEGIN
  IF NEW.status = 'completed'::public.job_status
     AND (TG_OP = 'INSERT' OR (OLD.status IS DISTINCT FROM 'completed'::public.job_status))
     AND NEW.first_completed_at IS NULL THEN
    NEW.first_completed_at := NOW();
  END IF;
  RETURN NEW;
END;
$trig$;

DROP TRIGGER IF EXISTS trg_jobs_first_completed_at ON public.jobs;
CREATE TRIGGER trg_jobs_first_completed_at
  BEFORE INSERT OR UPDATE OF status, first_completed_at
  ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_set_first_completed_at();

-- ---------------------------------------------------------------------------
-- 4) Instalacioni problem: automatski RN tipa site_visit (teren), ne reklamacija
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_field_report_workflow_branching(p_field_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_id uuid;
  v_wo_type public.work_order_type;
  v_site_canceled boolean;
  v_everything_ok boolean;
  v_additional_needs text[];
  v_issues text;
  v_general text;
  v_measurements text;
  v_cancel_reason text;
  v_target_type public.work_order_type;
  v_desc text;
  v_new_wo_id uuid;
  v_act_key text;
  v_has_additional boolean;
BEGIN
  SELECT
    wo.job_id,
    wo.type,
    COALESCE(fr.site_canceled, false),
    COALESCE(fr.everything_ok, true),
    COALESCE(fr.additional_needs, ARRAY[]::text[]),
    NULLIF(trim(both ' ' FROM fr.issues), ''),
    NULLIF(trim(both ' ' FROM fr.general_report), ''),
    NULLIF(trim(both ' ' FROM fr.measurements), ''),
    NULLIF(trim(both ' ' FROM fr.cancel_reason), '')
  INTO
    v_job_id,
    v_wo_type,
    v_site_canceled,
    v_everything_ok,
    v_additional_needs,
    v_issues,
    v_general,
    v_measurements,
    v_cancel_reason
  FROM public.field_reports fr
  INNER JOIN public.work_orders wo ON wo.id = fr.work_order_id
  WHERE fr.id = p_field_report_id;

  IF NOT FOUND OR v_job_id IS NULL THEN
    RETURN;
  END IF;

  v_has_additional := cardinality(v_additional_needs) > 0;

  IF v_site_canceled THEN
    v_act_key := 'field-report-site-canceled:' || p_field_report_id::text;
    IF NOT EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.job_id = v_job_id AND a.system_key = v_act_key
    ) THEN
      INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
      VALUES (
        v_job_id,
        'other'::public.communication_type,
        '[AUTO] Teren otkazan. ' || COALESCE(v_cancel_reason, 'Razlog nije unet.'),
        NOW(),
        v_act_key,
        NULL
      );
    END IF;
    RETURN;
  END IF;

  IF NOT v_everything_ok THEN
    -- Instalacioni problem: novi terenski nalog (site_visit), reklamacija/servis tek posle Završen.
    IF v_wo_type = 'production'::public.work_order_type THEN
      v_target_type := 'service'::public.work_order_type;
    ELSIF v_wo_type = 'installation'::public.work_order_type THEN
      v_target_type := 'site_visit'::public.work_order_type;
    ELSIF v_wo_type IN (
      'measurement'::public.work_order_type,
      'measurement_verification'::public.work_order_type
    ) THEN
      v_target_type := 'complaint'::public.work_order_type;
    ELSE
      v_target_type := 'service'::public.work_order_type;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.work_orders w
      WHERE w.automation_field_report_id = p_field_report_id
        AND w.type = v_target_type
    ) THEN
      RETURN;
    END IF;

    v_desc := LEFT(
      trim(
        both E'\n'
        FROM concat_ws(
          E'\n',
          CASE
            WHEN v_wo_type = 'installation'::public.work_order_type THEN
              '[AUTO] Terenska poseta nakon problema na ugradnji (čeka dodelu/materijal).'
            ELSE
              '[AUTO] Automatski otvoren nalog zbog problema u izveštaju.'
          END,
          NULLIF(v_general, ''),
          NULLIF(v_measurements, ''),
          NULLIF(v_issues, ''),
          CASE WHEN v_has_additional THEN 'Tražena dopuna (lista): ' || array_to_string(v_additional_needs, ', ') ELSE NULL END
        )
      ),
      6000
    );

    IF v_desc IS NULL OR length(trim(both ' ' FROM v_desc)) = 0 THEN
      v_desc := '[AUTO] Terenska poseta nakon problema na ugradnji.';
    END IF;

    INSERT INTO public.work_orders (
      job_id, type, description, date, status, team_id, automation_field_report_id
    )
    VALUES (
      v_job_id,
      v_target_type,
      v_desc,
      CURRENT_DATE,
      'pending'::public.work_order_status,
      NULL,
      p_field_report_id
    )
    RETURNING id INTO v_new_wo_id;

    v_act_key := 'auto-wo-problem:' || p_field_report_id::text || ':' || v_target_type::text;
    IF NOT EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.job_id = v_job_id AND a.system_key = v_act_key
    ) THEN
      INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
      VALUES (
        v_job_id,
        'other'::public.communication_type,
        '[AUTO] Automatski je otvoren radni nalog: '
          || CASE
            WHEN v_target_type = 'site_visit'::public.work_order_type THEN 'terenska poseta'
            ELSE initcap(replace(v_target_type::text, '_', ' '))
          END
          || ' (zbog problema u izveštaju).',
        NOW(),
        v_act_key,
        NULL
      );
    END IF;

    RETURN;
  END IF;

  IF v_has_additional THEN
    IF EXISTS (
      SELECT 1 FROM public.work_orders w
      WHERE w.automation_field_report_id = p_field_report_id
        AND w.type = 'site_visit'::public.work_order_type
    ) THEN
      RETURN;
    END IF;

    v_desc := LEFT(
      trim(
        both E'\n'
        FROM concat_ws(
          E'\n',
          '[AUTO] Dopuna / dodatne stavke sa terena (čeka rešavanje pre nastavka glavnog toka).',
          'Stavke: ' || array_to_string(v_additional_needs, ', '),
          NULLIF(v_general, ''),
          NULLIF(v_measurements, '')
        )
      ),
      6000
    );

    INSERT INTO public.work_orders (
      job_id, type, description, date, status, team_id, automation_field_report_id
    )
    VALUES (
      v_job_id,
      'site_visit'::public.work_order_type,
      v_desc,
      CURRENT_DATE,
      'pending'::public.work_order_status,
      NULL,
      p_field_report_id
    )
    RETURNING id INTO v_new_wo_id;

    v_act_key := 'auto-wo-supplement:' || p_field_report_id::text;
    IF NOT EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.job_id = v_job_id AND a.system_key = v_act_key
    ) THEN
      INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
      VALUES (
        v_job_id,
        'other'::public.communication_type,
        '[AUTO] Otvoren dopunski nalog (poseta) zbog traženih stavki u izveštaju: '
          || array_to_string(v_additional_needs, ', ')
          || '.',
        NOW(),
        v_act_key,
        NULL
      );
    END IF;
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public.apply_field_report_workflow_branching(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_field_report_workflow_branching(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_field_report_workflow_branching(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) recompute: installation_problem, bad install + first_completed, complaint zamena
--    (Kopirano i prilagođeno od 20260426125500_recompute_measuring_to_measurement_processing.sql)
-- ---------------------------------------------------------------------------
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

  -- Reklamacija tokom rešavanja (ne prepisivati recompute-om; garancijski nalog rešava kroz RPC)
  IF v_current = 'complaint'::public.job_status THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (complaint exit): %', SQLERRM;
    END;
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  -- Problem na ugradnji pre prvog Završen: čeka rešenje kroz follow-up site_visit
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

  -- Loš izveštaj ugradnje važi za automatski prelaz samo dok posao nije nikad bio "Završen"
  v_bad_install_report := EXISTS (
    SELECT 1
    FROM public.field_reports fr
    INNER JOIN public.work_orders w ON w.id = fr.work_order_id
    INNER JOIN public.jobs j ON j.id = w.job_id
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
      AND fr.everything_ok IS FALSE
      AND j.first_completed_at IS NULL
  );

  IF v_inst_job_done THEN
    IF v_bad_install_report THEN
      v_next := 'installation_problem'::public.job_status;
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
GRANT EXECUTE ON FUNCTION public.recompute_job_status(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Uspešan terenski (site_visit) izveštaj: vrati u Završen posle ugradnje garancije/rekl.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_field_report_site_visit_success(p_field_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_wo public.work_order_type;
  v_job_id uuid;
  v_st public.job_status;
  v_fr_ok boolean;
  v_canceled boolean;
BEGIN
  SELECT wo.type, wo.job_id, j.status, COALESCE(fr.everything_ok, true), COALESCE(fr.site_canceled, false)
  INTO v_wo, v_job_id, v_st, v_fr_ok, v_canceled
  FROM public.field_reports fr
  INNER JOIN public.work_orders wo ON wo.id = fr.work_order_id
  INNER JOIN public.jobs j ON j.id = wo.job_id
  WHERE fr.id = p_field_report_id;

  IF NOT FOUND OR v_job_id IS NULL THEN
    RETURN;
  END IF;

  IF v_wo IS DISTINCT FROM 'site_visit'::public.work_order_type THEN
    RETURN;
  END IF;

  IF v_canceled OR v_fr_ok IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Posle problema na ugradnji (prvi Završen) ili rešavanje rekl./servis posle garancije
  IF v_st = 'installation_problem'::public.job_status THEN
    UPDATE public.jobs
    SET
      status = 'completed'::public.job_status,
      status_changed_at = NOW()
    WHERE id = v_job_id
      AND status = 'installation_problem'::public.job_status;
    RETURN;
  END IF;

  IF v_st IN ('complaint'::public.job_status, 'service'::public.job_status) THEN
    UPDATE public.jobs
    SET
      status = 'completed'::public.job_status,
      status_changed_at = NOW()
    WHERE id = v_job_id
      AND status IN ('complaint'::public.job_status, 'service'::public.job_status);
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public.apply_field_report_site_visit_success(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_field_report_site_visit_success(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_field_report_site_visit_success(uuid) TO service_role;

-- Postojeći Završeni poslovi: popuni vreme „prvog“ završetka (za garancijski tajmaut i dugme rekl/servis).
UPDATE public.jobs
SET first_completed_at = COALESCE(status_changed_at, created_at, now())
WHERE status = 'completed'::public.job_status
  AND first_completed_at IS NULL;
