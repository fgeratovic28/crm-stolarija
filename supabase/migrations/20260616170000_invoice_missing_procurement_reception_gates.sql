-- Hitni nedostatak (predračun): status prati nabavku; prijem tek na „čeka isporuku”; proizvodnja tek posle ispravnog prijema.

CREATE OR REPLACE FUNCTION public.invoice_missing_part_secure_core(
  p_job_id uuid,
  p_position text,
  p_reuse_installation_wo_id uuid DEFAULT NULL,
  p_defer_until_all_hitni_positions_ready boolean DEFAULT true,
  p_defer_peer_position_keys text[] DEFAULT NULL
)
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
  v_mo_id uuid;
  v_mo_status public.delivery_status;
  v_others_unread int := 0;
  v_peer_keys text[];
BEGIN
  IF p_reuse_installation_wo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.id = p_reuse_installation_wo_id
        AND w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status = 'pending'::public.work_order_status
    ) THEN
      RAISE EXCEPTION 'Nalog za spajanje nije validan pending RN ugradnje ovog posla.' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_link_id := NULL;
  v_ah_id := NULL;
  v_ah_status := NULL;
  v_await_prod := NULL;
  v_mo_id := NULL;
  v_mo_status := NULL;

  SELECT l.id, a.id, a.status, l.awaiting_production_at
  INTO v_link_id, v_ah_id, v_ah_status, v_await_prod
  FROM public.invoice_missing_site_procurement l
  INNER JOIN public.procurement_ad_hoc_items a ON a.id = l.ad_hoc_item_id
  WHERE l.job_id = p_job_id
    AND l.position_key = lower(trim(COALESCE(p_position, '')))
    AND l.completed_at IS NULL
  FOR UPDATE OF a, l
  LIMIT 1;

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

  IF v_link_id IS NULL THEN
    SELECT l.id, mo.id, mo.delivery_status, l.awaiting_production_at
    INTO v_link_id, v_mo_id, v_mo_status, v_await_prod
    FROM public.invoice_missing_site_procurement l
    INNER JOIN public.material_orders mo ON mo.id = l.material_order_id
    WHERE l.job_id = p_job_id
      AND l.position_key = lower(trim(COALESCE(p_position, '')))
      AND l.completed_at IS NULL
      AND l.ad_hoc_item_id IS NULL
      AND COALESCE(mo.site_missing_from_installation, false) = true
    FOR UPDATE OF mo, l
    LIMIT 1;

    IF v_link_id IS NOT NULL THEN
      IF v_mo_status IN (
        'pending'::public.delivery_status,
        'email_sent'::public.delivery_status,
        'sent_to_supplier'::public.delivery_status,
        'waiting_for_payment'::public.delivery_status,
        'waiting_for_delivery'::public.delivery_status,
        'shipped'::public.delivery_status,
        'delivered'::public.delivery_status,
        'partial'::public.delivery_status
      ) THEN
        RAISE EXCEPTION
          'Nabavka: porudžbina je u toku. Prenesite status na „Čeka isporuku”, završite prijem u magacinu, pa nastavite (ili „Proizvedeno” ako treba proizvodnja).'
          USING ERRCODE = '23514';
      ELSIF v_mo_status = 'materials_received'::public.delivery_status AND v_await_prod IS NOT NULL THEN
        RAISE EXCEPTION
          'Roba je primljena i čeka proizvodnju. Koristite dugme „Proizvedeno — Zakaži ugradnju“ na kontrolnoj tabli.'
          USING ERRCODE = '23514';
      ELSIF v_mo_status = 'received_with_issues'::public.delivery_status THEN
        RAISE EXCEPTION
          'Prijem je zabeležen sa problemom. Rešite nedostatke pre zakaživanja dopune ugradnje.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  SELECT coalesce(array_agg(DISTINCT lower(trim(both ' ' FROM z))), array[]::text[])
  INTO v_peer_keys
  FROM unnest(coalesce(p_defer_peer_position_keys, array[]::text[])) AS u(z)
  WHERE nullif(trim(both ' ' FROM z), '') IS NOT NULL;

  IF v_peer_keys IS NULL OR cardinality(v_peer_keys) = 0 THEN
    v_peer_keys := ARRAY[v_pos_key];
  END IF;

  PERFORM public.invoice_missing_secured_delete_stale_for_position(p_job_id, v_pos_key);

  IF p_defer_until_all_hitni_positions_ready AND p_reuse_installation_wo_id IS NULL THEN
    SELECT count(*)::int
    INTO v_others_unread
    FROM public.user_notifications un
    WHERE un.job_id = p_job_id
      AND un.notification_type = 'urgent_on_site_missing'
      AND coalesce(un.read, false) = false
      AND nullif(trim(coalesce(un.meta->>'position', '')), '') IS NOT NULL
      AND NOT (lower(trim(coalesce(un.meta->>'position', ''))) = ANY (v_peer_keys));
  END IF;

  SELECT s.id, s.followup_work_order_id
  INTO v_secured_id, v_existing_wo
  FROM public.invoice_missing_part_secured s
  WHERE s.job_id = p_job_id
    AND s.position_key = v_pos_key
  LIMIT 1;

  IF v_others_unread > 0 THEN
    IF v_existing_wo IS NOT NULL THEN
      UPDATE public.user_notifications un
      SET read = true
      WHERE un.job_id = p_job_id
        AND un.notification_type = 'urgent_on_site_missing'
        AND (
          lower(trim(coalesce(un.meta->>'position', ''))) = v_pos_key
          OR coalesce(un.meta->>'position', '') = v_pos
        );
      PERFORM public.invoice_missing_sync_followup_wo_description(v_existing_wo);
      RETURN v_existing_wo;
    END IF;

    IF v_secured_id IS NULL THEN
      INSERT INTO public.invoice_missing_part_secured (job_id, position_key, followup_work_order_id, created_by)
      VALUES (p_job_id, v_pos_key, NULL, auth.uid());
    END IF;

    RETURN NULL;
  END IF;

  IF v_secured_id IS NOT NULL THEN
    IF v_existing_wo IS NOT NULL THEN
      UPDATE public.user_notifications un
      SET read = true
      WHERE un.job_id = p_job_id
        AND un.notification_type = 'urgent_on_site_missing'
        AND (
          lower(trim(coalesce(un.meta->>'position', ''))) = v_pos_key
          OR coalesce(un.meta->>'position', '') = v_pos
        );
      PERFORM public.invoice_missing_sync_followup_wo_description(v_existing_wo);
      RETURN v_existing_wo;
    END IF;

    IF p_reuse_installation_wo_id IS NOT NULL THEN
      v_wo_id := p_reuse_installation_wo_id;
    ELSE
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
    END IF;

    UPDATE public.invoice_missing_part_secured s
    SET followup_work_order_id = v_wo_id
    WHERE s.job_id = p_job_id
      AND s.followup_work_order_id IS NULL;

    UPDATE public.invoice_missing_part_secured
    SET followup_work_order_id = v_wo_id
    WHERE id = v_secured_id
      AND followup_work_order_id IS NULL;

    UPDATE public.user_notifications un
    SET read = true
    WHERE un.job_id = p_job_id
      AND un.notification_type = 'urgent_on_site_missing';

    PERFORM public.invoice_missing_sync_followup_wo_description(v_wo_id);
    RETURN v_wo_id;
  END IF;

  IF p_reuse_installation_wo_id IS NOT NULL THEN
    v_wo_id := p_reuse_installation_wo_id;
  ELSE
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
  END IF;

  UPDATE public.invoice_missing_part_secured s
  SET followup_work_order_id = v_wo_id
  WHERE s.job_id = p_job_id
    AND s.followup_work_order_id IS NULL;

  INSERT INTO public.invoice_missing_part_secured (job_id, position_key, followup_work_order_id, created_by)
  VALUES (p_job_id, v_pos_key, v_wo_id, auth.uid());

  UPDATE public.user_notifications un
  SET read = true
  WHERE un.job_id = p_job_id
    AND un.notification_type = 'urgent_on_site_missing';

  PERFORM public.invoice_missing_sync_followup_wo_description(v_wo_id);
  RETURN v_wo_id;
