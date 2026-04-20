-- field_reports.additional_needs je TEXT[]; trim(text[]) nije validan (btrim(text[], unknown)).
-- Konverzija u tekst pre concat_ws za opis RN proizvodnje.

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
    INSERT INTO public.work_orders (job_id, type, description, date, status, team_id)
    VALUES (
      p_job_id,
      'measurement'::public.work_order_type,
      'Automatski kreiran nalog merenja (čeka dodelu tima).',
      CURRENT_DATE,
      'pending'::public.work_order_status,
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
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'production'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
  ) INTO v_prod_completed;

  IF v_prod_completed
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
      v_inst_desc := 'Procena ugradnje: ' || trim(to_char(v_est, 'FM999999990.99')) || ' h (iz merenja).';
      UPDATE public.jobs j
      SET estimated_installation_hours = v_est
      WHERE j.id = p_job_id
        AND (j.estimated_installation_hours IS DISTINCT FROM v_est);
    ELSE
      v_inst_desc := 'Procena trajanja ugradnje (sati) nije uneta na merenju — proverite terenski izveštaj sa merenja.';
    END IF;

    INSERT INTO public.work_orders (job_id, type, description, date, status, team_id)
    VALUES (
      p_job_id,
      'installation'::public.work_order_type,
      v_inst_desc,
      CURRENT_DATE,
      'pending'::public.work_order_status,
      NULL
    );
  END IF;
END;
$func$;
