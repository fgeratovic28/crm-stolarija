-- Reklamacije nabavke + vanredne stavke: novi statusi, jedinstveni barkod po stavci, RPC za skeniranje prijema.

-- 1) Migracija starih statusa reklamacija u novu šemu.
ALTER TABLE public.procurement_complaints
  DROP CONSTRAINT IF EXISTS procurement_complaints_status_allowed;

UPDATE public.procurement_complaints
SET status = CASE
  WHEN status = 'urgent_pending' THEN 'reported_issue'
  WHEN status = 'awaiting_supplier_response' THEN 'awaiting_delivery'
  WHEN status = 'refunded_credit_note' THEN 'canceled_refunded'
  WHEN status = 'resolved_items_replaced' THEN 'resolved_received'
  WHEN status IN ('reported_issue', 'awaiting_delivery', 'canceled_refunded', 'resolved_received') THEN status
  ELSE 'reported_issue'
END;

ALTER TABLE public.procurement_complaints
  ADD CONSTRAINT procurement_complaints_status_allowed CHECK (
    status IN (
      'reported_issue',
      'awaiting_delivery',
      'canceled_refunded',
      'resolved_received'
    )
  );

COMMENT ON COLUMN public.procurement_complaints.status IS
  'reported_issue | awaiting_delivery | canceled_refunded | resolved_received';

ALTER TABLE public.procurement_complaints
  ALTER COLUMN status SET DEFAULT 'reported_issue';

-- 2) Jedinstveni skenirajući barkod po reklamaciji.
ALTER TABLE public.procurement_complaints
  ADD COLUMN IF NOT EXISTS barcode text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_procurement_complaints_barcode
  ON public.procurement_complaints (barcode)
  WHERE barcode IS NOT NULL;

ALTER TABLE public.procurement_complaints
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.users (id) ON DELETE SET NULL;

-- 3) Helper za deterministički Code128 payload od UUID-a (prefix + 9 cifara).
CREATE OR REPLACE FUNCTION public.procurement_short_barcode(p_prefix text, p_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT upper(p_prefix) || lpad(
    (abs(hashtext(p_id::text))::bigint % 1000000000)::text,
    9,
    '0'
  );
$fn$;

COMMENT ON FUNCTION public.procurement_short_barcode(text, uuid) IS
  'Code128 payload: prefiks (C / A) + 9 cifara (deterministički od UUID).';

-- 4) Backfill barkoda za postojeće reklamacije (uključujući rešene, radi PDF istorije).
UPDATE public.procurement_complaints
SET barcode = public.procurement_short_barcode('C', id)
WHERE barcode IS NULL;

