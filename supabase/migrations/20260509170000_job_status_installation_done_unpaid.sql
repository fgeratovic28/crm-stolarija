-- Nova vrednost enuma (posebna migracija: PG ne dozvoljava korišćenje nove vrednosti u istoj transakciji kao ADD VALUE).
ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'installation_done_unpaid' AFTER 'installation_in_progress';
