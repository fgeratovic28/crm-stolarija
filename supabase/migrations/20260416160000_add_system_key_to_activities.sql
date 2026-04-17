alter table public.activities
add column if not exists system_key text;

create unique index if not exists activities_job_id_system_key_unique
on public.activities (job_id, system_key)
where system_key is not null;
