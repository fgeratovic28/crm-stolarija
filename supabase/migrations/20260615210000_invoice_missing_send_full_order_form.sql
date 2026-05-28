-- invoice_missing_send_to_procurement: isti oblik unosa kao obična narudžbina (dobavljač, stavke, Excel, porudžbenica),
-- uz order_kind gotov_deo | sirovine → requires_production.

CREATE OR REPLACE FUNCTION public.invoice_missing_send_to_procurement(
  p_job_id uuid,
  p_position text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_pos text;
  v_pos_key text;
  v_job_number text;
  v_parent_id uuid;
  v_mo_id uuid;
  v_link_id uuid;
  v_kind text;
  v_nb_lines jsonb;
  v_items_json jsonb;
  v_requires_prod boolean;
  v_supplier_id uuid;
  v_supplier text;
  v_supplier_contact text;
  v_material_type public.material_type;
  v_request_date date;
  v_expected_delivery date;
  v_user_notes text;
  v_supplier_price numeric;
  v_delivery_status public.delivery_status;
  v_notes text;
  v_barcode text;
  v_paid boolean;
  v_delivered_ok boolean;
  v_nb_vat numeric;
  v_nb_buyer text;
  v_nb_ship text;
  v_nb_pay_due date;
  v_nb_pay_note text;
  v_nb_legal text;
  v_nb_deliv_addr text;
  v_nb_line_desc text;
  v_nb_qty numeric;
  v_nb_unit text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni' USING ERRCODE = '42501';
  END IF;

  SELECT u.role INTO v_role FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
    RAISE EXCEPTION 'Nedozvoljeno' USING ERRCODE = '42501';
  END IF;

  v_pos := NULLIF(trim(COALESCE(p_position, '')), '');
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'Pozicija je obavezna' USING ERRCODE = '23514';
  END IF;

  v_pos_key := lower(v_pos);

  PERFORM public.invoice_missing_secured_delete_stale_for_position(p_job_id, v_pos_key);

  IF EXISTS (
    SELECT 1
    FROM public.invoice_missing_site_procurement l
    WHERE l.job_id = p_job_id
      AND l.position_key = v_pos_key
      AND l.completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Za ovu poziciju je već kreiran zahtev u nabavci.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_missing_part_secured s
    WHERE s.job_id = p_job_id AND s.position_key = v_pos_key
  ) THEN
    RAISE EXCEPTION 'Dopuna ugradnje je već zakažana za ovu poziciju.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_notifications un
    WHERE un.job_id = p_job_id
      AND un.notification_type = 'urgent_on_site_missing'
      AND un.read = false
      AND lower(trim(COALESCE(un.meta->>'position', ''))) = v_pos_key
  ) THEN
    RAISE EXCEPTION 'Nema aktivnog hitnog obaveštenja za ovu poziciju.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id) THEN
    RAISE EXCEPTION 'Posao nije pronađen' USING ERRCODE = '23514';
  END IF;

  SELECT j.job_number::text INTO v_job_number FROM public.jobs j WHERE j.id = p_job_id;
  v_job_number := COALESCE(NULLIF(trim(COALESCE(v_job_number, '')), ''), '?');

  SELECT mo.id
  INTO v_parent_id
  FROM public.material_orders mo
  WHERE mo.job_id = p_job_id
    AND COALESCE(mo.is_shortage_order, false) = false
  ORDER BY
    CASE mo.delivery_status
      WHEN 'materials_received'::public.delivery_status THEN 0
      WHEN 'received_with_issues'::public.delivery_status THEN 1
      WHEN 'waiting_for_delivery'::public.delivery_status THEN 2
      WHEN 'sent_to_supplier'::public.delivery_status THEN 3
      WHEN 'waiting_for_payment'::public.delivery_status THEN 4
      ELSE 5
    END,
    mo.created_at DESC
  LIMIT 1;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION
      'Za ovaj posao nema osnovne narudžbine materijala. Dodajte standardnu narudžbinu pre „Prosledi u nabavku“.'
      USING ERRCODE = '23514';
  END IF;

  v_kind := lower(trim(coalesce(p_payload->>'order_kind', '')));
  IF v_kind NOT IN ('gotov_deo', 'sirovine') THEN
    RAISE EXCEPTION 'Izaberite tip: gotov deo ili nabavka za proizvodnju.' USING ERRCODE = '23514';
  END IF;
  v_requires_prod := v_kind = 'sirovine';

  v_nb_lines := p_payload->'nb_lines';
  IF v_nb_lines IS NULL OR jsonb_typeof(v_nb_lines) <> 'array' OR jsonb_array_length(v_nb_lines) < 1 THEN
    RAISE EXCEPTION 'Dodajte bar jednu stavku (isti unos kao za običnu narudžbinu).' USING ERRCODE = '23514';
  END IF;

  IF p_payload->>'supplier_id' IS NULL OR trim(p_payload->>'supplier_id') = '' THEN
    RAISE EXCEPTION 'Izaberite dobavljača.' USING ERRCODE = '23514';
  END IF;
  v_supplier_id := (trim(p_payload->>'supplier_id'))::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = v_supplier_id) THEN
    RAISE EXCEPTION 'Dobavljač nije pronađen.' USING ERRCODE = '23514';
  END IF;

  v_supplier := coalesce(nullif(trim(p_payload->>'supplier'), ''), '—');
  v_supplier_contact := coalesce(nullif(trim(p_payload->>'supplier_contact'), ''), '');

  BEGIN
    v_material_type := (lower(trim(coalesce(p_payload->>'material_type', ''))))::public.material_type;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT mo.material_type
    INTO v_material_type
    FROM public.material_orders mo
    WHERE mo.id = v_parent_id;
    IF v_material_type IS NULL THEN
      v_material_type := 'other'::public.material_type;
    END IF;
  END;

  v_request_date := CURRENT_DATE;
  IF p_payload->>'request_date' IS NOT NULL AND trim(p_payload->>'request_date') <> '' THEN
    BEGIN
      v_request_date := (trim(p_payload->>'request_date'))::date;
    EXCEPTION WHEN OTHERS THEN
      v_request_date := CURRENT_DATE;
    END;
  END IF;

  v_expected_delivery := NULL;
  IF p_payload->>'expected_delivery_date' IS NOT NULL
     AND trim(p_payload->>'expected_delivery_date') <> ''
     AND lower(trim(p_payload->>'expected_delivery_date')) <> 'null' THEN
    BEGIN
      v_expected_delivery := (trim(p_payload->>'expected_delivery_date'))::date;
    EXCEPTION WHEN OTHERS THEN
      v_expected_delivery := NULL;
    END;
  END IF;

  v_supplier_price := 0;
  IF p_payload->>'supplier_price' IS NOT NULL AND trim(p_payload->>'supplier_price') <> '' THEN
    BEGIN
      v_supplier_price := (trim(p_payload->>'supplier_price'))::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_supplier_price := 0;
    END;
  END IF;
  IF v_supplier_price IS NULL OR v_supplier_price < 0 THEN
    v_supplier_price := 0;
  END IF;

  v_delivery_status := 'pending'::public.delivery_status;
  IF p_payload->>'delivery_status' IS NOT NULL AND trim(p_payload->>'delivery_status') <> '' THEN
    BEGIN
      v_delivery_status := (trim(p_payload->>'delivery_status'))::public.delivery_status;
    EXCEPTION WHEN OTHERS THEN
      v_delivery_status := 'pending'::public.delivery_status;
    END;
  END IF;

  v_user_notes := nullif(trim(p_payload->>'notes'), '');
  v_barcode := nullif(trim(p_payload->>'barcode'), '');

  v_paid := false;
  IF (p_payload->>'paid') IN ('true', 't', '1') THEN
    v_paid := true;
  END IF;

  v_delivered_ok := false;
  IF (p_payload->>'delivery_verified') IN ('true', 't', '1') THEN
    v_delivered_ok := true;
  END IF;

  v_nb_vat := NULL;
  IF p_payload ? 'nb_vat_rate_percent'
     AND (p_payload->'nb_vat_rate_percent') IS NOT NULL
     AND jsonb_typeof(p_payload->'nb_vat_rate_percent') <> 'null' THEN
    BEGIN
      v_nb_vat := (p_payload->>'nb_vat_rate_percent')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_nb_vat := NULL;
    END;
  END IF;

  v_nb_buyer := nullif(trim(p_payload->>'nb_buyer_bank_account'), '');
  v_nb_ship := nullif(trim(p_payload->>'nb_shipping_method'), '');
  v_nb_pay_note := nullif(trim(p_payload->>'nb_payment_note'), '');
  v_nb_legal := nullif(trim(p_payload->>'nb_legal_reference'), '');
  v_nb_deliv_addr := nullif(trim(p_payload->>'nb_delivery_address_override'), '');

  v_nb_pay_due := NULL;
  IF p_payload->>'nb_payment_due_date' IS NOT NULL AND trim(p_payload->>'nb_payment_due_date') <> '' THEN
    BEGIN
      v_nb_pay_due := (trim(p_payload->>'nb_payment_due_date'))::date;
    EXCEPTION WHEN OTHERS THEN
      v_nb_pay_due := NULL;
    END;
  END IF;

  v_nb_line_desc := nullif(trim(p_payload->>'nb_line_description'), '');
  v_nb_qty := NULL;
  IF p_payload->>'nb_quantity' IS NOT NULL AND trim(p_payload->>'nb_quantity') <> '' THEN
    BEGIN
      v_nb_qty := (trim(p_payload->>'nb_quantity'))::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_nb_qty := NULL;
    END;
  END IF;
  IF v_nb_qty IS NULL THEN
    BEGIN
      v_nb_qty := (v_nb_lines->0->>'quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_nb_qty := NULL;
    END;
  END IF;
  IF v_nb_qty IS NULL OR v_nb_qty <= 0 THEN
    v_nb_qty := 1;
  END IF;

  IF v_nb_line_desc IS NULL OR v_nb_line_desc = '' THEN
    v_nb_line_desc := nullif(trim(v_nb_lines->0->>'description'), '');
  END IF;
  IF v_nb_line_desc IS NULL OR v_nb_line_desc = '' THEN
    v_nb_line_desc := '—';
  END IF;

  v_nb_unit := nullif(trim(p_payload->>'nb_unit'), '');
  IF v_nb_unit IS NULL OR v_nb_unit = '' THEN
    v_nb_unit := nullif(trim(v_nb_lines->0->>'unit'), '');
  END IF;
  IF v_nb_unit IS NULL OR v_nb_unit = '' THEN
    v_nb_unit := 'kom';
  END IF;

  v_items_json := p_payload->'items_json';
  IF v_items_json IS NULL OR jsonb_typeof(v_items_json) = 'null' THEN
    v_items_json := NULL;
  END IF;

  v_notes := '[AUTO] Porudžbina po nedostatku — hitan nedostatak sa ugradnje (predračun). Pozicija: ' || v_pos
    || '. Posao: ' || v_job_number || '. Parent: ' || substr(v_parent_id::text, 1, 8) || '.';
  IF v_user_notes IS NOT NULL THEN
    v_notes := v_notes || E'\n' || v_user_notes;
  END IF;

  v_mo_id := gen_random_uuid();

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
    v_mo_id,
    p_job_id,
    v_supplier,
    v_supplier_id,
    v_supplier_contact,
    v_material_type,
    v_request_date,
    v_expected_delivery,
    v_delivery_status,
    v_delivered_ok,
    v_paid,
    'pending',
    v_supplier_price,
    v_barcode,
    v_notes,
    v_parent_id,
    true,
    true,
    v_requires_prod,
    v_nb_lines,
    v_items_json,
    v_nb_line_desc,
    v_nb_qty,
    v_nb_unit,
    v_nb_vat,
    v_nb_buyer,
    v_nb_ship,
    v_nb_pay_due,
    v_nb_pay_note,
    v_nb_legal,
    v_nb_deliv_addr
  );

  INSERT INTO public.invoice_missing_site_procurement (
    job_id,
    position_key,
    position_display,
    material_order_id,
    ad_hoc_item_id,
    created_by
  )
  VALUES (
    p_job_id,
    v_pos_key,
    v_pos,
    v_mo_id,
    NULL,
    v_uid
  )
  RETURNING id INTO v_link_id;

  RETURN jsonb_build_object(
    'link_id', v_link_id,
    'material_order_id', v_mo_id,
    'parent_order_id', v_parent_id,
    'requires_production', v_requires_prod,
    'order_kind', v_kind
  );
END;
$fn$;

ALTER FUNCTION public.invoice_missing_send_to_procurement(uuid, text, jsonb) SET search_path TO public;

COMMENT ON FUNCTION public.invoice_missing_send_to_procurement(uuid, text, jsonb) IS
  'Kreira Porudžbinu po nedostatku sa istim poljima kao obična narudžbina; order_kind: gotov_deo | sirovine.';

NOTIFY pgrst, 'reload schema';