END;
$core$;

CREATE OR REPLACE FUNCTION public.trg_material_orders_invoice_missing_site_reception_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tr$
DECLARE
  r record;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.delivery_status IS NOT DISTINCT FROM OLD.delivery_status THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.site_missing_from_installation, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.delivery_status IS DISTINCT FROM 'materials_received'::public.delivery_status THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.delivered_ok, false) = false THEN
    RETURN NEW;
  END IF;

  SELECT l.id, l.job_id, l.position_display, l.completed_at
  INTO r
  FROM public.invoice_missing_site_procurement l
  WHERE l.material_order_id = NEW.id
    AND l.completed_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.requires_production, false) THEN
    UPDATE public.invoice_missing_site_procurement l
    SET awaiting_production_at = now()
    WHERE l.id = r.id
      AND l.awaiting_production_at IS NULL;
  ELSE
    PERFORM public.invoice_missing_part_secure_core(r.job_id, r.position_display);
    UPDATE public.invoice_missing_site_procurement l
    SET completed_at = now(),
        awaiting_production_at = NULL
    WHERE l.id = r.id;
  END IF;

  RETURN NEW;
END;
$tr$;

CREATE OR REPLACE FUNCTION public.invoice_missing_confirm_production_schedule_installation(
  p_job_id uuid,
  p_position text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cf$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_pos text;
  v_pos_key text;
  v_link_id uuid;
  v_wo uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role
  INTO v_role
  FROM public.users u
  WHERE u.id = v_uid;

  IF v_role IS NULL OR v_role NOT IN (
    'admin'::public.user_role,
    'production'::public.user_role,
    'procurement'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  SELECT l.id
  INTO v_link_id
  FROM public.invoice_missing_site_procurement l
  WHERE l.job_id = p_job_id
    AND l.position_key = v_pos_key
    AND l.completed_at IS NULL
    AND l.awaiting_production_at IS NOT NULL
    AND (
      (
        l.ad_hoc_item_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.procurement_ad_hoc_items a
          WHERE a.id = l.ad_hoc_item_id
            AND a.status = 'received'
            AND a.vrsta_stavke = 'sirovine_za_proizvodnju'
        )
      )
      OR (
        l.ad_hoc_item_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.material_orders mo
          WHERE mo.id = l.material_order_id
            AND mo.delivery_status = 'materials_received'::public.delivery_status
            AND COALESCE(mo.requires_production, false) = true
            AND COALESCE(mo.delivered_ok, false) = true
        )
      )
    )
  FOR UPDATE
  LIMIT 1;

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION 'Nema otvorenog koraka „čeka proizvodnju“ za ovu poziciju (materijal mora biti ispravno primljen u magacin).' USING ERRCODE = '23514';
  END IF;

  UPDATE public.invoice_missing_site_procurement l
  SET awaiting_production_at = NULL
  WHERE l.id = v_link_id;

  v_wo := public.invoice_missing_part_secure_core(p_job_id, v_pos);

  UPDATE public.invoice_missing_site_procurement l
  SET completed_at = now()
  WHERE l.id = v_link_id;

  RETURN v_wo;
END;
$cf$;
