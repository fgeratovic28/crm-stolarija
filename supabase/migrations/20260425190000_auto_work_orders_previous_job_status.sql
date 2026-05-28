-- Track previous job status for auto-generated work orders.
-- Used when auto work order is manually canceled to restore job status.

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS auto_prev_job_status public.job_status;

COMMENT ON COLUMN public.work_orders.auto_prev_job_status IS
  'Snapshot of jobs.status when an auto-generated work order was created.';

CREATE OR REPLACE FUNCTION public.work_orders_set_auto_prev_job_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  IF NEW.auto_prev_job_status IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.automation_field_report_id IS NOT NULL
     OR NEW.description ~* '^\s*\[AUTO\]'
     OR NEW.description ~* '\mautomatski\M' THEN
    SELECT j.status INTO NEW.auto_prev_job_status
    FROM public.jobs j
    WHERE j.id = NEW.job_id;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_work_orders_set_auto_prev_job_status ON public.work_orders;
CREATE TRIGGER trg_work_orders_set_auto_prev_job_status
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.work_orders_set_auto_prev_job_status();
