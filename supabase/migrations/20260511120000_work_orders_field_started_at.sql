-- Trenutak pokretanja naloga (pending → in_progress): dolazak na teren za izveštaj bez ručnog unosa u formi.
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS field_started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.work_orders.field_started_at IS
  'Postavlja se pri prelasku RN u status „u toku“ (ekipa pokreće nalog). Koristi se kao vreme dolaska na teren u terenskom izveštaju.';
