-- Trenutak završetka RN (status „završen“), npr. posle terenskog izveštaja.
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS field_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.work_orders.field_completed_at IS
  'Postavlja se pri prelasku RN u status „završen“ (npr. čuvanje terenskog izveštaja ili ručno u kancelariji).';
