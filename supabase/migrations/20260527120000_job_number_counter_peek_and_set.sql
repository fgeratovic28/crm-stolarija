-- Numeracija poslova: samo cifre (npr. 226246, 226247, …), uvek +1.
-- Globalni brojač u job_number_counters (prefix '#', year 0).

DROP FUNCTION IF EXISTS public.peek_job_number_counter(text, integer);
DROP FUNCTION IF EXISTS public.set_job_number_counter(text, integer, integer);
DROP FUNCTION IF EXISTS public.next_job_number(text, integer);

CREATE OR REPLACE FUNCTION public._job_number_max_from_jobs()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(MAX(j.job_number::bigint), 0::bigint)
  FROM public.jobs j
  WHERE j.job_number ~ '^[0-9]+$';
$$;

CREATE OR REPLACE FUNCTION public.next_job_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_seq bigint;
BEGIN
  INSERT INTO public.job_number_counters AS c (prefix, year, last_value)
  VALUES ('#', 0, 1)
  ON CONFLICT (prefix, year)
  DO UPDATE SET last_value = c.last_value + 1
  RETURNING last_value::bigint INTO v_seq;

  RETURN v_seq::text;
END;
$func$;

CREATE OR REPLACE FUNCTION public.peek_job_number_counter()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_from_counter bigint;
  v_from_jobs bigint;
BEGIN
  SELECT c.last_value::bigint
  INTO v_from_counter
  FROM public.job_number_counters c
  WHERE c.prefix = '#'
    AND c.year = 0;

  v_from_jobs := public._job_number_max_from_jobs();

  RETURN GREATEST(COALESCE(v_from_counter, 0::bigint), COALESCE(v_from_jobs, 0::bigint)) + 1;
END;
$func$;

CREATE OR REPLACE FUNCTION public.set_job_number_counter(p_next_value bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_role public.user_role;
BEGIN
  v_role := public.get_current_user_role();
  IF v_role IS DISTINCT FROM 'admin'::public.user_role THEN
    RAISE EXCEPTION 'Samo administrator može menjati brojač poslova.' USING ERRCODE = '42501';
  END IF;

  IF p_next_value IS NULL OR p_next_value < 1 OR p_next_value > 9999999999 THEN
    RAISE EXCEPTION 'Sledeći broj mora biti između 1 i 9999999999' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.job_number_counters (prefix, year, last_value)
  VALUES ('#', 0, (p_next_value - 1)::integer)
  ON CONFLICT (prefix, year)
  DO UPDATE SET last_value = EXCLUDED.last_value;
END;
$func$;

-- Početna sinhronizacija globalnog brojača (čisti brojevi u jobs + stari PO2026-NNN → NNN).
INSERT INTO public.job_number_counters (prefix, year, last_value)
SELECT
  '#',
  0,
  GREATEST(
    COALESCE(public._job_number_max_from_jobs(), 0::bigint),
    COALESCE(
      (
        SELECT MAX(substring(j.job_number FROM '([0-9]+)$')::bigint)
        FROM public.jobs j
        WHERE j.job_number ~ '-[0-9]+$'
      ),
      0::bigint
    )
  )::integer
ON CONFLICT (prefix, year) DO UPDATE
SET last_value = GREATEST(
  job_number_counters.last_value,
  EXCLUDED.last_value
);

REVOKE ALL ON FUNCTION public.next_job_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_job_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_job_number() TO service_role;

REVOKE ALL ON FUNCTION public.peek_job_number_counter() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_job_number_counter() TO authenticated;
GRANT EXECUTE ON FUNCTION public.peek_job_number_counter() TO service_role;

REVOKE ALL ON FUNCTION public.set_job_number_counter(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_job_number_counter(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_job_number_counter(bigint) TO service_role;
