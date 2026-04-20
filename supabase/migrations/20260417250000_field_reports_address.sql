-- Adresa terena na izveštaju (unos iz modala; može se razlikovati od posla)
ALTER TABLE public.field_reports
  ADD COLUMN IF NOT EXISTS address TEXT;

UPDATE public.field_reports fr
SET address = j.installation_address
FROM public.work_orders wo
JOIN public.jobs j ON j.id = wo.job_id
WHERE fr.work_order_id = wo.id
  AND (fr.address IS NULL OR trim(fr.address) = '');
