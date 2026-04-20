-- Terenski izveštaj: JSONB detalji (timestamp-ovi akcija) + procena sati ugradnje.
-- Posao: estimated_installation_hours (sinhronizacija sa merenja preko trigera — teren nema UPDATE na jobs).

ALTER TABLE public.field_reports
  ADD COLUMN IF NOT EXISTS site_canceled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.field_reports
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE public.field_reports
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.field_reports
  ADD COLUMN IF NOT EXISTS estimated_installation_hours NUMERIC(10, 2);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS estimated_installation_hours NUMERIC(10, 2);

CREATE OR REPLACE FUNCTION public.sync_job_estimated_installation_hours_from_field_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_wo_type public.work_order_type;
BEGIN
  IF NEW.estimated_installation_hours IS NULL OR NEW.work_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT wo.job_id, wo.type
  INTO v_job_id, v_wo_type
  FROM public.work_orders wo
  WHERE wo.id = NEW.work_order_id;

  IF v_job_id IS NULL OR v_wo_type IS DISTINCT FROM 'measurement'::public.work_order_type THEN
    RETURN NEW;
  END IF;

  UPDATE public.jobs
  SET estimated_installation_hours = NEW.estimated_installation_hours
  WHERE id = v_job_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_field_reports_sync_job_estimated_hours ON public.field_reports;

CREATE TRIGGER trg_field_reports_sync_job_estimated_hours
  AFTER INSERT OR UPDATE OF estimated_installation_hours, work_order_id
  ON public.field_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_job_estimated_installation_hours_from_field_report();
