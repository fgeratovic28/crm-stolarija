-- Srpski nazivi tipova RN u automatskim aktivnostima (umesto initcap na engleskom enum-u).

CREATE OR REPLACE FUNCTION public.label_work_order_type_for_activity(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $$
  SELECT CASE p_type
    WHEN 'measurement' THEN 'Merenje'
    WHEN 'measurement_verification' THEN 'Provera mera'
    WHEN 'installation' THEN 'Ugradnja'
    WHEN 'production' THEN 'Proizvodnja'
    WHEN 'complaint' THEN 'Reklamacija'
    WHEN 'service' THEN 'Servis'
    WHEN 'site_visit' THEN 'Terenska poseta'
    WHEN 'control_visit' THEN 'Kontrolna poseta'
    ELSE COALESCE(p_type, '')
  END;
$$;
-- Terenski izveštaj sa RN merenja / kontrole mera kada „nije u redu“: novi RN istog tipa (tim + datum naknadno),
-- umesto automatskog otvaranja RN reklamacije.

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
  v_has_problem_content :=
    (NOT v_everything_ok)
    OR v_has_missing
    OR (v_has_additional AND NOT (v_addon_quote AND v_wo_type = 'installation'::public.work_order_type))
    OR v_issues IS NOT NULL;

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
            '[AUTO] Prethodni nalog je otkazan i otvoren je novi za ponovno zakazivanje.',
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
        v_desc := '[AUTO] Prethodni nalog je otkazan i otvoren je novi za ponovno zakazivanje.';
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
     AND v_has_problem_content THEN
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
            '[AUTO] Automatski otvoren nalog zbog problema u izveštaju.',
            NULLIF(v_general, ''),
            NULLIF(v_measurements, ''),
            NULLIF(v_issues, ''),
            CASE WHEN v_has_missing THEN 'Nedostaje / nije isporučeno: ' || array_to_string(v_missing_items, ', ') ELSE NULL END,
            CASE WHEN v_has_additional THEN 'Tražena dopuna: ' || array_to_string(v_additional_needs, ', ') ELSE NULL END
          )
        ),
        6000
      );
      v_act_key := 'auto-wo-problem:' || p_field_report_id::text || ':' || v_target_type::text;
      v_activity_desc :=
        '[AUTO] Automatski je otvoren radni nalog: ' || public.label_work_order_type_for_activity(v_target_type::text) || '.';
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

  IF v_has_additional
     AND NOT (v_addon_quote AND v_wo_type = 'installation'::public.work_order_type) THEN
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
$func$;

COMMENT ON FUNCTION public.apply_field_report_workflow_branching(uuid) IS
  'Grananje terenskog izveštaja. Merenje/kontrola mera „nije u redu“ → novi RN istog tipa (tim naknadno). Za flag invoiceMissingDeferAutoInstallationWo u details, ne otvara odmah novi RN ugradnje (prijava sa predračuna — triage na dashboardu).';

REVOKE ALL ON FUNCTION public.apply_field_report_workflow_branching(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_field_report_workflow_branching(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_field_report_workflow_branching(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
