ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS measurement_location text,
  ADD COLUMN IF NOT EXISTS measurement_scope text;
