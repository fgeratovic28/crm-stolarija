-- Guard: job cannot transition to `completed` while unpaid balance exists.
-- This protects all paths (RPC recompute, site_visit_success RPC, manual updates).

CREATE OR REPLACE FUNCTION public.jobs_guard_completed_requires_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_total_price numeric;
  v_total_paid numeric;
  v_unpaid numeric;
BEGIN
  IF NEW.status <> 'completed'::public.job_status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(j.total_price, 0)
  INTO v_total_price
  FROM public.jobs j
  WHERE j.id = NEW.id;

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_total_paid
  FROM public.payments p
  WHERE p.job_id = NEW.id;

  v_unpaid := v_total_price - v_total_paid;
  IF v_unpaid > 0.009 THEN
    -- Keep previous status until full payment is recorded.
    NEW.status := OLD.status;
    NEW.status_changed_at := OLD.status_changed_at;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_jobs_guard_completed_requires_payment ON public.jobs;
CREATE TRIGGER trg_jobs_guard_completed_requires_payment
  BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_guard_completed_requires_payment();

-- One-time correction: existing unpaid jobs currently marked as completed
-- are returned to "installation_in_progress".
UPDATE public.jobs j
SET status = 'installation_in_progress'::public.job_status
WHERE j.status = 'completed'::public.job_status
  AND (
    COALESCE(j.total_price, 0) - COALESCE((
      SELECT SUM(p.amount) FROM public.payments p WHERE p.job_id = j.id
    ), 0)
  ) > 0.009;
