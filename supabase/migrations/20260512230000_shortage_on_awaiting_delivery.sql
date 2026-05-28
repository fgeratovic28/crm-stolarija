-- Porudžbina po nedostatku se kreira (ili dopuni) tek kada reklamacija pređe u status
-- `awaiting_delivery` (U rešavanju / Čeka se dostava), a ne više automatski tokom prijema.
--
-- Tok:
--   1) Magacin prijavi nedostatak/oštećenje pri prijemu → kreira se samo reklamacija
--      sa statusom `reported_issue`; parent porudžbina ide u `received_with_issues`.
--   2) Nabavka pregleda i prebaci status reklamacije u `awaiting_delivery` → tek tada
--      sistem kreira/dopuni Porudžbinu po nedostatku sa linijom za tu reklamaciju.
--   3) Kada reklamacija pređe u `resolved_received` ili `canceled_refunded`, parent se
--      automatski zatvara (`materials_received`) ako više nema aktivnih reklamacija.

-- 1) finalize_procurement_order_reception: skida kreiranje shortage porudžbine.
--    Parent sa otvorenim reklamacijama ostaje u `received_with_issues`.
CREATE OR REPLACE FUNCTION public.finalize_procurement_order_reception(
  p_order_id uuid,
  p_reported_by uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $rfn$
DECLARE
  mo record;
  n int;
  i int;
  nb_line jsonb;
  elem jsonb;
  ri int;
  mi int;
  da int;
  q numeric;
  exp_qty int;
  has_issues boolean := false;
  complaints_n int := 0;
  meta jsonb;
  unit_eff text;
  notes_t text;
  photo_arr text[];
  len_mm int;
  item_details jsonb;
  new_status public.delivery_status;
  role public.user_role;
  v_new_id uuid;
  v_new_barcode text;
  v_resolved_complaint_ids uuid[] := ARRAY[]::uuid[];
  v_remaining_shortage_lines jsonb := '[]'::jsonb;
  v_remaining_qty int;
  v_line_source jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni';
  END IF;
  IF p_reported_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'reported_by mora biti trenutni korisnik';
  END IF;

  role := public.get_current_user_role();
  IF role IS NULL OR role NOT IN (
    'admin'::public.user_role,
    'procurement'::public.user_role,
    'production'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nemate dozvolu za prijem porudžbine';
  END IF;

  SELECT *
  INTO mo
  FROM public.material_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Narudžbina nije pronađena';
  END IF;

  IF mo.delivery_status IS DISTINCT FROM 'waiting_for_delivery'::public.delivery_status THEN
    RAISE EXCEPTION 'Narudžbina nije u statusu „čeka isporuku" (trenutno: %)', mo.delivery_status;
  END IF;

  IF mo.nb_lines IS NULL OR jsonb_typeof(mo.nb_lines) <> 'array' OR jsonb_array_length(mo.nb_lines) < 1 THEN
    RAISE EXCEPTION 'Narudžbina nema stavki (nb_lines)';
  END IF;

  n := jsonb_array_length(mo.nb_lines);
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) <> n THEN
    RAISE EXCEPTION 'Broj stavki prijema (%) ne odgovara narudžbini (%)', coalesce(jsonb_array_length(p_lines), -1), n;
  END IF;

  FOR i IN 0 .. (n - 1) LOOP
    nb_line := mo.nb_lines -> i;
    elem := p_lines -> i;

    ri := greatest(0, floor(coalesce((elem->>'received_intact')::numeric, 0)))::int;
    mi := greatest(0, floor(coalesce((elem->>'missing')::numeric, 0)))::int;
    da := greatest(0, floor(coalesce((elem->>'damaged')::numeric, 0)))::int;

    q := coalesce((nb_line->>'quantity')::numeric, 0);
    IF q IS NULL OR q <> q THEN
      q := 0;
    END IF;
    exp_qty := greatest(0, round(q))::int;

    IF exp_qty = 0 THEN
      IF (ri + mi + da) <> 0 THEN
        RAISE EXCEPTION 'Stavka %: očekivana količina 0, suma mora biti 0', i;
      END IF;
    ELSE
      IF (ri + mi + da) <> exp_qty THEN
        RAISE EXCEPTION 'Stavka %: zbir (ispravno + nedostaje + oštećeno) mora biti %', i, exp_qty;
      END IF;
    END IF;

    IF mo.is_shortage_order = true AND nb_line ? 'shortage_source' THEN
      -- Shortage porudžbina: parcijalni prijem ostavlja istu liniju sa preostalom količinom.
      v_remaining_qty := mi + da;
      v_line_source := coalesce(nb_line->'shortage_source', '{}'::jsonb);

      IF v_remaining_qty > 0 THEN
        v_remaining_shortage_lines := v_remaining_shortage_lines || jsonb_build_array(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                nb_line,
                '{quantity}',
                to_jsonb(v_remaining_qty),
                true
              ),
              '{orderedQuantity}',
              to_jsonb(v_remaining_qty),
              true
            ),
            '{shortage_source}',
            v_line_source || jsonb_build_object(
              'missing_qty', mi,
              'damaged_qty', da,
              'last_received_qty', ri,
              'last_received_at', now()
            ),
            true
          )
        );
        has_issues := true;
      ELSIF ri > 0 AND (v_line_source->>'complaint_id') IS NOT NULL THEN
        BEGIN
          v_resolved_complaint_ids := array_append(
            v_resolved_complaint_ids,
            (v_line_source->>'complaint_id')::uuid
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    ELSIF mi > 0 OR da > 0 THEN
      has_issues := true;
      notes_t := trim(coalesce(elem->>'notes', ''));
      IF length(notes_t) < 1 THEN
        RAISE EXCEPTION 'Stavka %: napomena je obavezna kada ima nedostatka ili oštećenja', i;
      END IF;

      photo_arr := COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(coalesce(elem->'photo_urls', '[]'::jsonb))),
        ARRAY[]::text[]
      );

      IF da > 0 AND cardinality(photo_arr) < 1 THEN
        RAISE EXCEPTION 'Stavka %: potrebna je fotografija kada je oštećeno > 0', i;
      END IF;

      meta := coalesce(nb_line->'procurementMeta', '{}'::jsonb);
      unit_eff := trim(coalesce(
        nullif(trim(meta->>'uom'), ''),
        nullif(trim(nb_line->>'unit'), ''),
        'kom'
      ));

      IF nullif(trim(meta->>'length_mm'), '') IS NOT NULL THEN
        BEGIN
          len_mm := round((trim(meta->>'length_mm'))::numeric)::int;
        EXCEPTION WHEN OTHERS THEN
          len_mm := NULL;
        END;
      ELSE
        len_mm := NULL;
      END IF;

      item_details := jsonb_strip_nulls(
        jsonb_build_object(
          'article',
          trim(coalesce(nullif(trim(meta->>'article'), ''), nullif(trim(nb_line->>'description'), ''), '')),
          'article_code', nullif(trim(meta->>'article_code'), ''),
          'color', nullif(trim(meta->>'color'), ''),
          'uom', unit_eff,
          'missing_qty', mi,
          'damaged_qty', da,
          'notes', notes_t,
          'work_order', nullif(trim(meta->>'work_order'), ''),
          'position', nullif(trim(meta->>'position'), ''),
          'length_mm', len_mm,
          'description', nullif(trim(nb_line->>'description'), ''),
          'source_order_id', p_order_id,
          'source_line_index', i,
          'material_type', coalesce(nullif(trim(nb_line->>'materialType'), ''), mo.material_type::text)
        )
      );

      v_new_id := gen_random_uuid();
      v_new_barcode := public.procurement_short_barcode('C', v_new_id);

      INSERT INTO public.procurement_complaints (
        id,
        order_id,
        item_details,
        photo_evidence_urls,
        status,
        reported_by,
        barcode
      )
      VALUES (
        v_new_id,
        p_order_id,
        item_details,
        photo_arr,
        'reported_issue',
        p_reported_by,
        v_new_barcode
      );

      complaints_n := complaints_n + 1;
    END IF;
  END LOOP;

  IF mo.is_shortage_order = true AND jsonb_array_length(v_remaining_shortage_lines) > 0 THEN
    new_status := 'waiting_for_delivery'::public.delivery_status;
  ELSIF has_issues THEN
    -- Parent porudžbina sa otvorenim reklamacijama ostaje sa „Sa reklamacijom"; Porudžbina po
    -- nedostatku se sada kreira tek kada nabavka markira reklamaciju kao `awaiting_delivery`.
    new_status := 'received_with_issues'::public.delivery_status;
  ELSE
    new_status := 'materials_received'::public.delivery_status;
  END IF;

  UPDATE public.material_orders
  SET
    delivery_status = new_status,
    delivery_date = CASE
      WHEN new_status = 'waiting_for_delivery'::public.delivery_status THEN delivery_date
      ELSE coalesce(delivery_date, CURRENT_DATE)
    END,
    delivered_ok = CASE WHEN new_status = 'materials_received'::public.delivery_status THEN true ELSE false END,
    nb_lines = CASE
      WHEN mo.is_shortage_order = true AND jsonb_array_length(v_remaining_shortage_lines) > 0
        THEN v_remaining_shortage_lines
      ELSE nb_lines
    END
  WHERE id = p_order_id;

  IF mo.is_shortage_order = true AND array_length(v_resolved_complaint_ids, 1) > 0 THEN
    UPDATE public.procurement_complaints
    SET status = 'resolved_received',
        resolved_at = coalesce(resolved_at, now()),
        resolved_by = coalesce(resolved_by, p_reported_by)
    WHERE id = ANY (v_resolved_complaint_ids)
      AND status IN ('reported_issue', 'awaiting_delivery');

    UPDATE public.material_orders parent_mo
    SET delivery_status = 'materials_received'::public.delivery_status
    WHERE parent_mo.id IN (
      SELECT DISTINCT pc.order_id
      FROM public.procurement_complaints pc
      WHERE pc.id = ANY (v_resolved_complaint_ids)
        AND pc.order_id IS NOT NULL
    )
    AND parent_mo.delivery_status = 'received_with_issues'::public.delivery_status
    AND NOT EXISTS (
      SELECT 1
      FROM public.procurement_complaints pc2
      WHERE pc2.order_id = parent_mo.id
        AND pc2.status IN ('reported_issue', 'awaiting_delivery')
    );
  END IF;

  IF mo.job_id IS NOT NULL THEN
    BEGIN
      PERFORM public.recompute_job_status(mo.job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'recompute_job_status posle prijema: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'delivery_status', new_status::text,
    'complaints_inserted', complaints_n,
    'has_issues', has_issues,
    'shortage_order_id', NULL
  );
