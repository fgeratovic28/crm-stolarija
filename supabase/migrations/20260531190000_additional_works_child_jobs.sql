-- Dodatni radovi (parent–child poslovi): parent_job_id, broj posla „roditelj-N“, pojednostavljen recompute za dete,
-- RPC kreiranja deteta iz prodajnog alerta, ensure_workflow bez merenja/proizvodnje za decu.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS parent_job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.jobs.parent_job_id IS
  'Ako je postavljen, posao je pod-posao (dodatni radovi); broj posla je u formatu roditelj-N.';

CREATE INDEX IF NOT EXISTS idx_jobs_parent_job_id
  ON public.jobs (parent_job_id)
  WHERE parent_job_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Sledeći sufiks broja posla za decu istog roditelja (roditelj-1, roditelj-2, …).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.next_additional_works_child_job_number(p_parent_job_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_parent_num text;
  v_max int;
BEGIN
  SELECT trim(both FROM j.job_number::text)
  INTO v_parent_num
  FROM public.jobs j
  WHERE j.id = p_parent_job_id;

  IF v_parent_num IS NULL OR length(v_parent_num) = 0 THEN
    RAISE EXCEPTION 'Roditeljski posao nije pronađen' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(MAX(substr(j.job_number, length(v_parent_num) + 2)::int), 0)
  INTO v_max
  FROM public.jobs j
  WHERE j.parent_job_id = p_parent_job_id
    AND length(j.job_number) > length(v_parent_num) + 1
    AND substr(j.job_number, 1, length(v_parent_num)) = v_parent_num
    AND substr(j.job_number, length(v_parent_num) + 1, 1) = '-'
    AND substr(j.job_number, length(v_parent_num) + 2) ~ '^[0-9]+$';

  RETURN v_parent_num || '-' || (v_max + 1)::text;
END;
$func$;

ALTER FUNCTION public.next_additional_works_child_job_number(uuid) SET search_path TO public;

REVOKE ALL ON FUNCTION public.next_additional_works_child_job_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_additional_works_child_job_number(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_additional_works_child_job_number(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Prodaja: kreiranje pod-posla iz otvorenog plavog alerta (dopunski radovi sa terena).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_child_job_from_addon_site_quote_alert(p_alert_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_parent_id uuid;
  v_worker_text text;
  v_new_job_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role INTO v_role FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('office'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  SELECT a.job_id, a.worker_text
  INTO v_parent_id, v_worker_text
  FROM public.sales_site_addon_quote_alerts a
  WHERE a.id = p_alert_id
    AND a.dismissed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alert nije pronađen ili je već zatvoren' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.jobs (
    customer_id,
    job_number,
    status,
    summary,
    billing_address,
    installation_address,
    customer_phone,
    parent_job_id,
    total_price,
    vat_amount,
    advance_payment,
    prices_include_vat,
    vat_rate_percent,
    created_by,
    installation_lat,
    installation_lng,
    installation_location_source,
    post_measurement_keep_initial_quote,
    status_locked
  )
  SELECT
    p.customer_id,
    public.next_additional_works_child_job_number(p.id),
    'new'::public.job_status,
    LEFT(
      trim(
        both E'\n'
        FROM concat_ws(E'\n', 'Dodatni radovi (upit sa terena)', NULLIF(trim(COALESCE(v_worker_text, '')), ''))
      ),
      2000
    ),
    p.billing_address,
    p.installation_address,
    p.customer_phone,
    p.id,
    0::numeric,
    0::numeric,
    0::numeric,
    COALESCE(p.prices_include_vat, true),
    COALESCE(p.vat_rate_percent, 0::smallint),
    v_uid,
    p.installation_lat,
    p.installation_lng,
    p.installation_location_source,
    false,
    false
  FROM public.jobs p
  WHERE p.id = v_parent_id
  RETURNING id INTO v_new_job_id;

  UPDATE public.sales_site_addon_quote_alerts a
  SET dismissed_at = now(),
      dismissed_by = v_uid
  WHERE a.id = p_alert_id;

  INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
  VALUES (
    v_new_job_id,
    'other'::public.communication_type,
    '[AUTO] Kreiran dodatni posao (dodatni radovi) iz prodajnog alerta sa terena.',
    NOW(),
    'child-job-from-addon-alert:' || v_new_job_id::text,
    v_uid
  );

  PERFORM public.recompute_job_status(v_new_job_id);

  RETURN v_new_job_id;
END;
$func$;

ALTER FUNCTION public.create_child_job_from_addon_site_quote_alert(uuid) SET search_path TO public;

REVOKE ALL ON FUNCTION public.create_child_job_from_addon_site_quote_alert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_child_job_from_addon_site_quote_alert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_child_job_from_addon_site_quote_alert(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Lista alerta: field_report_id + RN za prikaz mera u UI.
-- Napomena: promena RETURNS TABLE (novi OUT parametri) nije dozvoljena sa
-- CREATE OR REPLACE — Postgres 42P13. Obavezno DROP pa CREATE.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.list_sales_site_addon_quote_alerts();

CREATE FUNCTION public.list_sales_site_addon_quote_alerts()
RETURNS TABLE (
  alert_id uuid,
  job_id uuid,
  job_number text,
  worker_text text,
  created_at timestamptz,
  field_report_id uuid,
  source_work_order_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('office'::public.user_role, 'admin'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id AS alert_id,
    j.id AS job_id,
    j.job_number::text AS job_number,
    a.worker_text,
    a.created_at,
    a.field_report_id,
    fr.work_order_id AS source_work_order_id
  FROM public.sales_site_addon_quote_alerts a
  JOIN public.jobs j ON j.id = a.job_id
  JOIN public.field_reports fr ON fr.id = a.field_report_id
  WHERE a.dismissed_at IS NULL
  ORDER BY a.created_at DESC
  LIMIT 200;
END;
$func$;

ALTER FUNCTION public.list_sales_site_addon_quote_alerts() SET search_path TO public;

REVOKE ALL ON FUNCTION public.list_sales_site_addon_quote_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_sales_site_addon_quote_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_sales_site_addon_quote_alerts() TO service_role;

-- ---------------------------------------------------------------------------
-- ensure_workflow_work_orders: pod-posao (parent_job_id) — isti tok kao roditelj,
-- ali se ne kreira automatski RN merenja; ugradnja se može kreirati i bez merenja u CRM-u.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_workflow_work_orders(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_status public.job_status;
  v_parent_job_id uuid;
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
  SELECT j.status, j.parent_job_id
  INTO v_job_status, v_parent_job_id
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
        FROM NULLIF(trim(both ' ' FROM j.summary), '')
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

  IF v_parent_job_id IS NULL
     AND v_job_status = 'measuring'::public.job_status
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

  IF v_parent_job_id IS NOT NULL THEN
    v_meas_ok_for_prod := true;
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

  IF (
       (v_prod_completed AND v_prod_fr_ok_for_inst)
       OR (
         v_job_status = 'scheduled'::public.job_status
         AND v_meas_ok_for_prod
         AND NOT EXISTS (
           SELECT 1
           FROM public.work_orders w
           WHERE w.job_id = p_job_id
             AND w.type = 'production'::public.work_order_type
         )
       )
     )
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

-- ---------------------------------------------------------------------------
-- recompute_job_status: pod-posao (parent_job_id) — posebna rana grana dok nema
-- „spremno za rad“ (prihvat + uplata): new / quote_sent / final_quote_accepted_pending_payment;
-- tek posle toga materijal → proizvodnja → …; quote_sent ne blokira recompute na detetu.
-- Završetak ugradnje: installation_done_unpaid ako ima dug, inače completed (uz završen terenski izveštaj).
-- Za pod-posao „Spremno za rad“: prihvaćena ponuda + uplata posle prihvata (bez keep_initial zamene).
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
      AND j.first_completed_at IS NULL
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
  ELSIF v_parent_job_id IS NOT NULL AND NOT v_ready_for_work_ok THEN
    IF v_has_accepted_quote THEN
      v_next := 'final_quote_accepted_pending_payment'::public.job_status;
    ELSIF v_post_meas_quote_sent THEN
      v_next := 'quote_sent'::public.job_status;
    ELSE
      v_next := 'new'::public.job_status;
    END IF;
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
