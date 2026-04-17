alter table public.jobs
add column if not exists status_locked boolean not null default false;
