-- Kancelarija (office) prima ista hitna obaveštenja kao nabavka/proizvodnja za nedostatak sa predračuna na terenu.

CREATE OR REPLACE FUNCTION public.notify_procurement_production_urgent_site_missing(
  p_job_id uuid,
  p_position text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_job_number text;
  v_pos text;
  v_title text;
  v_desc text;
  v_dedupe text;
  v_meta jsonb;
BEGIN
  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  PERFORM public.invoice_missing_secured_delete_stale_for_position(p_job_id, lower(v_pos));

  SELECT j.job_number::text INTO v_job_number
  FROM public.jobs j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_job_number := COALESCE(NULLIF(trim(COALESCE(v_job_number, '')), ''), '?');

  v_title := 'Hitno: Proizvodnja/Nabavka za Poziciju ' || v_pos || ' (Posao ' || v_job_number || ')';
  v_title := LEFT(v_title, 500);

  v_desc := 'Proverite naručivanje / proizvodnju za poziciju ' || v_pos || ' na poslu ' || v_job_number || '.';

  v_meta := jsonb_build_object('kind', 'invoice_missing', 'position', v_pos);

  v_dedupe := 'urgent-site-miss:' || p_job_id::text || ':' || v_pos;

  INSERT INTO public.user_notifications AS un (
    user_id,
    notification_type,
    title,
    description,
    priority,
    job_id,
    read,
    dedupe_key,
    meta
  )
  SELECT
    u.id,
    'urgent_on_site_missing',
    v_title,
    v_desc,
    'high',
    p_job_id,
    false,
    v_dedupe || ':' || u.id::text,
    v_meta
  FROM public.users AS u
  WHERE u.role IN (
      'procurement'::public.user_role,
      'production'::public.user_role,
      'admin'::public.user_role,
      'office'::public.user_role
    )
    AND COALESCE(u.active, true) IS TRUE
  ON CONFLICT (dedupe_key) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    meta = EXCLUDED.meta,
    read = false,
    created_at = now();
END;
$func$;

ALTER FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) SET search_path TO public;

COMMENT ON FUNCTION public.notify_procurement_production_urgent_site_missing(uuid, text) IS
  'Hitno obaveštenje za nedostatak sa predračuna: procurement, production, admin, office.';

NOTIFY pgrst, 'reload schema';