END;
$rfn$;

REVOKE ALL ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) TO service_role;

-- 2) Helper: kreira/dopuni Porudžbinu po nedostatku za datu reklamaciju.
--    Ako parent već ima aktivnu (waiting_for_delivery) shortage porudžbinu, dodaje liniju;
--    inače pravi novu sa jednom linijom. Ako linija za ovu reklamaciju već postoji u nekoj
--    aktivnoj shortage porudžbini, izlazi bez izmene (idempotentno).
CREATE OR REPLACE FUNCTION public.ensure_shortage_order_for_complaint(p_complaint_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $sfn$
DECLARE
  v_complaint record;
  v_parent record;
  v_meta jsonb;
  v_details jsonb;
  v_mi int;
  v_da int;
  v_total int;
  v_unit text;
  v_description text;
  v_material_type text;
  v_existing_shortage_id uuid;
  v_existing_lines jsonb;
  v_already_present boolean := false;
  v_new_shortage_id uuid;
  v_short_ref text;
  v_shortage_notes text;
  v_shortage_line jsonb;
  v_root_parent_id uuid;
  v_root_parent_idx int;
  v_source_order_id uuid;
  v_source_line_idx int;
BEGIN
  SELECT *
  INTO v_complaint
  FROM public.procurement_complaints
  WHERE id = p_complaint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reklamacija nije pronađena';
  END IF;

  IF v_complaint.order_id IS NULL THEN
    RAISE EXCEPTION 'Reklamacija nema vezanu porudžbinu';
  END IF;

  v_details := coalesce(v_complaint.item_details, '{}'::jsonb);

  v_mi := greatest(0, coalesce((v_details->>'missing_qty')::int, 0));
  v_da := greatest(0, coalesce((v_details->>'damaged_qty')::int, 0));
  v_total := v_mi + v_da;
  IF v_total <= 0 THEN
    -- Reklamacija bez količinske nadoknade (npr. ručno dodata) — preskačemo kreiranje shortage-a.
    RETURN NULL;
  END IF;

  v_unit := nullif(trim(coalesce(v_details->>'uom', '')), '');
  IF v_unit IS NULL THEN v_unit := 'kom'; END IF;
  v_description := coalesce(
    nullif(trim(coalesce(v_details->>'description', '')), ''),
    nullif(trim(coalesce(v_details->>'article', '')), ''),
    'Stavka'
  );

  SELECT *
  INTO v_parent
  FROM public.material_orders
  WHERE id = v_complaint.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent porudžbina nije pronađena';
  END IF;

  v_material_type := nullif(trim(coalesce(v_details->>'material_type', '')), '');
  IF v_material_type IS NULL THEN v_material_type := v_parent.material_type::text; END IF;

  v_source_order_id := nullif(trim(coalesce(v_details->>'source_order_id', '')), '')::uuid;
  v_source_line_idx := coalesce((v_details->>'source_line_index')::int, NULL);

  -- shortage_source.parent_order_id treba da bude koren — ako je reklamacija na shortage
  -- porudžbini, parent_order_id se preuzima iz njenog parent_order_id (lanac se ne propagira).
  IF v_parent.is_shortage_order = true AND v_parent.parent_order_id IS NOT NULL THEN
    v_root_parent_id := v_parent.parent_order_id;
  ELSE
    v_root_parent_id := v_parent.id;
  END IF;
  v_root_parent_idx := coalesce(v_source_line_idx, 0);

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'article', nullif(trim(coalesce(v_details->>'article', '')), ''),
    'article_code', nullif(trim(coalesce(v_details->>'article_code', '')), ''),
    'color', nullif(trim(coalesce(v_details->>'color', '')), ''),
    'work_order', nullif(trim(coalesce(v_details->>'work_order', '')), ''),
    'position', nullif(trim(coalesce(v_details->>'position', '')), ''),
    'length_mm', v_details->'length_mm',
    'uom', v_unit
  ));

  -- Da li već postoji shortage porudžbina sa linijom za ovu reklamaciju?
  SELECT mo.id, coalesce(mo.nb_lines, '[]'::jsonb)
    INTO v_existing_shortage_id, v_existing_lines
  FROM public.material_orders mo
  WHERE mo.parent_order_id = v_root_parent_id
    AND mo.is_shortage_order = true
    AND mo.delivery_status IS DISTINCT FROM 'materials_received'::public.delivery_status
    AND mo.delivery_status IS DISTINCT FROM 'received_with_issues'::public.delivery_status
  ORDER BY mo.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_shortage_id IS NOT NULL THEN
    -- Proveri da li već postoji linija za ovu reklamaciju (idempotentno).
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_existing_lines) AS line
      WHERE (line->'shortage_source'->>'complaint_id') = p_complaint_id::text
    ) INTO v_already_present;

    IF v_already_present THEN
      RETURN v_existing_shortage_id;
    END IF;
  END IF;

  v_shortage_line := jsonb_build_object(
    'description', v_description,
    'materialType', v_material_type,
    'quantity', v_total,
    'orderedQuantity', v_total,
    'unit', v_unit,
    'procurementMeta', v_meta,
    'shortage_source', jsonb_build_object(
      'parent_order_id', v_root_parent_id,
      'parent_line_index', v_root_parent_idx,
      'missing_qty', v_mi,
      'damaged_qty', v_da,
      'complaint_id', p_complaint_id
    )
  );

  IF v_existing_shortage_id IS NOT NULL THEN
    UPDATE public.material_orders
    SET
      nb_lines = v_existing_lines || jsonb_build_array(v_shortage_line),
      delivery_status = 'waiting_for_delivery'::public.delivery_status,
      delivered_ok = false,
      paid = true,
      supplier_price = 0,
      payment_status = 'pending',
      notes = coalesce(notes, '') || E'\n\nDodata linija po nedostatku: ' || CURRENT_DATE::text
    WHERE id = v_existing_shortage_id;

    RETURN v_existing_shortage_id;
  END IF;

  -- Nema aktivne shortage porudžbine — kreiramo novu sa jednom linijom.
  v_new_shortage_id := gen_random_uuid();
  v_short_ref := substr(v_root_parent_id::text, 1, 8);
  v_shortage_notes := 'Porudžbina po nedostatku — referenca: ' || v_short_ref;
  IF nullif(trim(coalesce(v_parent.notes, '')), '') IS NOT NULL THEN
    v_shortage_notes := v_shortage_notes || E'\n\nOriginalna napomena:\n' || v_parent.notes;
  END IF;

  INSERT INTO public.material_orders (
    id,
    job_id,
    supplier,
    supplier_id,
    supplier_contact,
    material_type,
    request_date,
    delivery_status,
    delivered_ok,
    paid,
    payment_status,
    supplier_price,
    notes,
    nb_lines,
    parent_order_id,
    is_shortage_order
  )
  VALUES (
    v_new_shortage_id,
    v_parent.job_id,
    v_parent.supplier,
    v_parent.supplier_id,
    v_parent.supplier_contact,
    v_parent.material_type,
    CURRENT_DATE,
    'waiting_for_delivery'::public.delivery_status,
    false,
    true,
    'pending',
    0,
    v_shortage_notes,
    jsonb_build_array(v_shortage_line),
    v_root_parent_id,
    true
  );

  RETURN v_new_shortage_id;
