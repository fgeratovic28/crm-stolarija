-- Ukloni politiku koja uzrokuje beskonačnu RLS rekurziju:
-- users (nova politika) -> podupit na jobs -> politike na jobs čitaju users -> opet users.
DROP POLICY IF EXISTS users_select_when_visible_as_job_creator ON public.users;

-- Ime kreatora na samom poslu (bez join-a na users u klijentskom upitu); migracija popunjava postojeće redove.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

UPDATE public.jobs j
SET created_by_name = NULLIF(TRIM(COALESCE(u.full_name, u.name, '')), '')
FROM public.users u
WHERE j.created_by IS NOT NULL
  AND j.created_by = u.id
  AND (j.created_by_name IS NULL OR TRIM(j.created_by_name) = '');
