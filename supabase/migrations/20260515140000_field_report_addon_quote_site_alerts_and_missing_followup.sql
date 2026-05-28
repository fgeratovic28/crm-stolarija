-- Teren: dopunski upit za ponudu (addon) bez installation_problem; Prodaja plavi alert; Nabavka „deo obezbeđen“ + novi RN ugradnje.
-- Ponude: is_addon_work ne menja status glavnog posla pri prihvatanju; novi RN ugradnje posle prihvata.

ALTER TABLE public.field_reports
  ADD COLUMN IF NOT EXISTS addon_quote_site_request boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.field_reports.addon_quote_site_request IS
  'Montaža: samo upit za novu ponudu/dodatne radove (nije problem sa isporukom) — ne otvara installation_problem niti dopunski RN.';

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS is_addon_work boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quotes.is_addon_work IS
  'Dopunska ponuda posle ugrađenog posla; prihvatanje ne menja status posla, može otvoriti RN ugradnje za dopunu.';

ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS meta jsonb;

COMMENT ON COLUMN public.user_notifications.meta IS
  'Strukturisani podaci (npr. {"kind":"invoice_missing","position":"5"}) za akcije na dashboardu.';

CREATE TABLE IF NOT EXISTS public.sales_site_addon_quote_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  field_report_id uuid NOT NULL UNIQUE REFERENCES public.field_reports(id) ON DELETE CASCADE,
  worker_text text NOT NULL,
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_site_addon_quote_alerts_open
  ON public.sales_site_addon_quote_alerts (job_id)
  WHERE dismissed_at IS NULL;

ALTER TABLE public.sales_site_addon_quote_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_site_addon_quote_alerts_office_admin ON public.sales_site_addon_quote_alerts;
CREATE POLICY sales_site_addon_quote_alerts_office_admin ON public.sales_site_addon_quote_alerts
  FOR ALL TO authenticated
  USING (public.get_current_user_role() IN ('office'::public.user_role, 'admin'::public.user_role))
  WITH CHECK (public.get_current_user_role() IN ('office'::public.user_role, 'admin'::public.user_role));

CREATE TABLE IF NOT EXISTS public.invoice_missing_part_secured (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  position_key text NOT NULL,
  followup_work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_missing_part_secured_job_pos_uidx UNIQUE (job_id, position_key)
);

CREATE INDEX IF NOT EXISTS idx_invoice_missing_part_secured_job
  ON public.invoice_missing_part_secured (job_id);

ALTER TABLE public.invoice_missing_part_secured ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_missing_part_secured_roles ON public.invoice_missing_part_secured;
CREATE POLICY invoice_missing_part_secured_roles ON public.invoice_missing_part_secured
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() IN (
    'admin'::public.user_role,
    'procurement'::public.user_role,
    'production'::public.user_role
  ));

CREATE POLICY invoice_missing_part_secured_insert_roles ON public.invoice_missing_part_secured
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() IN (
    'admin'::public.user_role,
    'procurement'::public.user_role
  ));

-- ---------------------------------------------------------------------------
-- Nabavka: meta na hitnom obaveštenju (pozicija za akciju „deo obezbeđen“).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_procurement_production_urgent_site_missing(
  p_job_id uuid,
  p_position text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_number text;
  v_pos text;
  v_title text;
  v_desc text;
  v_dedupe text;
  v_meta jsonb;
BEGIN
  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  SELECT j.job_number::text INTO v_job_number
  FROM public.jobs j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_job_number := COALESCE(NULLIF(trim(COALESCE(v_job_number, '')), ''), '?');

  v_title := 'Hitno: Proizvodnja/Nabavka za Poziciju ' || v_pos || ' (Posao ' || v_job_number || ')';
  v_title := LEFT(v_title, 500);

  v_desc := 'Proverite naručivanje / proizvodnju za poziciju ' || v_pos || ' na poslu ' || v_job_number || '.';

  v_meta := jsonb_build_object('kind', 'invoice_missing', 'position', v_pos);

  v_dedupe := 'urgent-site-miss:' || p_job_id::text || ':' || v_pos;

  INSERT INTO public.user_notifications AS un (
    user_id,
    notification_type,
    title,
    description,
    priority,
    job_id,
    read,
    dedupe_key,
    meta
  )
  SELECT
    u.id,
    'urgent_on_site_missing',
    v_title,
    v_desc,
    'high',
    p_job_id,
    false,
    v_dedupe || ':' || u.id::text,
    v_meta
  FROM public.users AS u
  WHERE u.role IN (
      'procurement'::public.user_role,
      'production'::public.user_role,
      'admin'::public.user_role
    )
    AND COALESCE(u.active, true) IS TRUE
  ON CONFLICT (dedupe_key) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    meta = EXCLUDED.meta,
    read = false,
    created_at = now();
END;
$func$;

ALTER FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) SET search_path TO public;

