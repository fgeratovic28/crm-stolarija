-- Montažni izveštaj: nedostajući elementi koji nisu na predračunu ne šalju posao u
-- "Ugradnja – problem". Upozorenje za prodaju ostaje (missing_items se i dalje čuva),
-- ali ne utiče na tok posla. Posao ide u "Ugradnja završena / nije plaćeno" ili
-- "Završen" u zavisnosti od duga.
--
-- Pod-posao (child job): početni status treba da bude "Upit" (new), a ne "U proizvodnji"
-- (in_production) kako je bilo do sada.

-- ---------------------------------------------------------------------------
-- 1. apply_field_report_workflow_branching
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_field_report_workflow_branching(p_field_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $apply$
DECLARE
  v_job_id uuid;
  v_wo_type public.work_order_type;
  v_site_canceled boolean;
  v_everything_ok boolean;
  v_additional_needs text[];
  v_missing_items text[];
  v_issues text;
  v_general text;
  v_measurements text;
  v_cancel_reason text;
  v_addon_quote boolean;
  v_target_type public.work_order_type;
  v_desc text;
  v_new_wo_id uuid;
  v_act_key text;
  v_has_additional boolean;
  v_has_missing boolean;
  v_has_problem_content boolean;
  v_next_job_status public.job_status;
  v_defer_install_auto_wo boolean;
  v_activity_desc text;
BEGIN
  SELECT
    wo.job_id,
    wo.type,
    COALESCE(fr.site_canceled, false),
    COALESCE(fr.everything_ok, true),
    COALESCE(fr.additional_needs, ARRAY[]::text[]),
    COALESCE(fr.missing_items, ARRAY[]::text[]),
    NULLIF(trim(both ' ' FROM fr.issues), ''),
    NULLIF(trim(both ' ' FROM fr.general_report), ''),
    NULLIF(trim(both ' ' FROM fr.measurements), ''),
    NULLIF(trim(both ' ' FROM fr.cancel_reason), ''),
    COALESCE(fr.addon_quote_site_request, false),
    COALESCE((fr.details->>'invoiceMissingDeferAutoInstallationWo')::boolean, false)
  INTO
    v_job_id,
    v_wo_type,
    v_site_canceled,
    v_everything_ok,
    v_additional_needs,
    v_missing_items,
    v_issues,
    v_general,
    v_measurements,
    v_cancel_reason,
    v_addon_quote,
    v_defer_install_auto_wo
  FROM public.field_reports fr
  INNER JOIN public.work_orders wo ON wo.id = fr.work_order_id
  WHERE fr.id = p_field_report_id;

  IF NOT FOUND OR v_job_id IS NULL THEN
    RETURN;
  END IF;

  v_has_additional := cardinality(v_additional_needs) > 0;
  v_has_missing := cardinality(v_missing_items) > 0;

  IF v_addon_quote
     AND v_wo_type = 'installation'::public.work_order_type
     AND v_everything_ok THEN
    v_has_problem_content := false;
  ELSE
    v_has_problem_content :=
      (NOT v_everything_ok)
      OR (
        v_has_missing
        AND (v_wo_type IS DISTINCT FROM 'installation'::public.work_order_type OR v_defer_install_auto_wo)
      )
      OR (v_has_additional AND NOT (v_addon_quote AND v_wo_type = 'installation'::public.work_order_type))
      OR v_issues IS NOT NULL;
  END IF;

  IF v_site_canceled
     AND v_wo_type IN (
       'measurement'::public.work_order_type,
       'measurement_verification'::public.work_order_type,
       'installation'::public.work_order_type
     ) THEN
    v_target_type := v_wo_type;

    IF NOT EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.automation_field_report_id = p_field_report_id
        AND w.type = v_target_type
    ) THEN
      v_desc := LEFT(
        trim(
          both E'\n'
          FROM concat_ws(
            E'\n',
            'Razlog otkazivanja: ' || COALESCE(v_cancel_reason, 'nije unet'),
            CASE WHEN v_has_missing THEN 'Nedostaje / nije isporučeno: ' || array_to_string(v_missing_items, ', ') ELSE NULL END,
            CASE WHEN v_has_additional THEN 'Tražena dopuna: ' || array_to_string(v_additional_needs, ', ') ELSE NULL END,
            NULLIF(v_issues, ''),
            NULLIF(v_general, ''),
            NULLIF(v_measurements, '')
          )
        ),
        6000
      );

      IF v_desc IS NULL OR length(trim(both ' ' FROM v_desc)) = 0 THEN
        v_desc := '';
      END IF;

      INSERT INTO public.work_orders (
        job_id, type, description, date, status, team_id, automation_field_report_id
      )
      VALUES (
        v_job_id,
        v_target_type,
        NULLIF(v_desc, ''),
        CURRENT_DATE,
        'pending'::public.work_order_status,
        NULL,
        p_field_report_id
      )
      RETURNING id INTO v_new_wo_id;

      v_act_key := 'auto-wo-rescheduled-canceled:' || p_field_report_id::text || ':' || v_target_type::text;
      IF NOT EXISTS (
        SELECT 1 FROM public.activities a
        WHERE a.job_id = v_job_id AND a.system_key = v_act_key
      ) THEN
        INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
        VALUES (
          v_job_id,
          'other'::public.communication_type,
          '[AUTO] Otkazan '
            || CASE
              WHEN v_target_type = 'installation'::public.work_order_type THEN 'nalog ugradnje'
              WHEN v_target_type = 'measurement_verification'::public.work_order_type THEN 'nalog kontrole mera'
              ELSE 'nalog merenja'
            END
            || '; otvoren novi nalog za ponovno zakazivanje.',
          NOW(),
          v_act_key,
          NULL
        );
      END IF;
    END IF;

    IF v_wo_type = 'installation'::public.work_order_type THEN
      IF v_has_problem_content THEN
        v_next_job_status := 'installation_problem'::public.job_status;
      ELSE
        v_next_job_status := 'scheduled'::public.job_status;
      END IF;
    ELSE
      v_next_job_status := 'measuring'::public.job_status;
    END IF;

    UPDATE public.jobs
    SET
      status = v_next_job_status,
      status_changed_at = NOW()
    WHERE id = v_job_id
      AND status IS DISTINCT FROM v_next_job_status;

    RETURN;
  END IF;

  IF v_wo_type = 'installation'::public.work_order_type
     AND v_has_problem_content
     AND NOT (v_addon_quote AND v_everything_ok) THEN
    v_target_type := 'installation'::public.work_order_type;

    IF NOT v_defer_install_auto_wo THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.work_orders w
        WHERE w.automation_field_report_id = p_field_report_id
          AND w.type = v_target_type
      ) THEN
        v_desc := LEFT(
          trim(
            both E'\n'
            FROM concat_ws(
              E'\n',
              '[AUTO] Problem na ugradnji — otvoren novi nalog za ponovno zakazivanje ugradnje.',
              CASE WHEN v_has_missing THEN 'Nedostaje / nije isporučeno: ' || array_to_string(v_missing_items, ', ') ELSE NULL END,
              CASE WHEN v_has_additional THEN 'Tražena dopuna: ' || array_to_string(v_additional_needs, ', ') ELSE NULL END,
              NULLIF(v_issues, ''),
              NULLIF(v_general, ''),
              NULLIF(v_measurements, '')
            )
          ),
          6000
        );

        IF v_desc IS NULL OR length(trim(both ' ' FROM v_desc)) = 0 THEN
          v_desc := '[AUTO] Problem na ugradnji — otvoren novi nalog za ponovno zakazivanje ugradnje.';
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

        v_act_key := 'auto-wo-install-problem:' || p_field_report_id::text;
        IF NOT EXISTS (
          SELECT 1 FROM public.activities a
          WHERE a.job_id = v_job_id AND a.system_key = v_act_key
        ) THEN
          INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
          VALUES (
            v_job_id,
            'other'::public.communication_type,
            '[AUTO] Evidentiran problem na ugradnji; otvoren novi nalog ugradnje za ponovno zakazivanje.',
            NOW(),
            v_act_key,
            NULL
          );
        END IF;
      END IF;
    END IF;

    UPDATE public.jobs
    SET
      status = 'installation_problem'::public.job_status,
      status_changed_at = NOW()
    WHERE id = v_job_id
      AND status IS DISTINCT FROM 'installation_problem'::public.job_status;

    RETURN;
  END IF;

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
    IF v_wo_type = 'production'::public.work_order_type THEN
      v_target_type := 'service'::public.work_order_type;
    ELSIF v_wo_type IN (
      'measurement'::public.work_order_type,
      'measurement_verification'::public.work_order_type
    ) THEN
      v_target_type := v_wo_type;
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

    IF v_wo_type IN (
      'measurement'::public.work_order_type,
      'measurement_verification'::public.work_order_type
    ) THEN
      v_desc := LEFT(
        trim(
          both E'\n'
          FROM concat_ws(
            E'\n',
            CASE
              WHEN v_wo_type = 'measurement_verification'::public.work_order_type THEN
                '[AUTO] Ponovna kontrola mera — zabeležen problem na izveštaju; dodelite tim i datum na novom nalogu.'
              ELSE
                '[AUTO] Ponovno merenje — zabeležen problem na izveštaju; dodelite tim i datum na novom nalogu.'
            END,
            NULLIF(v_general, ''),
            NULLIF(v_measurements, ''),
            NULLIF(v_issues, ''),
            CASE WHEN v_has_missing THEN 'Nedostaje / nije isporučeno: ' || array_to_string(v_missing_items, ', ') ELSE NULL END,
            CASE WHEN v_has_additional THEN 'Tražena dopuna: ' || array_to_string(v_additional_needs, ', ') ELSE NULL END
          )
        ),
        6000
      );
      v_act_key := 'auto-wo-measurement-followup:' || p_field_report_id::text || ':' || v_target_type::text;
      v_activity_desc :=
        '[AUTO] Problem na terenu — otvoren novi nalog '
        || CASE
          WHEN v_target_type = 'measurement_verification'::public.work_order_type THEN 'kontrole mera'
          ELSE 'merenja'
        END
        || ' (na čekanju; dodela tima i zakazivanje).';
    ELSE
      v_desc := LEFT(
        trim(
          both E'\n'
          FROM concat_ws(
            E'\n',
            '[AUTO] Servis / reklamacija — zabeležen problem na izveštaju.',
            NULLIF(v_issues, ''),
            NULLIF(v_general, ''),
            NULLIF(v_measurements, ''),
            CASE WHEN v_has_missing THEN 'Nedostaje / nije isporučeno: ' || array_to_string(v_missing_items, ', ') ELSE NULL END,
            CASE WHEN v_has_additional THEN 'Tražena dopuna: ' || array_to_string(v_additional_needs, ', ') ELSE NULL END
          )
        ),
        6000
      );
      v_act_key := 'auto-wo-service-followup:' || p_field_report_id::text;
      v_activity_desc := '[AUTO] Problem na terenu — otvoren novi servisni nalog (na čekanju).';
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

    IF NOT EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.job_id = v_job_id AND a.system_key = v_act_key
    ) THEN
      INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
      VALUES (
        v_job_id,
        'other'::public.communication_type,
        v_activity_desc,
        NOW(),
        v_act_key,
        NULL
      );
    END IF;

    RETURN;
  END IF;

  IF v_addon_quote AND v_wo_type = 'installation'::public.work_order_type AND v_has_additional THEN
    INSERT INTO public.sales_site_addon_quote_alerts (job_id, field_report_id, worker_text)
    VALUES (
      v_job_id,
      p_field_report_id,
      LEFT(
        trim(
          both E'\n'
          FROM concat_ws(
            E'\n',
            'Tražena dopuna / upit za ponudu: ' || array_to_string(v_additional_needs, ', '),
            NULLIF(v_measurements, ''),
            NULLIF(v_general, '')
          )
        ),
        8000
      )
    )
    ON CONFLICT (field_report_id) DO NOTHING;
  END IF;
END;
$apply$;

COMMENT ON FUNCTION public.apply_field_report_workflow_branching(uuid) IS
  '20260618160000: Montažni izveštaj — nedostajući elementi van predračuna ne šalju posao u "Ugradnja – problem".';

REVOKE ALL ON FUNCTION public.apply_field_report_workflow_branching(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_field_report_workflow_branching(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_field_report_workflow_branching(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. recompute_job_status
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
          AND COALESCE(p.created_at, (p.date::timestamp + interval '12 hours')) >= v_accept_anchor
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
          AND COALESCE(p.created_at, (p.date::timestamp + interval '12 hours')) >= v_accept_anchor
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
