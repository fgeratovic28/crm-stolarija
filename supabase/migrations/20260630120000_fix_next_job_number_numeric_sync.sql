-- next_job_number (numeric / YYMM) mora uvek biti veći od postojećih brojeva u jobs.

CREATE OR REPLACE FUNCTION public._job_number_max_seq_numeric_current_month()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(
    MAX(substring(j.job_number FROM length(public._job_number_numeric_yymm()) + 1)::bigint),
    0::bigint
  )
  FROM public.jobs j
  WHERE j.job_number ~ ('^' || public._job_number_numeric_yymm() || '[0-9]+$')
    AND length(j.job_number) > length(public._job_number_numeric_yymm());
$$;

CREATE OR REPLACE FUNCTION public._next_job_number_numeric()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_period integer;
  v_yymm text;
  v_seq integer;
  v_max_jobs bigint;
BEGIN
  v_period := public._job_number_numeric_period();
  v_yymm := public._job_number_numeric_yymm();
  v_max_jobs := public._job_number_max_seq_numeric_current_month();

  INSERT INTO public.job_number_counters AS c (prefix, year, last_value)
  VALUES ('#', v_period, GREATEST(1, v_max_jobs + 1)::integer)
  ON CONFLICT (prefix, year)
  DO UPDATE SET last_value = GREATEST(c.last_value, v_max_jobs) + 1
  RETURNING last_value INTO v_seq;

  RETURN v_yymm || lpad(v_seq::text, 2, '0');
END;
$func$;

UPDATE public.job_number_counters c
SET last_value = GREATEST(
  c.last_value,
  public._job_number_max_seq_numeric_current_month()
)
WHERE c.prefix = '#'
  AND c.year = public._job_number_numeric_period();