END;
$sfn$;

REVOKE ALL ON FUNCTION public.ensure_shortage_order_for_complaint(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_shortage_order_for_complaint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_shortage_order_for_complaint(uuid) TO service_role;

COMMENT ON FUNCTION public.ensure_shortage_order_for_complaint(uuid) IS
  'Kreira ili dopuni aktivnu Porudžbinu po nedostatku linijom za datu reklamaciju (idempotentno).';

-- 3) update_procurement_complaint_status: pri prelasku u `awaiting_delivery` poziva helper za
--    kreiranje/dopunu shortage porudžbine.
CREATE OR REPLACE FUNCTION public.update_procurement_complaint_status(
  p_complaint_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n int;
  v_order_id uuid;
  v_active_count int;
  v_job_id uuid;
  v_normalized text;
  v_previous_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Morate biti prijavljeni';
  END IF;
  IF public.get_current_user_role() IS NULL
     OR public.get_current_user_role() NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
    RAISE EXCEPTION 'Nemate dozvolu';
  END IF;

  IF p_status IS NULL OR trim(p_status) = '' THEN
    RAISE EXCEPTION 'Status je obavezan';
  END IF;

  v_normalized := trim(p_status);
  IF v_normalized NOT IN (
    'reported_issue',
    'awaiting_delivery',
    'canceled_refunded',
    'resolved_received'
  ) THEN
    RAISE EXCEPTION 'Nepoznat status reklamacije';
  END IF;

  SELECT status, order_id
    INTO v_previous_status, v_order_id
  FROM public.procurement_complaints
  WHERE id = p_complaint_id;

  IF v_previous_status IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.procurement_complaints
  SET status = v_normalized,
      resolved_at = CASE
        WHEN v_normalized IN ('resolved_received', 'canceled_refunded') THEN coalesce(resolved_at, now())
        ELSE NULL
      END,
      resolved_by = CASE
        WHEN v_normalized IN ('resolved_received', 'canceled_refunded') THEN coalesce(resolved_by, auth.uid())
        ELSE NULL
      END
  WHERE id = p_complaint_id;

  GET DIAGNOSTICS n = ROW_COUNT;

  IF n > 0 THEN
    -- Pri prelasku u `awaiting_delivery` kreiramo / dopunimo Porudžbinu po nedostatku.
    IF v_normalized = 'awaiting_delivery' AND v_previous_status IS DISTINCT FROM 'awaiting_delivery' THEN
      BEGIN
        PERFORM public.ensure_shortage_order_for_complaint(p_complaint_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ensure_shortage_order_for_complaint nije uspeo: %', SQLERRM;
      END;
    END IF;

    IF v_order_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_active_count
      FROM public.procurement_complaints
      WHERE order_id = v_order_id
        AND status IN ('reported_issue', 'awaiting_delivery');

      IF v_active_count = 0 THEN
        UPDATE public.material_orders
        SET delivery_status = 'materials_received'
        WHERE id = v_order_id
          AND delivery_status = 'received_with_issues';
      END IF;

      SELECT mo.job_id INTO v_job_id
      FROM public.material_orders mo
      WHERE mo.id = v_order_id;

      IF v_job_id IS NOT NULL THEN
        BEGIN
          PERFORM public.recompute_job_status(v_job_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'recompute_job_status posle promene statusa reklamacije: %', SQLERRM;
        END;
      END IF;
    END IF;
  END IF;

  RETURN n > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.update_procurement_complaint_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_procurement_complaint_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_procurement_complaint_status(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
