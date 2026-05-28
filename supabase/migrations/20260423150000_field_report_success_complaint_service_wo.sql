-- Nakon garancije: terenski izveštaj na RN tipa reklamacija ili servis takođe vraća posao u Završen
-- (ne samo site_visit).
CREATE OR REPLACE FUNCTION public.apply_field_report_site_visit_success(p_field_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_wo public.work_order_type;
  v_job_id uuid;
  v_st public.job_status;
  v_fr_ok boolean;
  v_canceled boolean;
BEGIN
  SELECT wo.type, wo.job_id, j.status, COALESCE(fr.everything_ok, true), COALESCE(fr.site_canceled, false)
  INTO v_wo, v_job_id, v_st, v_fr_ok, v_canceled
  FROM public.field_reports fr
  INNER JOIN public.work_orders wo ON wo.id = fr.work_order_id
  INNER JOIN public.jobs j ON j.id = wo.job_id
  WHERE fr.id = p_field_report_id;

  IF NOT FOUND OR v_job_id IS NULL THEN
    RETURN;
  END IF;

  IF v_wo NOT IN (
    'site_visit'::public.work_order_type,
    'complaint'::public.work_order_type,
    'service'::public.work_order_type
  ) THEN
    RETURN;
  END IF;

  IF v_canceled OR v_fr_ok IS NOT TRUE THEN
    RETURN;
  END IF;

  IF v_st = 'installation_problem'::public.job_status THEN
    UPDATE public.jobs
    SET
      status = 'completed'::public.job_status,
      status_changed_at = NOW()
    WHERE id = v_job_id
      AND status = 'installation_problem'::public.job_status;
    RETURN;
  END IF;

  IF v_st IN ('complaint'::public.job_status, 'service'::public.job_status) THEN
    UPDATE public.jobs
    SET
      status = 'completed'::public.job_status,
      status_changed_at = NOW()
    WHERE id = v_job_id
      AND status IN ('complaint'::public.job_status, 'service'::public.job_status);
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public.apply_field_report_site_visit_success(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_field_report_site_visit_success(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_field_report_site_visit_success(uuid) TO service_role;
