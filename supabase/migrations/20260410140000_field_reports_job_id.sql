-- Klijent i upiti očekuju job_id na field_reports (filter, insert). Početna šema je imala samo work_order_id.
ALTER TABLE field_reports
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_field_reports_job_id ON field_reports(job_id);

-- Povratno punjenje iz radnog naloga (gde postoji veza)
UPDATE field_reports fr
SET job_id = wo.job_id
FROM work_orders wo
WHERE fr.work_order_id = wo.id
  AND fr.job_id IS NULL;
