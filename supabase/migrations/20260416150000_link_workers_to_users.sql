-- Veza radnik -> korisnicki nalog (users), za lakse mapiranje evidencije i uloga.

ALTER TABLE public.workers
  ADD COLUMN user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_workers_user_id_unique
  ON public.workers(user_id)
  WHERE user_id IS NOT NULL;
