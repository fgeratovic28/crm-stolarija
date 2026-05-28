-- create_child_job_from_addon_site_quote_alert kopira installation_lat/lng sa roditelja;
-- na projektima gde migracija 20260417123000 nije primenjena INSERT pada (42703).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS installation_lat double precision,
  ADD COLUMN IF NOT EXISTS installation_lng double precision,
  ADD COLUMN IF NOT EXISTS installation_location_source text;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_installation_coordinates_pair_chk'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_installation_coordinates_pair_chk
      CHECK (
        (installation_lat IS NULL AND installation_lng IS NULL)
        OR (installation_lat IS NOT NULL AND installation_lng IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_installation_lat_range_chk'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_installation_lat_range_chk
      CHECK (installation_lat IS NULL OR (installation_lat >= -90 AND installation_lat <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_installation_lng_range_chk'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_installation_lng_range_chk
      CHECK (installation_lng IS NULL OR (installation_lng >= -180 AND installation_lng <= 180));
  END IF;
END;
$chk$;

CREATE OR REPLACE FUNCTION public.create_child_job_from_addon_site_quote_alert(p_alert_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_parent_id uuid;
  v_worker_text text;
  v_new_job_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role INTO v_role FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('office'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  SELECT a.job_id, a.worker_text
  INTO v_parent_id, v_worker_text
  FROM public.sales_site_addon_quote_alerts a
  WHERE a.id = p_alert_id
    AND a.dismissed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alert nije pronađen ili je već zatvoren' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.jobs (
    customer_id,
    job_number,
    status,
    summary,
    billing_address,
    installation_address,
    customer_phone,
    parent_job_id,
    total_price,
    vat_amount,
    advance_payment,
    prices_include_vat,
    vat_rate_percent,
    created_by,
    installation_lat,
    installation_lng,
    installation_location_source,
    post_measurement_keep_initial_quote,
    status_locked
  )
  SELECT
    p.customer_id,
    public.next_additional_works_child_job_number(p.id),
    'new'::public.job_status,
    LEFT(
      trim(
        both E'\n'
        FROM concat_ws(E'\n', 'Dodatni radovi (upit sa terena)', NULLIF(trim(COALESCE(v_worker_text, '')), ''))
      ),
      2000
    ),
    p.billing_address,
    p.installation_address,
    p.customer_phone,
    p.id,
    0::numeric,
    0::numeric,
    0::numeric,
    COALESCE(p.prices_include_vat, true),
    COALESCE(p.vat_rate_percent, 0::smallint),
    v_uid,
    p.installation_lat,
    p.installation_lng,
    p.installation_location_source,
    false,
    false
  FROM public.jobs p
  WHERE p.id = v_parent_id
  RETURNING id INTO v_new_job_id;

  IF v_new_job_id IS NULL THEN
    RAISE EXCEPTION 'Roditeljski posao nije pronađen' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.sales_site_addon_quote_alerts a
  SET dismissed_at = now(),
      dismissed_by = v_uid
  WHERE a.id = p_alert_id;

  INSERT INTO public.activities (job_id, type, description, date, system_key, author_id)
  VALUES (
    v_new_job_id,
    'other'::public.communication_type,
    '[AUTO] Kreiran dodatni posao (dodatni radovi) iz prodajnog alerta sa terena.',
    NOW(),
    'child-job-from-addon-alert:' || v_new_job_id::text,
    v_uid
  );

  BEGIN
    PERFORM public.recompute_job_status(v_new_job_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_job_status (child from addon alert): %', SQLERRM;
  END;

  RETURN v_new_job_id;
END;
$func$;

NOTIFY pgrst, 'reload schema';
