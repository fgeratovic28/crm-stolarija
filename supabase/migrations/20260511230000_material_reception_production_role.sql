-- Production team (proizvodnja) treba pristup ekranu prijema materijala (Prijem robe).
-- Ova migracija širi RLS i RPC dozvole tako da uloga `production` može da:
--   1) Učita material_orders red preko REST-a (SELECT),
--   2) Skenira C-/A- barkode kroz `receive_procurement_barcode`,
--   3) Završi prijem preko `finalize_procurement_order_reception` (uključujući kreiranje
--      reklamacija i sub-porudžbina po nedostatku).

-- 1) RLS: SELECT za proizvodnju na material_orders / procurement_complaints / procurement_ad_hoc_items.
DROP POLICY IF EXISTS production_read_material_orders ON public.material_orders;
CREATE POLICY production_read_material_orders ON public.material_orders
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'production'::public.user_role);

DROP POLICY IF EXISTS production_read_procurement_complaints ON public.procurement_complaints;
CREATE POLICY production_read_procurement_complaints ON public.procurement_complaints
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'production'::public.user_role);

DROP POLICY IF EXISTS production_read_procurement_ad_hoc_items ON public.procurement_ad_hoc_items;
CREATE POLICY production_read_procurement_ad_hoc_items ON public.procurement_ad_hoc_items
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'production'::public.user_role);

-- 2) RPC: dozvoli production ulozi da skenira barkode reklamacija / vanrednih stavki.
CREATE OR REPLACE FUNCTION public.receive_procurement_barcode(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $rfn$
DECLARE
  v_code text;
  v_role public.user_role;
  v_complaint_id uuid;
  v_complaint_order_id uuid;
  v_complaint_job_id uuid;
  v_complaint_already_resolved boolean;
  v_ad_hoc_id uuid;
  v_ad_hoc_order_id uuid;
  v_ad_hoc_job_id uuid;
  v_ad_hoc_already_resolved boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Morate biti prijavljeni';
  END IF;

  v_role := public.get_current_user_role();
  IF v_role IS NULL OR v_role NOT IN (
    'admin'::public.user_role,
    'procurement'::public.user_role,
    'production'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nemate dozvolu za prijem';
  END IF;

  v_code := upper(trim(coalesce(p_barcode, '')));
  IF length(v_code) = 0 THEN
    RAISE EXCEPTION 'Barkod je prazan';
  END IF;

  -- 1) Reklamacija (C-barkod).
  SELECT pc.id, pc.order_id, mo.job_id,
         (pc.status IN ('resolved_received', 'canceled_refunded'))
    INTO v_complaint_id, v_complaint_order_id, v_complaint_job_id, v_complaint_already_resolved
  FROM public.procurement_complaints pc
  LEFT JOIN public.material_orders mo ON mo.id = pc.order_id
  WHERE upper(pc.barcode) = v_code
  LIMIT 1;

  IF v_complaint_id IS NOT NULL THEN
    IF NOT v_complaint_already_resolved THEN
      UPDATE public.procurement_complaints
      SET status = 'resolved_received',
          resolved_at = coalesce(resolved_at, now()),
          resolved_by = coalesce(resolved_by, auth.uid())
      WHERE id = v_complaint_id;

      IF v_complaint_order_id IS NOT NULL THEN
        UPDATE public.material_orders parent_mo
        SET delivery_status = 'materials_received'::public.delivery_status
        WHERE parent_mo.id = v_complaint_order_id
          AND parent_mo.delivery_status = 'received_with_issues'::public.delivery_status
          AND NOT EXISTS (
            SELECT 1
            FROM public.procurement_complaints pc2
            WHERE pc2.order_id = v_complaint_order_id
              AND pc2.status IN ('reported_issue', 'awaiting_delivery')
          );
      END IF;

      IF v_complaint_job_id IS NOT NULL THEN
        BEGIN
          PERFORM public.recompute_job_status(v_complaint_job_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'recompute_job_status posle skena C-barkoda: %', SQLERRM;
        END;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'kind', 'complaint',
      'id', v_complaint_id,
      'order_id', v_complaint_order_id,
      'already_resolved', v_complaint_already_resolved
    );
  END IF;

  -- 2) Vanredna stavka (A-barkod).
  SELECT ahi.id, ahi.order_id, mo.job_id,
         (ahi.status = 'resolved_received')
    INTO v_ad_hoc_id, v_ad_hoc_order_id, v_ad_hoc_job_id, v_ad_hoc_already_resolved
  FROM public.procurement_ad_hoc_items ahi
  LEFT JOIN public.material_orders mo ON mo.id = ahi.order_id
  WHERE upper(ahi.barcode) = v_code
  LIMIT 1;

  IF v_ad_hoc_id IS NOT NULL THEN
    IF NOT v_ad_hoc_already_resolved THEN
      UPDATE public.procurement_ad_hoc_items
      SET status = 'resolved_received',
          resolved_at = coalesce(resolved_at, now()),
          resolved_by = coalesce(resolved_by, auth.uid())
      WHERE id = v_ad_hoc_id;

      IF v_ad_hoc_job_id IS NOT NULL THEN
        BEGIN
          PERFORM public.recompute_job_status(v_ad_hoc_job_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'recompute_job_status posle skena A-barkoda: %', SQLERRM;
        END;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'kind', 'ad_hoc',
      'id', v_ad_hoc_id,
      'order_id', v_ad_hoc_order_id,
      'already_resolved', v_ad_hoc_already_resolved
    );
  END IF;

  RAISE EXCEPTION 'Barkod % nije pronađen.', v_code;
