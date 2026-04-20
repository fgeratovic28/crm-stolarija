-- Samo proširenje ENUM-a. Mora biti u posebnoj migraciji od UPDATE/RPC jer PostgreSQL
-- ne dozvoljava korišćenje novih vrednosti ENUM-a u istoj transakciji u kojoj su dodate (55P04).

ALTER TYPE public.job_status ADD VALUE 'quote_sent';
ALTER TYPE public.job_status ADD VALUE 'measuring';
ALTER TYPE public.job_status ADD VALUE 'in_production';
ALTER TYPE public.job_status ADD VALUE 'installation_in_progress';
