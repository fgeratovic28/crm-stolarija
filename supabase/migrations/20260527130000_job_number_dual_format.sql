-- Dva formata broja posla: legacy (PO2026-055) podrazumevano, numeric (226246) tek posle izbora u podešavanjima.

DROP FUNCTION IF EXISTS public.peek_job_number_counter();

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS job_number_format text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_job_number_format_check;

ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_job_number_format_check
  CHECK (job_number_format IN ('legacy', 'numeric'));

COMMENT ON COLUMN public.app_settings.job_number_format IS
  'legacy = prefiks+godina-redni (PO2026-055); numeric = samo cifre (226246). Podrazumevano legacy.';

CREATE OR REPLACE FUNCTION public._app_job_number_format()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT CASE
    WHEN COALESCE(NULLIF(trim(a.job_number_format), ''), 'legacy') = 'numeric' THEN 'numeric'
    ELSE 'legacy'
  END
  FROM public.app_settings a
  WHERE a.id = 1;
$$;

CREATE OR REPLACE FUNCTION public._app_job_prefix()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(NULLIF(trim(a.job_prefix), ''), 'P')
  FROM public.app_settings a
  WHERE a.id = 1;
$$;

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

CREATE OR REPLACE FUNCTION public._next_job_number_numeric()
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

CREATE OR REPLACE FUNCTION public._next_job_number_legacy()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_prefix text;
  v_year integer;
  v_seq integer;
BEGIN
  v_prefix := public._app_job_prefix();
  v_year := extract(year FROM current_date)::integer;

  INSERT INTO public.job_number_counters AS c (prefix, year, last_value)
  VALUES (v_prefix, v_year, 1)
  ON CONFLICT (prefix, year)
  DO UPDATE SET last_value = c.last_value + 1
  RETURNING last_value INTO v_seq;

  RETURN v_prefix || v_year::text || '-' || lpad(v_seq::text, 3, '0');
END;
$func$;

CREATE OR REPLACE FUNCTION public.next_job_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
BEGIN
  IF public._app_job_number_format() = 'numeric' THEN
    RETURN public._next_job_number_numeric();
  END IF;
  RETURN public._next_job_number_legacy();
END;
$func$;

CREATE OR REPLACE FUNCTION public.peek_job_number_counter(
  p_format text DEFAULT NULL,
  p_prefix text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_format text;
  v_prefix text;
  v_year integer;
  v_suffix text;
  v_from_counter bigint;
  v_from_jobs bigint;
BEGIN
  v_format := CASE
    WHEN NULLIF(trim(COALESCE(p_format, '')), '') = 'numeric' THEN 'numeric'
    WHEN NULLIF(trim(COALESCE(p_format, '')), '') = 'legacy' THEN 'legacy'
    ELSE public._app_job_number_format()
  END;

  IF v_format = 'numeric' THEN
    SELECT c.last_value::bigint
    INTO v_from_counter
    FROM public.job_number_counters c
    WHERE c.prefix = '#'
      AND c.year = 0;

    v_from_jobs := public._job_number_max_from_jobs();

    RETURN GREATEST(COALESCE(v_from_counter, 0::bigint), COALESCE(v_from_jobs, 0::bigint)) + 1;
  END IF;

  v_prefix := COALESCE(NULLIF(trim(COALESCE(p_prefix, '')), ''), public._app_job_prefix());
  v_year := extract(year FROM current_date)::integer;
  v_suffix := v_prefix || v_year::text || '-';

  SELECT c.last_value::bigint
  INTO v_from_counter
  FROM public.job_number_counters c
  WHERE c.prefix = v_prefix
    AND c.year = v_year;

  SELECT COALESCE(
    MAX(substring(j.job_number FROM length(v_suffix) + 1)::bigint),
    0::bigint
  )
  INTO v_from_jobs
  FROM public.jobs j
  WHERE j.job_number LIKE v_suffix || '%'
    AND substring(j.job_number FROM length(v_suffix) + 1) ~ '^[0-9]+$';

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
  v_format text;
  v_prefix text;
  v_year integer;
BEGIN
  v_role := public.get_current_user_role();
  IF v_role IS DISTINCT FROM 'admin'::public.user_role THEN
    RAISE EXCEPTION 'Samo administrator može menjati brojač poslova.' USING ERRCODE = '42501';
  END IF;

  IF p_next_value IS NULL OR p_next_value < 1 OR p_next_value > 9999999999 THEN
    RAISE EXCEPTION 'Sledeći broj mora biti između 1 i 9999999999' USING ERRCODE = '22023';
  END IF;

  v_format := public._app_job_number_format();

  IF v_format = 'numeric' THEN
    INSERT INTO public.job_number_counters (prefix, year, last_value)
    VALUES ('#', 0, (p_next_value - 1)::integer)
    ON CONFLICT (prefix, year)
    DO UPDATE SET last_value = EXCLUDED.last_value;
    RETURN;
  END IF;

  v_prefix := public._app_job_prefix();
  v_year := extract(year FROM current_date)::integer;

  INSERT INTO public.job_number_counters (prefix, year, last_value)
  VALUES (v_prefix, v_year, (p_next_value - 1)::integer)
  ON CONFLICT (prefix, year)
  DO UPDATE SET last_value = EXCLUDED.last_value;
END;
$func$;

REVOKE ALL ON FUNCTION public.peek_job_number_counter(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_job_number_counter(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.peek_job_number_counter(text, text) TO service_role;
