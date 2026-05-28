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
  v_followup_shortage_id uuid;
  v_root_parent_id uuid;
  v_followup_first_line jsonb;
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

  IF mo.delivery_status IS DISTINCT FROM 'waiting_for_delivery'::public.delivery_status
     AND NOT (
       mo.is_shortage_order = true
       AND COALESCE(mo.site_missing_from_installation, false) = true
       AND mo.delivery_status = 'received_with_issues'::public.delivery_status
     ) THEN
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
              'source_order_id', p_order_id,
              'source_line_index', i,
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
    ELSIF mo.is_shortage_order = true AND (mi > 0 OR da > 0) THEN
      v_remaining_qty := mi + da;
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
          jsonb_build_object(
            'source_order_id', p_order_id,
            'source_line_index', i,
            'missing_qty', mi,
            'damaged_qty', da,
            'last_received_qty', ri,
            'last_received_at', now()
          ),
          true
        )
      );
      has_issues := true;
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

  IF mo.is_shortage_order = true
     AND jsonb_array_length(v_remaining_shortage_lines) > 0 THEN
    v_followup_shortage_id := gen_random_uuid();
    v_root_parent_id := coalesce(mo.parent_order_id, mo.id);
    v_followup_first_line := v_remaining_shortage_lines -> 0;

    INSERT INTO public.material_orders (
      id,
      job_id,
      supplier,
      supplier_id,
      supplier_contact,
      material_type,
      request_date,
      expected_delivery_date,
      delivery_status,
      delivered_ok,
      paid,
      payment_status,
      supplier_price,
      barcode,
      notes,
      parent_order_id,
      is_shortage_order,
      site_missing_from_installation,
      requires_production,
      nb_lines,
      items_json,
      nb_line_description,
      nb_quantity,
      nb_unit,
      nb_vat_rate_percent,
      nb_buyer_bank_account,
      nb_shipping_method,
      nb_payment_due_date,
      nb_payment_note,
      nb_legal_reference,
      nb_delivery_address_override
    )
    VALUES (
      v_followup_shortage_id,
      mo.job_id,
      mo.supplier,
      mo.supplier_id,
      mo.supplier_contact,
      mo.material_type,
      CURRENT_DATE,
      NULL,
      'pending'::public.delivery_status,
      false,
      false,
      'pending',
      0,
      NULL,
      '[AUTO] Nova porudžbina po nedostatku — manjak pri prijemu shortage porudžbine ' || substr(mo.id::text, 1, 8) || '.',
      v_root_parent_id,
      true,
      COALESCE(mo.site_missing_from_installation, false),
      COALESCE(mo.requires_production, false),
      v_remaining_shortage_lines,
      NULL,
      nullif(trim(coalesce(v_followup_first_line->>'description', '')), ''),
      COALESCE((v_followup_first_line->>'quantity')::numeric, 1),
      COALESCE(nullif(trim(v_followup_first_line->>'unit'), ''), 'kom'),
      mo.nb_vat_rate_percent,
      mo.nb_buyer_bank_account,
      mo.nb_shipping_method,
      mo.nb_payment_due_date,
      mo.nb_payment_note,
      mo.nb_legal_reference,
      mo.nb_delivery_address_override
    );

    new_status := 'materials_received'::public.delivery_status;
  ELSIF has_issues THEN
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
    delivered_ok = CASE WHEN new_status = 'materials_received'::public.delivery_status THEN true ELSE false END
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
    'shortage_order_id', v_followup_shortage_id
  );
END;
$rfn$;

REVOKE ALL ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
