-- Grananje posle terenskog izveštaja: izuzeci (reklamacija/servis/dopuna), aktivnosti,
-- blokada glavnog toka dok su automatski RN otvoreni, i proširenje ensure_workflow (bez promene recompute_job_status).

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS automation_field_report_id uuid REFERENCES public.field_reports(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_automation_field_report_type_uidx
  ON public.work_orders (automation_field_report_id, type)
  WHERE automation_field_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_automation_field_report
  ON public.work_orders (automation_field_report_id)
  WHERE automation_field_report_id IS NOT NULL;

COMMENT ON COLUMN public.work_orders.automation_field_report_id IS
  'Ako je RN kreiran automatski iz izveštaja, veza radi idempotentnosti i blokade glavnog toka.';

-- ---------------------------------------------------------------------------
-- Posle INSERT-a field_reports: otkaz, problem (reklamacija/servis), dopuna (site_visit).
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

  -- 1) Otkazan teren — samo aktivnost (status RN već postavljen klijentom).
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

  -- 2) Problem / nije u redu — reklamacija ili servis (bez normalnog sledećeg koraka dok se ne zatvori auto-RN u ensure).
  IF NOT v_everything_ok THEN
    IF v_wo_type = 'production'::public.work_order_type THEN
      v_target_type := 'service'::public.work_order_type;
    ELSIF v_wo_type IN (
      'measurement'::public.work_order_type,
      'measurement_verification'::public.work_order_type,
      'installation'::public.work_order_type
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
          '[AUTO] Automatski otvoren nalog zbog problema u izveštaju.',
          NULLIF(v_general, ''),
          NULLIF(v_measurements, ''),
          NULLIF(v_issues, ''),
          CASE WHEN v_has_additional THEN 'Tražena dopuna (lista): ' || array_to_string(v_additional_needs, ', ') ELSE NULL END
        )
      ),
      6000
    );

    IF v_desc IS NULL OR length(trim(both ' ' FROM v_desc)) = 0 THEN
      v_desc := '[AUTO] Automatski otvoren nalog zbog problema u izveštaju.';
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
        '[AUTO] Automatski je otvoren radni nalog tipa '
          || initcap(replace(v_target_type::text, '_', ' '))
          || ' zbog problema u izveštaju.',
        NOW(),
        v_act_key,
        NULL
      );
    END IF;

    RETURN;
  END IF;

  -- 3) Sve u redu, ali treba dopuna — site_visit, lista stavki u opisu.
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
-- Glavni tok: ne otvaraj merenje→proizvodnja→ugradnja dok postoji otvoren automatski izuzetak.
-- Proizvodnja→ugradnja: poslednji izveštaj na završenoj proizvodnji mora biti „u redu”.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_workflow_work_orders(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_status public.job_status;
  v_has_open_meas boolean;
  v_has_open_prod boolean;
  v_has_open_inst boolean;
  v_meas_ok_for_prod boolean;
  v_prod_completed boolean;
  v_prod_desc text;
  v_inst_desc text;
  v_est numeric;
  v_meas_desc text;
  v_job_scope text;
  v_auto_pipeline_blocked boolean;
  v_prod_fr_ok_for_inst boolean;
  v_new_wo_id uuid;
BEGIN
  SELECT j.status
  INTO v_job_status
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'complaint'::public.work_order_type,
        'service'::public.work_order_type,
        'site_visit'::public.work_order_type
      )
      AND w.status IN (
        'pending'::public.work_order_status,
        'in_progress'::public.work_order_status
      )
      AND w.automation_field_report_id IS NOT NULL
  ) INTO v_auto_pipeline_blocked;

  SELECT
    LEFT(
      trim(
        both E'\n'
        FROM concat_ws(
          E'\n',
          NULLIF(trim(both ' ' FROM j.summary), ''),
          NULLIF(
            (
              SELECT
                trim(
                  both E'\n'
                  FROM string_agg(trim(both ' ' FROM ql.description), E'; ' ORDER BY ql.sort_order, ql.id)
                )
              FROM public.job_quote_lines ql
              WHERE ql.job_id = j.id
            ),
            ''
          )
        )
      ),
      1800
    )
  INTO v_job_scope
  FROM public.jobs j
  WHERE j.id = p_job_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN ('measurement'::public.work_order_type, 'measurement_verification'::public.work_order_type)
      AND w.status IN ('pending'::public.work_order_status, 'in_progress'::public.work_order_status)
  ) INTO v_has_open_meas;

  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'production'::public.work_order_type
      AND w.status IN ('pending'::public.work_order_status, 'in_progress'::public.work_order_status)
  ) INTO v_has_open_prod;

  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status IN ('pending'::public.work_order_status, 'in_progress'::public.work_order_status)
  ) INTO v_has_open_inst;

  IF v_job_status = 'measuring'::public.job_status
     AND NOT v_has_open_meas
     AND NOT EXISTS (
       SELECT 1
       FROM public.work_orders w
       WHERE w.job_id = p_job_id
         AND w.type IN ('measurement'::public.work_order_type, 'measurement_verification'::public.work_order_type)
         AND w.status = 'completed'::public.work_order_status
     ) THEN
    SELECT
      LEFT(
        trim(
          both E'\n'
          FROM concat_ws(
            E' — ',
            concat_ws(
              ' · ',
              'Merenje',
              NULLIF(trim(both ' ' FROM j.job_number), '')
            ),
            NULLIF(
              trim(
                both ' '
                FROM coalesce(
                  NULLIF(trim(both ' ' FROM v_job_scope), ''),
                  NULLIF(trim(both ' ' FROM coalesce(j.installation_address, '')), '')
                )
              ),
              ''
            )
          )
        ),
        2000
      )
    INTO v_meas_desc
    FROM public.jobs j
    WHERE j.id = p_job_id;

    IF v_meas_desc IS NULL OR length(trim(both ' ' FROM v_meas_desc)) = 0 THEN
      v_meas_desc := 'Merenje';
    END IF;

    INSERT INTO public.work_orders (job_id, type, description, date, status, team_id)
    VALUES (
      p_job_id,
      'measurement'::public.work_order_type,
      v_meas_desc,
      CURRENT_DATE,
      'pending'::public.work_order_status,
      NULL
    )
    RETURNING id INTO v_new_wo_id;

    INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
    VALUES (
      p_job_id,
      'other'::public.communication_type,
      '[AUTO] Automatski je kreiran radni nalog: Merenje (čeka dodelu tima).',
      NOW(),
      'ensure-mainline-wo:' || v_new_wo_id::text,
      NULL
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders wo
    JOIN public.field_reports fr ON fr.work_order_id = wo.id
    WHERE wo.job_id = p_job_id
      AND wo.type IN ('measurement'::public.work_order_type, 'measurement_verification'::public.work_order_type)
      AND wo.status = 'completed'::public.work_order_status
      AND COALESCE(fr.everything_ok, true) IS TRUE
      AND COALESCE(fr.site_canceled, false) IS FALSE
  ) INTO v_meas_ok_for_prod;

  IF v_meas_ok_for_prod
     AND NOT v_auto_pipeline_blocked
     AND NOT v_has_open_prod
     AND NOT EXISTS (
       SELECT 1
       FROM public.work_orders w
       WHERE w.job_id = p_job_id
         AND w.type = 'production'::public.work_order_type
         AND w.status = 'completed'::public.work_order_status
     ) THEN
    SELECT LEFT(
      trim(both E'\n' FROM concat_ws(
        E'\n',
        NULLIF(trim(both ' ' FROM fr.general_report), ''),
        NULLIF(trim(both ' ' FROM fr.measurements), ''),
        NULLIF(
          trim(both ' ' FROM array_to_string(COALESCE(fr.additional_needs, ARRAY[]::text[]), E'\n')),
          ''
        ),
        NULLIF(trim(both ' ' FROM fr.issues), '')
      )),
      6000
    )
    INTO v_prod_desc
    FROM public.field_reports fr
    JOIN public.work_orders wo ON wo.id = fr.work_order_id
    WHERE wo.job_id = p_job_id
      AND wo.type IN ('measurement'::public.work_order_type, 'measurement_verification'::public.work_order_type)
      AND wo.status = 'completed'::public.work_order_status
      AND COALESCE(fr.everything_ok, true) IS TRUE
      AND COALESCE(fr.site_canceled, false) IS FALSE
    ORDER BY fr.created_at DESC NULLS LAST
    LIMIT 1;

    IF v_prod_desc IS NULL OR length(trim(both ' ' FROM v_prod_desc)) = 0 THEN
      v_prod_desc := 'Napomene sa merenja nisu unete u izveštaj.';
    END IF;

    INSERT INTO public.work_orders (job_id, type, description, date, status, team_id)
    VALUES (
      p_job_id,
      'production'::public.work_order_type,
      v_prod_desc,
      CURRENT_DATE,
      'pending'::public.work_order_status,
      NULL
    )
    RETURNING id INTO v_new_wo_id;

    INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
    VALUES (
      p_job_id,
      'other'::public.communication_type,
      '[AUTO] Automatski je kreiran radni nalog: Proizvodnja (čeka dodelu tima).',
      NOW(),
      'ensure-mainline-wo:' || v_new_wo_id::text,
      NULL
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'production'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
  ) INTO v_prod_completed;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'production'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
      AND COALESCE(
        (
          SELECT
            COALESCE(fr.everything_ok, true)
            AND NOT COALESCE(fr.site_canceled, false)
          FROM public.field_reports fr
          WHERE fr.work_order_id = w.id
          ORDER BY fr.created_at DESC NULLS LAST, fr.id DESC
          LIMIT 1
        ),
        false
      ) IS NOT TRUE
  ) INTO v_prod_fr_ok_for_inst;

  IF v_prod_completed
     AND v_prod_fr_ok_for_inst
     AND NOT v_auto_pipeline_blocked
     AND NOT v_has_open_inst
     AND NOT EXISTS (
       SELECT 1
       FROM public.work_orders w
       WHERE w.job_id = p_job_id
         AND w.type = 'installation'::public.work_order_type
         AND w.status = 'completed'::public.work_order_status
     ) THEN
    SELECT MAX(fr.estimated_installation_hours) INTO v_est
    FROM public.field_reports fr
    JOIN public.work_orders wo ON wo.id = fr.work_order_id
    WHERE wo.job_id = p_job_id
      AND wo.type IN ('measurement'::public.work_order_type, 'measurement_verification'::public.work_order_type)
      AND fr.estimated_installation_hours IS NOT NULL;

    IF v_est IS NOT NULL THEN
      v_inst_desc := LEFT(
        trim(
          both E'\n'
          FROM concat_ws(
            E'\n',
            NULLIF(trim(both ' ' FROM v_job_scope), ''),
            'Procena ugradnje: ' || trim(to_char(v_est, 'FM999999990.99')) || ' h.'
          )
        ),
        2000
      );
      UPDATE public.jobs j
      SET estimated_installation_hours = v_est
      WHERE j.id = p_job_id
        AND (j.estimated_installation_hours IS DISTINCT FROM v_est);
    ELSE
      v_inst_desc := LEFT(
        trim(
          both E'\n'
          FROM concat_ws(
            E'\n',
            NULLIF(trim(both ' ' FROM v_job_scope), ''),
            'Procena trajanja ugradnje (sati) nije uneta — dopunite terenski izveštaj sa merenja.'
          )
        ),
        2000
      );
    END IF;

    INSERT INTO public.work_orders (job_id, type, description, date, status, team_id)
    VALUES (
      p_job_id,
      'installation'::public.work_order_type,
      v_inst_desc,
      CURRENT_DATE,
      'pending'::public.work_order_status,
      NULL
    )
    RETURNING id INTO v_new_wo_id;

    INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
    VALUES (
      p_job_id,
      'other'::public.communication_type,
      '[AUTO] Automatski je kreiran radni nalog: Ugradnja (čeka dodelu tima).',
      NOW(),
      'ensure-mainline-wo:' || v_new_wo_id::text,
      NULL
    );
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public.ensure_workflow_work_orders(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_workflow_work_orders(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_workflow_work_orders(uuid) TO service_role;
