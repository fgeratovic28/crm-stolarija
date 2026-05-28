-- Posle otkazanog terena: ako su u izveštaju tražene dopune (additional_needs) ili navedeni nedostajući elementi (missing_items),
-- kreira se automatski RN tipa site_visit sa tim informacijama (ranije je RETURN prekinuo grananje).
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
  v_target_type public.work_order_type;
  v_desc text;
  v_new_wo_id uuid;
  v_act_key text;
  v_has_additional boolean;
  v_has_missing boolean;
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
    NULLIF(trim(both ' ' FROM fr.cancel_reason), '')
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
    v_cancel_reason
  FROM public.field_reports fr
  INNER JOIN public.work_orders wo ON wo.id = fr.work_order_id
  WHERE fr.id = p_field_report_id;

  IF NOT FOUND OR v_job_id IS NULL THEN
    RETURN;
  END IF;

  v_has_additional := cardinality(v_additional_needs) > 0;
  v_has_missing := cardinality(v_missing_items) > 0;

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

    IF (v_has_additional OR v_has_missing) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.work_orders w
        WHERE w.automation_field_report_id = p_field_report_id
          AND w.type = 'site_visit'::public.work_order_type
      ) THEN
        v_desc := LEFT(
          trim(
            both E'\n'
            FROM concat_ws(
              E'\n',
              '[AUTO] Otkazan teren — potrebna dopuna (materijal / elementi).',
              'Razlog otkazivanja: ' || COALESCE(NULLIF(trim(both ' ' FROM v_cancel_reason), ''), 'nije unet'),
              CASE
                WHEN v_has_missing THEN 'Nedostaje / nije isporučeno: ' || array_to_string(v_missing_items, ', ')
                ELSE NULL
              END,
              CASE
                WHEN v_has_additional THEN 'Tražena dopuna (lista): ' || array_to_string(v_additional_needs, ', ')
                ELSE NULL
              END,
              NULLIF(v_issues, ''),
              NULLIF(v_general, ''),
              NULLIF(v_measurements, '')
            )
          ),
          6000
        );

        IF v_desc IS NULL OR length(trim(both ' ' FROM v_desc)) = 0 THEN
          v_desc := '[AUTO] Otkazan teren — potrebna dopuna.';
        END IF;

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

        v_act_key := 'auto-wo-canceled-material:' || p_field_report_id::text;
        IF NOT EXISTS (
          SELECT 1 FROM public.activities a
          WHERE a.job_id = v_job_id AND a.system_key = v_act_key
        ) THEN
          INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
          VALUES (
            v_job_id,
            'other'::public.communication_type,
            '[AUTO] Otvoren nalog terenske posete zbog dopune posle otkazanog terena'
              || CASE WHEN v_has_missing THEN ' (nedostaju elementi)' ELSE '' END
              || CASE WHEN v_has_additional THEN ' (tražena dopuna)' ELSE '' END
              || '.',
            NOW(),
            v_act_key,
            NULL
          );
        END IF;
      END IF;
    END IF;

    RETURN;
  END IF;

  IF NOT v_everything_ok THEN
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
          CASE WHEN v_has_missing THEN 'Nedostaje / nije isporučeno: ' || array_to_string(v_missing_items, ', ') ELSE NULL END,
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