-- ---------------------------------------------------------------------------
-- Deo obezbeđen: novi RN ugradnje + označena hitna obaveštenja pročitanim.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.secure_invoice_missing_part_schedule_installation(
  p_job_id uuid,
  p_position text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_pos text;
  v_pos_key text;
  v_wo_id uuid;
  v_desc text;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role INTO v_role FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  SELECT s.followup_work_order_id INTO v_existing
  FROM public.invoice_missing_part_secured s
  WHERE s.job_id = p_job_id AND s.position_key = v_pos_key;

  IF v_existing IS NOT NULL THEN
    UPDATE public.user_notifications un
    SET read = true
    WHERE un.job_id = p_job_id
      AND un.notification_type = 'urgent_on_site_missing'
      AND COALESCE(un.meta->>'position', '') = v_pos;

    RETURN v_existing;
  END IF;

  v_desc := LEFT(
    '[AUTO] Dopuna ugradnje — deo obezbeđen (poz. ' || v_pos || '). Zakažite montažu za ugradnju nedostajućeg dela.',
    6000
  );

  INSERT INTO public.work_orders (
    job_id,
    type,
    description,
    date,
    status,
    team_id,
    automation_field_report_id
  )
  VALUES (
    p_job_id,
    'installation'::public.work_order_type,
    v_desc,
    CURRENT_DATE,
    'pending'::public.work_order_status,
    NULL,
    NULL
  )
  RETURNING id INTO v_wo_id;

  INSERT INTO public.invoice_missing_part_secured (job_id, position_key, followup_work_order_id, created_by)
  VALUES (p_job_id, v_pos_key, v_wo_id, v_uid);

  UPDATE public.user_notifications un
  SET read = true
  WHERE un.job_id = p_job_id
    AND un.notification_type = 'urgent_on_site_missing'
    AND COALESCE(un.meta->>'position', '') = v_pos;

  RETURN v_wo_id;
END;
$func$;

ALTER FUNCTION public.secure_invoice_missing_part_schedule_installation(uuid, text) SET search_path TO public;

GRANT EXECUTE ON FUNCTION public.secure_invoice_missing_part_schedule_installation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_invoice_missing_part_schedule_installation(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Prodaja: lista i zatvaranje plavog alerta (dopunski upit sa terena).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_sales_site_addon_quote_alerts()
RETURNS TABLE (
  alert_id uuid,
  job_id uuid,
  job_number text,
  worker_text text,
  created_at timestamptz
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
    a.created_at
  FROM public.sales_site_addon_quote_alerts a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.dismissed_at IS NULL
  ORDER BY a.created_at DESC
  LIMIT 200;
END;
$func$;

ALTER FUNCTION public.list_sales_site_addon_quote_alerts() SET search_path TO public;

GRANT EXECUTE ON FUNCTION public.list_sales_site_addon_quote_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_sales_site_addon_quote_alerts() TO service_role;

CREATE OR REPLACE FUNCTION public.dismiss_sales_site_addon_quote_alert(p_alert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = v_uid
      AND u.role IN ('office'::public.user_role, 'admin'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  UPDATE public.sales_site_addon_quote_alerts a
  SET dismissed_at = now(),
      dismissed_by = v_uid
  WHERE a.id = p_alert_id
    AND a.dismissed_at IS NULL;
END;
$func$;

ALTER FUNCTION public.dismiss_sales_site_addon_quote_alert(uuid) SET search_path TO public;

GRANT EXECUTE ON FUNCTION public.dismiss_sales_site_addon_quote_alert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_sales_site_addon_quote_alert(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Posle prihvata dopunske ponude: RN ugradnje (bez menjanja statusa posla u triggeru).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_addon_installation_work_order_after_quote(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_id uuid;
  v_qnum text;
  v_desc text;
  v_wo_id uuid;
BEGIN
  SELECT q.job_id, COALESCE(q.quote_number::text, q.id::text)
  INTO v_job_id, v_qnum
  FROM public.quotes q
  WHERE q.id = p_quote_id
    AND COALESCE(q.is_addon_work, false) = true;

  IF v_job_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_desc := LEFT(
    '[AUTO] Dopuna ugradnje — prihvaćena dodatna ponuda (' || COALESCE(v_qnum, '') || '). Zakažite montažu.',
    6000
  );

  INSERT INTO public.work_orders (
    job_id,
    type,
    description,
    date,
    status,
    team_id,
    automation_field_report_id
  )
  VALUES (
    v_job_id,
    'installation'::public.work_order_type,
    v_desc,
    CURRENT_DATE,
    'pending'::public.work_order_status,
    NULL,
    NULL
  )
  RETURNING id INTO v_wo_id;

  RETURN v_wo_id;
END;
$func$;

ALTER FUNCTION public.create_addon_installation_work_order_after_quote(uuid) SET search_path TO public;

GRANT EXECUTE ON FUNCTION public.create_addon_installation_work_order_after_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_addon_installation_work_order_after_quote(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Ponuda -> status posla: dopunske ponude ne diraju glavni status.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_job_status_from_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job_status public.job_status;
  v_locked boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_addon_work, false) IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT j.status, COALESCE(j.status_locked, false)
  INTO v_job_status, v_locked
  FROM public.jobs j
  WHERE j.id = NEW.job_id;

  IF v_locked THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'sent'::public.quote_status AND v_job_status = 'new'::public.job_status THEN
    UPDATE public.jobs
    SET status = 'quote_sent'::public.job_status
    WHERE id = NEW.job_id
      AND status = 'new'::public.job_status;
  ELSIF NEW.status = 'sent'::public.quote_status AND v_job_status = 'measurement_processing'::public.job_status THEN
    UPDATE public.jobs
    SET status = 'final_quote_sent'::public.job_status
    WHERE id = NEW.job_id
      AND status = 'measurement_processing'::public.job_status;
  ELSIF NEW.status = 'accepted'::public.quote_status THEN
    UPDATE public.jobs
    SET status = 'accepted'::public.job_status
    WHERE id = NEW.job_id
      AND status IS DISTINCT FROM 'accepted'::public.job_status;
  ELSIF NEW.status = 'rejected'::public.quote_status THEN
    UPDATE public.jobs
    SET status = 'canceled'::public.job_status
    WHERE id = NEW.job_id
      AND status IS DISTINCT FROM 'canceled'::public.job_status;
  END IF;

  RETURN NEW;
END;
$func$;

ALTER FUNCTION public.sync_job_status_from_quote() SET search_path TO public;

-- ---------------------------------------------------------------------------
-- Grananje terenskog izveštaja: addon_quote_site_request.
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
    COALESCE(fr.addon_quote_site_request, false)
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
    v_addon_quote
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
          CASE WHEN v_has_missing THEN 'Nedostaje / nije isporučeno: ' || array_to_string(v_missing_items, ', ') ELSE NULL END,
          CASE WHEN v_has_additional THEN 'Tražena dopuna: ' || array_to_string(v_additional_needs, ', ') ELSE NULL END
        )
      ),
      6000
    );

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
        '[AUTO] Automatski je otvoren radni nalog: ' || initcap(replace(v_target_type::text, '_', ' ')) || '.',
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

REVOKE ALL ON FUNCTION public.apply_field_report_workflow_branching(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_field_report_workflow_branching(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_field_report_workflow_branching(uuid) TO service_role;