END;
$rfn$;

REVOKE ALL ON FUNCTION public.receive_procurement_barcode(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_procurement_barcode(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_procurement_barcode(text) TO service_role;

-- 3) Finalizacija prijema porudžbine — dodato `production` u dozvoljene uloge.
--    Shortage porudžbina je express tok: parent se zatvara kao primljen, a shortage ide direktno u prijem.
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
  shortage_lines jsonb := '[]'::jsonb;
  shortage_line jsonb;
  v_shortage_order_id uuid := NULL;
  v_short_ref text;
  v_shortage_notes text;
  v_root_parent_id uuid;
  v_root_parent_idx int;
  v_resolved_complaint_ids uuid[] := ARRAY[]::uuid[];
  v_existing_source jsonb;
  v_remaining_shortage_lines jsonb := '[]'::jsonb;
  v_remaining_qty int;
  v_line_source jsonb;
  v_existing_shortage_order_id uuid := NULL;
  v_existing_shortage_lines jsonb := '[]'::jsonb;
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
      -- Shortage porudžbina: parcijalni prijem ne pravi novu sub-porudžbinu, nego ista linija
      -- ostaje u nb_lines sa preostalom količinom (isti originalni barkod ponovo otvara modal).
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
          /** Ako complaint_id nije validan UUID, samo preskoči auto-resolve. */
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
          'description', nullif(trim(nb_line->>'description'), '')
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

      v_existing_source := nb_line->'shortage_source';
      IF v_existing_source IS NOT NULL
        AND jsonb_typeof(v_existing_source) = 'object'
        AND v_existing_source ? 'parent_order_id'
        AND v_existing_source ? 'parent_line_index' THEN
        v_root_parent_id := (v_existing_source->>'parent_order_id')::uuid;
        v_root_parent_idx := (v_existing_source->>'parent_line_index')::int;
      ELSE
        v_root_parent_id := p_order_id;
        v_root_parent_idx := i;
      END IF;

      shortage_line := jsonb_build_object(
        'description',
        coalesce(
          nullif(trim(nb_line->>'description'), ''),
          nullif(trim(meta->>'article'), ''),
          'Stavka'
        ),
        'materialType', coalesce(nullif(trim(nb_line->>'materialType'), ''), mo.material_type::text),
        'quantity', mi + da,
        'unit', unit_eff,
        'procurementMeta', meta,
        'lineNet', nb_line->'lineNet',
        'shortage_source', jsonb_build_object(
          'parent_order_id', v_root_parent_id,
          'parent_line_index', v_root_parent_idx,
          'missing_qty', mi,
          'damaged_qty', da,
          'complaint_id', v_new_id
        )
      );
      shortage_lines := shortage_lines || jsonb_build_array(shortage_line);
    END IF;
  END LOOP;

  IF mo.is_shortage_order = true AND jsonb_array_length(v_remaining_shortage_lines) > 0 THEN
    new_status := 'waiting_for_delivery'::public.delivery_status;
  ELSE
    -- Regularna parent porudžbina se zatvara kao primljena čak i kad ima manjka/oštećenja:
    -- aktivan rad se nastavlja na "Porudžbini po nedostatku", a reklamacija ostaje istorija na parentu.
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

  IF has_issues AND jsonb_array_length(shortage_lines) > 0 THEN
    SELECT id, coalesce(nb_lines, '[]'::jsonb)
      INTO v_existing_shortage_order_id, v_existing_shortage_lines
    FROM public.material_orders
    WHERE parent_order_id = p_order_id
      AND is_shortage_order = true
      AND delivery_status IS DISTINCT FROM 'materials_received'::public.delivery_status
      AND delivery_status IS DISTINCT FROM 'received_with_issues'::public.delivery_status
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_existing_shortage_order_id IS NOT NULL THEN
      v_shortage_order_id := v_existing_shortage_order_id;
      UPDATE public.material_orders
      SET
        nb_lines = v_existing_shortage_lines || shortage_lines,
        delivery_status = 'waiting_for_delivery'::public.delivery_status,
        delivered_ok = false,
        paid = true,
        supplier_price = 0,
        payment_status = 'pending',
        notes = coalesce(notes, '') || E'\n\nDodate nove stavke po nedostatku: ' || CURRENT_DATE::text
      WHERE id = v_existing_shortage_order_id;
    ELSE
      v_shortage_order_id := gen_random_uuid();
      v_short_ref := substr(p_order_id::text, 1, 8);
      v_shortage_notes := 'Porudžbina po nedostatku — referenca: ' || v_short_ref ||
        E'\nExpress tok: nema novog plaćanja ni slanja standardne porudžbenice; čeka se nadoknada od dobavljača.';
      IF nullif(trim(coalesce(mo.notes, '')), '') IS NOT NULL THEN
        v_shortage_notes := v_shortage_notes || E'\n\nOriginalna napomena:\n' || mo.notes;
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
        v_shortage_order_id,
        mo.job_id,
        mo.supplier,
        mo.supplier_id,
        mo.supplier_contact,
        mo.material_type,
        CURRENT_DATE,
        'waiting_for_delivery'::public.delivery_status,
        false,
        true,
        'pending',
        0,
        v_shortage_notes,
        shortage_lines,
        p_order_id,
        true
      );
    END IF;
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
    'shortage_order_id', v_shortage_order_id
  );
END;
$rfn$;

REVOKE ALL ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) TO service_role;

COMMENT ON POLICY production_read_material_orders ON public.material_orders IS
  'Magacin (proizvodnja) može da otvori porudžbine radi prijema robe.';
COMMENT ON POLICY production_read_procurement_complaints ON public.procurement_complaints IS
  'Magacin (proizvodnja) vidi reklamacije porudžbine za skeniranje C-barkoda.';
COMMENT ON POLICY production_read_procurement_ad_hoc_items ON public.procurement_ad_hoc_items IS
  'Magacin (proizvodnja) vidi vanredne stavke i njihove priloge tokom prijema.';
