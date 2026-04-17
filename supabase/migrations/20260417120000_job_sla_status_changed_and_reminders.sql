-- SLA: track last status change; auto activities when a job stays too long in new / active / waiting_materials.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

UPDATE public.jobs
SET status_changed_at = COALESCE(status_changed_at, created_at, now())
WHERE status_changed_at IS NULL;

ALTER TABLE public.jobs
  ALTER COLUMN status_changed_at SET DEFAULT now(),
  ALTER COLUMN status_changed_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.jobs_touch_status_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $func$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := COALESCE(NEW.created_at, now());
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS jobs_set_status_changed_at ON public.jobs;
CREATE TRIGGER jobs_set_status_changed_at
  BEFORE INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_touch_status_changed_at();

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS notif_stale_job_status boolean NOT NULL DEFAULT true;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS job_stale_status_days integer NOT NULL DEFAULT 7;

CREATE OR REPLACE FUNCTION public.run_job_sla_stale_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
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
        WHEN 'new' THEN 'Novi'
        WHEN 'active' THEN 'Aktivan'
        WHEN 'waiting_materials' THEN 'Čeka materijal'
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
    WHERE j.status IN ('new', 'active', 'waiting_materials')
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
$func$;

ALTER FUNCTION public.run_job_sla_stale_reminders() SET search_path TO public;

REVOKE ALL ON FUNCTION public.run_job_sla_stale_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_job_sla_stale_reminders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_job_sla_stale_reminders() TO service_role;
