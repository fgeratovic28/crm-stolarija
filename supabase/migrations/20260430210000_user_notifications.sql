-- Per-user persisted notifications (SECURITY DEFINER triggers + merges with client-side generated feed).

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON public.user_notifications(user_id, created_at DESC);

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS notif_new_complaints boolean NOT NULL DEFAULT true;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS notif_job_status_change boolean NOT NULL DEFAULT false;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RSD';

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notifications_select_own ON public.user_notifications;
CREATE POLICY user_notifications_select_own
  ON public.user_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notifications_update_own ON public.user_notifications;
CREATE POLICY user_notifications_update_own
  ON public.user_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Terenski RN: bez obzira na podešavanja (office toggles NE važe ovde).

CREATE OR REPLACE FUNCTION public.notify_work_order_team_assignment(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  wo record;
  v_customer text;
  v_type_sr text;
BEGIN
  SELECT w.id, w.job_id, w.team_id, w.type::text AS wt
  INTO wo
  FROM public.work_orders w
  WHERE w.id = p_work_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF wo.team_id IS NULL THEN
    RETURN;
  END IF;

  IF wo.wt NOT IN ('measurement', 'measurement_verification', 'installation', 'service') THEN
    RETURN;
  END IF;

  SELECT trim(c.name::text)
  INTO v_customer
  FROM public.jobs j
  JOIN public.customers c ON c.id = j.customer_id
  WHERE j.id = wo.job_id;

  v_customer := COALESCE(NULLIF(trim(COALESCE(v_customer, '')), ''), '—');

  v_type_sr := CASE wo.wt
    WHEN 'measurement' THEN 'Merenje'
    WHEN 'measurement_verification' THEN 'Merenje'
    WHEN 'installation' THEN 'Montaža'
    WHEN 'service' THEN 'Servis'
    ELSE wo.wt
  END;

  INSERT INTO public.user_notifications AS un (
    user_id,
    notification_type,
    title,
    description,
    priority,
    job_id,
    dedupe_key
  )
  SELECT
    u.id,
    'upcoming_installation',
    'Novi radni nalog',
    'Dodeljen Vam je novi nalog: ' || v_type_sr || ' za ' || v_customer || '.',
    'medium',
    wo.job_id,
    'wo-assign:' || p_work_order_id::text || ':' || u.id::text
  FROM public.users AS u
  WHERE u.team_id = wo.team_id
    AND u.role IN ('montaza'::public.user_role, 'teren'::public.user_role)
  ON CONFLICT (dedupe_key) DO UPDATE SET
    description = EXCLUDED.description,
    title = EXCLUDED.title,
    created_at = now(),
    read = false;

END;
$func$;

CREATE OR REPLACE FUNCTION public.trg_work_orders_assignment_notify_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.type::text NOT IN ('measurement', 'measurement_verification', 'installation', 'service') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_work_order_team_assignment(NEW.id);
  ELSIF TG_OP = 'UPDATE' AND OLD.team_id IS DISTINCT FROM NEW.team_id THEN
    PERFORM public.notify_work_order_team_assignment(NEW.id);
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_work_orders_assignment_notify ON public.work_orders;
CREATE TRIGGER trg_work_orders_assignment_notify
  AFTER INSERT OR UPDATE OF team_id ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_work_orders_assignment_notify_fn();

ALTER FUNCTION public.notify_work_order_team_assignment(uuid) SET search_path TO public;
ALTER FUNCTION public.trg_work_orders_assignment_notify_fn() SET search_path TO public;

-- Merenje završeno (office toggle notif_job_status_change).

CREATE OR REPLACE FUNCTION public.trg_measurement_wo_completed_notify_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  enabled boolean;
  v_customer text;
BEGIN
  IF NEW.type::text NOT IN ('measurement', 'measurement_verification') THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'completed'::public.work_order_status THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(a.notif_job_status_change, false)
  INTO enabled
  FROM public.app_settings a
  WHERE a.id = 1;

  IF NOT COALESCE(enabled, false) THEN
    RETURN NEW;
  END IF;

  SELECT trim(c.name::text)
  INTO v_customer
  FROM public.jobs j
  JOIN public.customers c ON c.id = j.customer_id
  WHERE j.id = NEW.job_id;

  v_customer := COALESCE(NULLIF(trim(COALESCE(v_customer, '')), ''), '—');

  INSERT INTO public.user_notifications AS un (
    user_id,
    notification_type,
    title,
    description,
    priority,
    job_id,
    dedupe_key
  )
  SELECT
    u.id,
    'job_status_change',
    'Merenje završeno',
    'Merenje završeno za ' || v_customer || '. Proverite da li su potrebne izmene ponude i cene.',
    'medium',
    NEW.job_id,
    'meas-done:' || NEW.job_id::text || ':' || u.id::text || ':' || NEW.id::text
  FROM public.users AS u
  WHERE u.role IN ('admin'::public.user_role, 'office'::public.user_role)
  ON CONFLICT (dedupe_key) DO UPDATE SET
    description = EXCLUDED.description,
    title = EXCLUDED.title,
    created_at = now(),
    read = false;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_measurement_wo_completed_notify ON public.work_orders;
CREATE TRIGGER trg_measurement_wo_completed_notify
  AFTER UPDATE OF status ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_measurement_wo_completed_notify_fn();

ALTER FUNCTION public.trg_measurement_wo_completed_notify_fn() SET search_path TO public;

-- Problem na terenu / nova reklamacija na poslu.

CREATE OR REPLACE FUNCTION public.notify_office_complaint_channel_message(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  enabled boolean;
  v_customer text;
BEGIN
  SELECT COALESCE(a.notif_new_complaints, true)
  INTO enabled
  FROM public.app_settings a
  WHERE a.id = 1;

  IF NOT COALESCE(enabled, true) THEN
    RETURN;
  END IF;

  SELECT trim(c.name::text)
  INTO v_customer
  FROM public.jobs j
  JOIN public.customers c ON c.id = j.customer_id
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_customer := COALESCE(NULLIF(trim(COALESCE(v_customer, '')), ''), '—');

  INSERT INTO public.user_notifications AS un (
    user_id,
    notification_type,
    title,
    description,
    priority,
    job_id,
    dedupe_key
  )
  SELECT
    u.id,
    'complaint',
    'Problem / reklamacija',
    'PROBLEM NA TERENU / Nova reklamacija: ' || v_customer || '.',
    'high',
    p_job_id,
    'complaint-ch:' || p_job_id::text || ':' || u.id::text
  FROM public.users AS u
  WHERE u.role IN ('admin'::public.user_role, 'office'::public.user_role)
  ON CONFLICT (dedupe_key) DO UPDATE SET
    description = EXCLUDED.description,
    title = EXCLUDED.title,
    priority = EXCLUDED.priority,
    created_at = now(),
    read = false;

END;
$func$;

CREATE OR REPLACE FUNCTION public.trg_field_reports_problem_notify_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_job uuid;
BEGIN
  v_job := COALESCE(NEW.job_id, (
    SELECT w.job_id FROM public.work_orders w WHERE w.id = NEW.work_order_id LIMIT 1
  ));

  IF v_job IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.site_canceled IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.everything_ok IS FALSE
     OR (NEW.issues IS NOT NULL AND length(trim(COALESCE(NEW.issues, ''))) > 0)
     OR COALESCE(cardinality(COALESCE(NEW.missing_items, ARRAY[]::text[])), 0) > 0
  THEN
    PERFORM public.notify_office_complaint_channel_message(v_job);
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_field_reports_problem_notify ON public.field_reports;
CREATE TRIGGER trg_field_reports_problem_notify
  AFTER INSERT ON public.field_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_field_reports_problem_notify_fn();

ALTER FUNCTION public.notify_office_complaint_channel_message(uuid) SET search_path TO public;
ALTER FUNCTION public.trg_field_reports_problem_notify_fn() SET search_path TO public;

CREATE OR REPLACE FUNCTION public.trg_jobs_complaint_status_notify_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  IF NEW.status::text = 'complaint' AND OLD.status::text IS DISTINCT FROM 'complaint' THEN
    PERFORM public.notify_office_complaint_channel_message(NEW.id);
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_jobs_complaint_status_notify ON public.jobs;
CREATE TRIGGER trg_jobs_complaint_status_notify
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_jobs_complaint_status_notify_fn();

ALTER FUNCTION public.trg_jobs_complaint_status_notify_fn() SET search_path TO public;

-- Prihvatanje ponude (toggle notif_job_status_change).

CREATE OR REPLACE FUNCTION public.trg_quotes_accepted_notification_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  enabled boolean;
  cur text;
  v_customer text;
  v_amt numeric;
  v_disp text;
BEGIN
  IF NEW.status::text <> 'accepted'::text THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text IS NOT DISTINCT FROM 'accepted'::text THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(a.notif_job_status_change, false), COALESCE(trim(a.currency::text), 'RSD'::text)
  INTO enabled, cur
  FROM public.app_settings a
  WHERE a.id = 1;

  IF NOT COALESCE(enabled, false) THEN
    RETURN NEW;
  END IF;

  v_amt := COALESCE(NEW.total_amount::numeric, 0::numeric);

  SELECT trim(c.name::text)
  INTO v_customer
  FROM public.jobs j
  JOIN public.customers c ON c.id = j.customer_id
  WHERE j.id = NEW.job_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_customer := COALESCE(NULLIF(trim(COALESCE(v_customer, '')), ''), '—');
  cur := COALESCE(NULLIF(trim(COALESCE(cur, '')), ''), 'RSD');
  v_disp := replace(trim(to_char(v_amt, 'FM999999999990.09')), '.', ',');

  INSERT INTO public.user_notifications AS un (
    user_id,
    notification_type,
    title,
    description,
    priority,
    job_id,
    dedupe_key
  )
  SELECT
    u.id,
    'job_status_change',
    'Prihvaćena ponuda',
    'Prihvaćena nova ponuda za ' || v_customer || '. Ugovorena cena je ažurirana na ' || v_disp || ' ' || cur || '.',
    'medium',
    NEW.job_id,
    'quote-acc:' || NEW.id::text || ':' || u.id::text
  FROM public.users AS u
  WHERE u.role IN ('admin'::public.user_role, 'office'::public.user_role, 'finance'::public.user_role)
  ON CONFLICT (dedupe_key) DO UPDATE SET
    description = EXCLUDED.description,
    title = EXCLUDED.title,
    created_at = now(),
    read = false;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_quotes_accepted_notification ON public.quotes;
CREATE TRIGGER trg_quotes_accepted_notification
  AFTER INSERT OR UPDATE OF status, total_amount ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_quotes_accepted_notification_fn();

ALTER FUNCTION public.trg_quotes_accepted_notification_fn() SET search_path TO public;
