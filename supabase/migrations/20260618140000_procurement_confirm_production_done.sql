CREATE OR REPLACE FUNCTION public.confirm_job_production_done(p_job_id uuid)
RETURNS TABLE (
  did_update boolean,
  previous_status public.job_status,
  next_status public.job_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_role public.user_role;
  v_previous public.job_status;
  v_next public.job_status := 'scheduled'::public.job_status;
  v_actor uuid := auth.uid();
BEGIN
  v_role := public.get_current_user_role();

  IF v_role IS DISTINCT FROM 'procurement'::public.user_role
     AND v_role IS DISTINCT FROM 'admin'::public.user_role
     AND v_role IS DISTINCT FROM 'office'::public.user_role THEN
    RAISE EXCEPTION 'Nemate dozvolu da potvrdite završetak proizvodnje.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.status
    INTO v_previous
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'Posao nije pronađen.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_previous NOT IN ('in_production'::public.job_status, 'partial_in_production'::public.job_status) THEN
    RAISE EXCEPTION 'Proizvodnja se može potvrditi samo kada je posao u proizvodnji.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.jobs
  SET status = v_next
  WHERE id = p_job_id
    AND coalesce(status_locked, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Status posla je zaključan.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.activities (job_id, type, description, author_id, date, system_key)
  VALUES (
    p_job_id,
    'other',
    '[AUTO] Status promenjen: U proizvodnji → Zakazano',
    v_actor,
    now(),
    'job-status:' || p_job_id::text || ':' || v_previous::text || ':' || v_next::text
  )
  ON CONFLICT (job_id, system_key) WHERE system_key IS NOT NULL DO UPDATE
  SET description = EXCLUDED.description,
      author_id = EXCLUDED.author_id,
      date = EXCLUDED.date,
      type = EXCLUDED.type;

  PERFORM public.ensure_workflow_work_orders(p_job_id);

  RETURN QUERY SELECT true, v_previous, v_next;
END;
$func$;

REVOKE ALL ON FUNCTION public.confirm_job_production_done(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_job_production_done(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_job_production_done(uuid) TO service_role;
