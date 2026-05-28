-- Ranije: postojanje reda u `invoice_missing_part_secured` proveravano je preko `followup_work_order_id IS NOT NULL`.
-- Ako je `followup_work_order_id` NULL, drugi klik „Zaboravljeno u magacinu“ pokušava ponovo INSERT → 23505 duplicate key.

CREATE OR REPLACE FUNCTION public.invoice_missing_part_secure_core(p_job_id uuid, p_position text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $core$
DECLARE
  v_pos text;
  v_pos_key text;
  v_wo_id uuid;
  v_desc text;
  v_existing_wo uuid;
  v_secured_id uuid;
  v_link_id uuid;
  v_ah_id uuid;
  v_ah_status text;
  v_await_prod timestamptz;
BEGIN
  v_link_id := NULL;
  v_ah_id := NULL;
  v_ah_status := NULL;
  v_await_prod := NULL;

  SELECT l.id, a.id, a.status, l.awaiting_production_at
  INTO v_link_id, v_ah_id, v_ah_status, v_await_prod
  FROM public.invoice_missing_site_procurement l
  INNER JOIN public.procurement_ad_hoc_items a ON a.id = l.ad_hoc_item_id
  WHERE l.job_id = p_job_id
    AND l.position_key = lower(trim(COALESCE(p_position, '')))
    AND l.completed_at IS NULL
  FOR UPDATE;

  IF v_link_id IS NOT NULL THEN
    IF v_ah_status = 'ordered'::text THEN
      RAISE EXCEPTION
        'Nabavka: stavka je već poručena. Sačekajte prijem u magacin ili se obratite nabavci za storno.'
        USING ERRCODE = '23514';
    ELSIF v_ah_status = 'needs_order'::text THEN
      UPDATE public.procurement_ad_hoc_items
      SET status = 'canceled'
      WHERE id = v_ah_id;
      DELETE FROM public.invoice_missing_site_procurement
      WHERE id = v_link_id;
    ELSIF v_ah_status = 'received'::text AND v_await_prod IS NOT NULL THEN
      RAISE EXCEPTION
        'Roba je primljena i čeka proizvodnju. Koristite dugme „Proizvedeno — Zakaži ugradnju“ na kontrolnoj tabli.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  SELECT s.id, s.followup_work_order_id
  INTO v_secured_id, v_existing_wo
  FROM public.invoice_missing_part_secured s
  WHERE s.job_id = p_job_id
    AND s.position_key = v_pos_key
  LIMIT 1;

  IF v_secured_id IS NOT NULL THEN
    UPDATE public.user_notifications un
    SET read = true
    WHERE un.job_id = p_job_id
      AND un.notification_type = 'urgent_on_site_missing'
      AND (
        lower(trim(COALESCE(un.meta->>'position', ''))) = v_pos_key
        OR COALESCE(un.meta->>'position', '') = v_pos
      );

    IF v_existing_wo IS NOT NULL THEN
      RETURN v_existing_wo;
    END IF;

    v_desc := LEFT(
      '[AUTO] Dopuna ugradnje — deo obezbeđen (poz. ' || v_pos || '). Zakažite montažu za ugradnju nedostajućeg dela.',
      6000
    );

    INSERT INTO public.work_orders (
      job_id,
      type,
      description,
      date,
      status,
      team_id,
      automation_field_report_id
    )
    VALUES (
      p_job_id,
      'installation'::public.work_order_type,
      v_desc,
      CURRENT_DATE,
      'pending'::public.work_order_status,
      NULL,
      NULL
    )
    RETURNING id INTO v_wo_id;

    UPDATE public.invoice_missing_part_secured
    SET followup_work_order_id = v_wo_id
    WHERE id = v_secured_id;

    RETURN v_wo_id;
  END IF;

  v_desc := LEFT(
    '[AUTO] Dopuna ugradnje — deo obezbeđen (poz. ' || v_pos || '). Zakažite montažu za ugradnju nedostajućeg dela.',
    6000
  );

  INSERT INTO public.work_orders (
    job_id,
    type,
    description,
    date,
    status,
    team_id,
    automation_field_report_id
  )
  VALUES (
    p_job_id,
    'installation'::public.work_order_type,
    v_desc,
    CURRENT_DATE,
    'pending'::public.work_order_status,
    NULL,
    NULL
  )
  RETURNING id INTO v_wo_id;

  INSERT INTO public.invoice_missing_part_secured (job_id, position_key, followup_work_order_id, created_by)
  VALUES (p_job_id, v_pos_key, v_wo_id, auth.uid());

  UPDATE public.user_notifications un
  SET read = true
  WHERE un.job_id = p_job_id
    AND un.notification_type = 'urgent_on_site_missing'
    AND (
      lower(trim(COALESCE(un.meta->>'position', ''))) = v_pos_key
      OR COALESCE(un.meta->>'position', '') = v_pos
    );

  RETURN v_wo_id;
END;
$core$;

ALTER FUNCTION public.invoice_missing_part_secure_core(uuid, text) SET search_path TO public;

REVOKE ALL ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) TO service_role;

COMMENT ON FUNCTION public.invoice_missing_part_secure_core(uuid, text) IS
  'Magacin „deo obezbeđen“: idempotentno po (job_id, position_key); popunjava followup_work_order_id ako je ranije bio NULL.';
