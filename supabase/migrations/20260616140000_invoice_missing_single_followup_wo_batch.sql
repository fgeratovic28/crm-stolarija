-- Jedan RN dopune ugradnje za više pozicija istog posla (magacin bulk, prijem robe, gotov proizvod, potvrda proizvodnje).
-- invoice_missing_part_secure_core(..., p_reuse_installation_wo_id): opciono koristi postojeći pending RN ugradnje.

CREATE OR REPLACE FUNCTION public.invoice_missing_sync_followup_wo_description(p_wo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $sync$
DECLARE
  v_agg text;
BEGIN
  IF p_wo_id IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(s.position_key::text, ', ' ORDER BY s.position_key)
  INTO v_agg
  FROM public.invoice_missing_part_secured s
  WHERE s.followup_work_order_id = p_wo_id;

  IF v_agg IS NULL OR length(trim(both ' ' FROM v_agg)) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.work_orders w
  SET
    description = LEFT(
      '[AUTO] Dopuna ugradnje — delovi obezbeđeni (poz. ' || v_agg
        || '). Zakažite montažu za ugradnju nedostajućih delova.',
      6000
    )
  WHERE w.id = p_wo_id;
END;
$sync$;

ALTER FUNCTION public.invoice_missing_sync_followup_wo_description(uuid) SET search_path TO public;
REVOKE ALL ON FUNCTION public.invoice_missing_sync_followup_wo_description(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_sync_followup_wo_description(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.invoice_missing_part_secure_core(uuid, text);

CREATE OR REPLACE FUNCTION public.invoice_missing_part_secure_core(
  p_job_id uuid,
  p_position text,
  p_reuse_installation_wo_id uuid DEFAULT NULL
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
        'sent_to_supplier'::public.delivery_status,
        'waiting_for_payment'::public.delivery_status,
        'waiting_for_delivery'::public.delivery_status
      ) THEN
        RAISE EXCEPTION
          'Nabavka: porudžbina je već poslata / na isporuci. Sačekajte prijem u magacin ili se obratite nabavci za storno.'
          USING ERRCODE = '23514';
      ELSIF v_mo_status IN ('pending'::public.delivery_status, 'email_sent'::public.delivery_status) THEN
        UPDATE public.material_orders mo
        SET
          delivery_status = 'materials_received'::public.delivery_status,
          delivered_ok = true,
          delivery_date = coalesce(mo.delivery_date, CURRENT_DATE)
        WHERE mo.id = v_mo_id;
        DELETE FROM public.invoice_missing_site_procurement
        WHERE id = v_link_id;
      ELSIF v_mo_status = 'materials_received'::public.delivery_status AND v_await_prod IS NOT NULL THEN
        RAISE EXCEPTION
          'Roba je primljena i čeka proizvodnju. Koristite dugme „Proizvedeno — Zakaži ugradnju“ na kontrolnoj tabli.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  PERFORM public.invoice_missing_secured_delete_stale_for_position(p_job_id, v_pos_key);

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

    UPDATE public.invoice_missing_part_secured
    SET followup_work_order_id = v_wo_id
    WHERE id = v_secured_id;

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

  PERFORM public.invoice_missing_sync_followup_wo_description(v_wo_id);
  RETURN v_wo_id;
END;
$core$;

ALTER FUNCTION public.invoice_missing_part_secure_core(uuid, text, uuid) SET search_path TO public;
REVOKE ALL ON FUNCTION public.invoice_missing_part_secure_core(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_missing_part_secure_core(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_missing_part_secure_core(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.invoice_missing_part_secure_core(uuid, text, uuid) IS
  'Magacin / prijem / proizvodnja: RN dopune; opciono isti pending RN za sledeću poziciju (p_reuse_installation_wo_id).';

CREATE OR REPLACE FUNCTION public.secure_invoice_missing_parts_schedule_installation_batch(
  p_job_id uuid,
  p_positions text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $batch$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_shared uuid;
  v_ret uuid;
  v_pos text;
  v_list text[];
  v_i int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role
  INTO v_role
  FROM public.users u
  WHERE u.id = v_uid;

  IF v_role IS NULL OR v_role NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(t ORDER BY lower(t)), array[]::text[])
  INTO v_list
  FROM (
    SELECT DISTINCT ON (lower(trim(both ' ' FROM u.raw_pos)))
      trim(both ' ' FROM u.raw_pos) AS t
    FROM unnest(coalesce(p_positions, array[]::text[])) AS u(raw_pos)
    WHERE trim(both ' ' FROM u.raw_pos) <> ''
    ORDER BY lower(trim(both ' ' FROM u.raw_pos)), trim(both ' ' FROM u.raw_pos)
  ) x;

  IF coalesce(array_length(v_list, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Izaberite bar jednu poziciju.' USING ERRCODE = '23514';
  END IF;

  v_shared := NULL;
  v_i := 1;
  WHILE v_i <= array_length(v_list, 1)
  LOOP
    v_pos := v_list[v_i];
    v_ret := public.invoice_missing_part_secure_core(p_job_id, v_pos, v_shared);
    IF v_shared IS NULL THEN
      v_shared := v_ret;
    END IF;
    v_i := v_i + 1;
  END LOOP;

  IF v_shared IS NOT NULL THEN
    PERFORM public.invoice_missing_sync_followup_wo_description(v_shared);
  END IF;

  RETURN v_shared;
END;
$batch$;

ALTER FUNCTION public.secure_invoice_missing_parts_schedule_installation_batch(uuid, text[]) SET search_path TO public;
REVOKE ALL ON FUNCTION public.secure_invoice_missing_parts_schedule_installation_batch(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.secure_invoice_missing_parts_schedule_installation_batch(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_invoice_missing_parts_schedule_installation_batch(uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_material_orders_invoice_missing_site_reception_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tr$
DECLARE
  r record;
  v_reuse uuid;
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
    SELECT s.followup_work_order_id
    INTO v_reuse
    FROM public.invoice_missing_part_secured s
    INNER JOIN public.work_orders w ON w.id = s.followup_work_order_id
    WHERE s.job_id = r.job_id
      AND w.job_id = r.job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'pending'::public.work_order_status
    ORDER BY w.created_at DESC
    LIMIT 1;

    PERFORM public.invoice_missing_part_secure_core(r.job_id, r.position_display, v_reuse);
    UPDATE public.invoice_missing_site_procurement l
    SET completed_at = now(),
        awaiting_production_at = NULL
    WHERE l.id = r.id;
  END IF;

  RETURN NEW;
END;
$tr$;

CREATE OR REPLACE FUNCTION public.trg_procurement_ad_hoc_invoice_missing_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tr$
DECLARE
  r public.invoice_missing_site_procurement%ROWTYPE;
  v_reuse uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'received' THEN
      SELECT *
      INTO r
      FROM public.invoice_missing_site_procurement l
      WHERE l.ad_hoc_item_id = NEW.id
        AND l.completed_at IS NULL
      LIMIT 1;

      IF FOUND THEN
        IF COALESCE(NEW.vrsta_stavke, 'sirovine_za_proizvodnju') = 'gotov_proizvod' THEN
          SELECT s.followup_work_order_id
          INTO v_reuse
          FROM public.invoice_missing_part_secured s
          INNER JOIN public.work_orders w ON w.id = s.followup_work_order_id
          WHERE s.job_id = r.job_id
            AND w.job_id = r.job_id
            AND w.type = 'installation'::public.work_order_type
            AND w.status = 'pending'::public.work_order_status
          ORDER BY w.created_at DESC
          LIMIT 1;

          PERFORM public.invoice_missing_part_secure_core(r.job_id, r.position_display, v_reuse);
          UPDATE public.invoice_missing_site_procurement l
          SET completed_at = now(),
              awaiting_production_at = NULL
          WHERE l.id = r.id;
        ELSE
          UPDATE public.invoice_missing_site_procurement l
          SET awaiting_production_at = now()
          WHERE l.id = r.id;
        END IF;
      END IF;
    ELSIF NEW.status = 'canceled' THEN
      UPDATE public.material_orders mo
      SET
        delivery_status = 'materials_received'::public.delivery_status,
        delivered_ok = true,
        delivery_date = coalesce(mo.delivery_date, CURRENT_DATE),
        notes = coalesce(mo.notes, '')
          || E'\n[AUTO] Vanredna stavka otkazana — zatvorena Porudžbina po nedostatku (hitno sa ugradnje).'
      FROM public.invoice_missing_site_procurement l
      WHERE l.ad_hoc_item_id = NEW.id
        AND l.completed_at IS NULL
        AND l.ad_hoc_item_id IS NOT NULL
        AND mo.id = l.material_order_id
        AND COALESCE(mo.site_missing_from_installation, false) = true;

      DELETE FROM public.invoice_missing_site_procurement l
      WHERE l.ad_hoc_item_id = NEW.id
        AND l.completed_at IS NULL;
    END IF;
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
  v_reuse uuid;
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
        )
      )
    )
  FOR UPDATE
  LIMIT 1;

  IF v_link_id IS NULL THEN
    RAISE EXCEPTION 'Nema otvorenog koraka „čeka proizvodnju“ za ovu poziciju.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.invoice_missing_site_procurement l
  SET awaiting_production_at = NULL
  WHERE l.id = v_link_id;

  SELECT s.followup_work_order_id
  INTO v_reuse
  FROM public.invoice_missing_part_secured s
  INNER JOIN public.work_orders w ON w.id = s.followup_work_order_id
  WHERE s.job_id = p_job_id
    AND w.job_id = p_job_id
    AND w.type = 'installation'::public.work_order_type
    AND w.status = 'pending'::public.work_order_status
  ORDER BY w.created_at DESC
  LIMIT 1;

  v_wo := public.invoice_missing_part_secure_core(p_job_id, v_pos, v_reuse);

  UPDATE public.invoice_missing_site_procurement l
  SET completed_at = now()
  WHERE l.id = v_link_id;

  RETURN v_wo;
END;
$cf$;

ALTER FUNCTION public.invoice_missing_confirm_production_schedule_installation(uuid, text) SET search_path TO public;