-- 5) Vanredne stavke nabavke (procurement_ad_hoc_items).
CREATE TABLE IF NOT EXISTS public.procurement_ad_hoc_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.material_orders (id) ON DELETE CASCADE,
  description text NOT NULL,
  article_code text,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'kom',
  notes text,
  attachment_file_id uuid REFERENCES public.files (id) ON DELETE SET NULL,
  barcode text NOT NULL,
  status text NOT NULL DEFAULT 'reported_issue',
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT procurement_ad_hoc_items_status_allowed CHECK (
    status IN (
      'reported_issue',
      'awaiting_delivery',
      'canceled_refunded',
      'resolved_received'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_procurement_ad_hoc_items_order_id
  ON public.procurement_ad_hoc_items (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_procurement_ad_hoc_items_barcode
  ON public.procurement_ad_hoc_items (barcode);

COMMENT ON TABLE public.procurement_ad_hoc_items IS
  'Vanredne stavke nabavke (van standardne porudžbenice) sa sopstvenim barkodom za prijem u magacinu.';

ALTER TABLE public.procurement_ad_hoc_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_procurement_ad_hoc_items ON public.procurement_ad_hoc_items;
CREATE POLICY admin_all_procurement_ad_hoc_items ON public.procurement_ad_hoc_items
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin'::public.user_role)
  WITH CHECK (public.get_current_user_role() = 'admin'::public.user_role);

DROP POLICY IF EXISTS procurement_all_procurement_ad_hoc_items ON public.procurement_ad_hoc_items;
CREATE POLICY procurement_all_procurement_ad_hoc_items ON public.procurement_ad_hoc_items
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'procurement'::public.user_role)
  WITH CHECK (public.get_current_user_role() = 'procurement'::public.user_role);

DROP POLICY IF EXISTS office_select_procurement_ad_hoc_items ON public.procurement_ad_hoc_items;
CREATE POLICY office_select_procurement_ad_hoc_items ON public.procurement_ad_hoc_items
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'office'::public.user_role);

-- 6) Skener helper za reklamacije + vanredne stavke (RPC).
DROP FUNCTION IF EXISTS public.receive_procurement_barcode(text);
CREATE OR REPLACE FUNCTION public.receive_procurement_barcode(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $rfn$
DECLARE
  v_code text;
  v_role public.user_role;
  v_order_id uuid;
  v_job_id uuid;
  v_kind text;
  v_id uuid;
  v_already boolean := false;
  v_active_complaints int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni';
  END IF;
  v_role := public.get_current_user_role();
  IF v_role IS NULL OR v_role NOT IN (
    'admin'::public.user_role,
    'procurement'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nemate dozvolu za prijem';
  END IF;

  v_code := upper(trim(coalesce(p_barcode, '')));
  IF length(v_code) = 0 THEN
    RAISE EXCEPTION 'Barkod je prazan';
  END IF;

  SELECT pc.id, pc.order_id, mo.job_id,
         (pc.status = 'resolved_received')
    INTO v_id, v_order_id, v_job_id, v_already
  FROM public.procurement_complaints pc
  INNER JOIN public.material_orders mo ON mo.id = pc.order_id
  WHERE pc.barcode = v_code
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    v_kind := 'complaint';
    IF v_already THEN
      RETURN jsonb_build_object(
        'kind', v_kind,
        'id', v_id,
        'order_id', v_order_id,
        'already_resolved', true
      );
    END IF;

    UPDATE public.procurement_complaints
    SET status = 'resolved_received',
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = v_id;

    SELECT COUNT(*) INTO v_active_complaints
    FROM public.procurement_complaints
    WHERE order_id = v_order_id
      AND status IN ('reported_issue', 'awaiting_delivery');

    IF v_active_complaints = 0 THEN
      UPDATE public.material_orders
      SET delivery_status = 'materials_received'::public.delivery_status
      WHERE id = v_order_id
        AND delivery_status = 'received_with_issues'::public.delivery_status;
    END IF;

    IF v_job_id IS NOT NULL THEN
      BEGIN
        PERFORM public.recompute_job_status(v_job_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'recompute_job_status posle skena reklamacije: %', SQLERRM;
      END;
    END IF;

    RETURN jsonb_build_object(
      'kind', v_kind,
      'id', v_id,
      'order_id', v_order_id,
      'already_resolved', false
    );
  END IF;

  SELECT a.id, a.order_id, mo.job_id,
         (a.status = 'resolved_received')
    INTO v_id, v_order_id, v_job_id, v_already
  FROM public.procurement_ad_hoc_items a
  INNER JOIN public.material_orders mo ON mo.id = a.order_id
  WHERE a.barcode = v_code
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    v_kind := 'ad_hoc';
    IF v_already THEN
      RETURN jsonb_build_object(
        'kind', v_kind,
        'id', v_id,
        'order_id', v_order_id,
        'already_resolved', true
      );
    END IF;

    UPDATE public.procurement_ad_hoc_items
    SET status = 'resolved_received',
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = v_id;

    RETURN jsonb_build_object(
      'kind', v_kind,
      'id', v_id,
      'order_id', v_order_id,
      'already_resolved', false
    );
  END IF;

  RAISE EXCEPTION 'Barkod nije pronađen u reklamacijama ili vanrednim stavkama';
END;
$rfn$;

REVOKE ALL ON FUNCTION public.receive_procurement_barcode(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_procurement_barcode(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_procurement_barcode(text) TO service_role;

COMMENT ON FUNCTION public.receive_procurement_barcode(text) IS
  'Magacin: skener barkoda za reklamacije (C…) i vanredne stavke (A…). Vraća JSON {kind,id,order_id,already_resolved}.';

-- 7) Insert helper za vanrednu stavku iz UI-ja (postavlja barkod automatski).
DROP FUNCTION IF EXISTS public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid);
CREATE OR REPLACE FUNCTION public.create_procurement_ad_hoc_item(
  p_order_id uuid,
  p_description text,
  p_article_code text,
  p_quantity numeric,
  p_unit text,
  p_notes text,
  p_attachment_file_id uuid
)
RETURNS public.procurement_ad_hoc_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role public.user_role;
  v_new_id uuid := gen_random_uuid();
  v_barcode text;
  v_row public.procurement_ad_hoc_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni';
  END IF;

  v_role := public.get_current_user_role();
  IF v_role IS NULL OR v_role NOT IN (
    'admin'::public.user_role,
    'procurement'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nemate dozvolu za dodavanje vanredne stavke';
  END IF;

  IF p_description IS NULL OR length(trim(p_description)) < 1 THEN
    RAISE EXCEPTION 'Naziv vanredne stavke je obavezan';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Količina mora biti veća od 0';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.material_orders WHERE id = p_order_id
  ) THEN
    RAISE EXCEPTION 'Narudžbina nije pronađena';
  END IF;

  v_barcode := public.procurement_short_barcode('A', v_new_id);

  INSERT INTO public.procurement_ad_hoc_items (
    id,
    order_id,
    description,
    article_code,
    quantity,
    unit,
    notes,
    attachment_file_id,
    barcode,
    status,
    created_by
  )
  VALUES (
    v_new_id,
    p_order_id,
    trim(p_description),
    nullif(trim(coalesce(p_article_code, '')), ''),
    p_quantity,
    coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'kom'),
    nullif(trim(coalesce(p_notes, '')), ''),
    p_attachment_file_id,
    v_barcode,
    'reported_issue',
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid) TO service_role;

-- 8) finalize_procurement_order_reception: novi default status + barkod po reklamaciji.
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Niste prijavljeni';
  END IF;
  IF p_reported_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'reported_by mora biti trenutni korisnik';
  END IF;

  role := public.get_current_user_role();
  IF role IS NULL OR role NOT IN ('admin'::public.user_role, 'procurement'::public.user_role) THEN
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
    RAISE EXCEPTION 'Narudžbina nije u statusu „čeka isporuku” (trenutno: %)', mo.delivery_status;
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

    IF mi > 0 OR da > 0 THEN
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
    END IF;
  END LOOP;

  IF has_issues THEN
    new_status := 'received_with_issues'::public.delivery_status;
  ELSE
    new_status := 'materials_received'::public.delivery_status;
  END IF;

  UPDATE public.material_orders
  SET
    delivery_status = new_status,
    delivery_date = coalesce(delivery_date, CURRENT_DATE),
    delivered_ok = CASE WHEN has_issues THEN false ELSE true END
  WHERE id = p_order_id;

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
    'has_issues', has_issues
  );
END;
$rfn$;

REVOKE ALL ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_procurement_order_reception(uuid, uuid, jsonb) TO service_role;

-- 9) update_procurement_complaint_status: novi spisak dozvoljenih vrednosti, auto-flip delivery_status posle resolved_received.
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
    SELECT order_id INTO v_order_id
    FROM public.procurement_complaints
    WHERE id = p_complaint_id;

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

-- 10) job_has_active_procurement_complaints: koristi nove aktivne statuse.
CREATE OR REPLACE FUNCTION public.job_has_active_procurement_complaints(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $chk$
  SELECT EXISTS (
    SELECT 1
    FROM public.procurement_complaints pc
    INNER JOIN public.material_orders mo ON mo.id = pc.order_id
    WHERE mo.job_id = p_job_id
      AND pc.status IN ('reported_issue', 'awaiting_delivery')
  );
$chk$;

REVOKE ALL ON FUNCTION public.job_has_active_procurement_complaints(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.job_has_active_procurement_complaints(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.job_has_active_procurement_complaints(uuid) TO service_role;
