-- Repair migration for ad-hoc item statuses.
-- If the status CHECK was already changed but an older RPC is still cached/installed,
-- inserts can still try to write `reported_issue`. This migration force-reinstalls the
-- ad-hoc RPCs with the new lifecycle: needs_order -> ordered -> received, terminal canceled.

-- 1) Skidamo stari CHECK + default PRE bilo kakvog UPDATE-a (stari constraint blokira
--    nove vrednosti tipa `received`, `needs_order`).
ALTER TABLE public.procurement_ad_hoc_items
  DROP CONSTRAINT IF EXISTS procurement_ad_hoc_items_status_allowed;

ALTER TABLE public.procurement_ad_hoc_items
  ALTER COLUMN status DROP DEFAULT;

-- 2) Prevod postojećih vrednosti u nove (idempotentno).
UPDATE public.procurement_ad_hoc_items
SET status = CASE
  WHEN status = 'reported_issue' THEN 'needs_order'
  WHEN status = 'awaiting_delivery' THEN 'ordered'
  WHEN status = 'resolved_received' THEN 'received'
  WHEN status = 'canceled_refunded' THEN 'canceled'
  WHEN status IN ('needs_order', 'ordered', 'received', 'canceled') THEN status
  ELSE 'needs_order'
END;

-- 3) Novi CHECK i nova podrazumevana vrednost.
ALTER TABLE public.procurement_ad_hoc_items
  ADD CONSTRAINT procurement_ad_hoc_items_status_allowed CHECK (
    status IN ('needs_order', 'ordered', 'received', 'canceled')
  );

ALTER TABLE public.procurement_ad_hoc_items
  ALTER COLUMN status SET DEFAULT 'needs_order';

DROP FUNCTION IF EXISTS public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid);
DROP FUNCTION IF EXISTS public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric);

CREATE OR REPLACE FUNCTION public.create_procurement_ad_hoc_item(
  p_order_id uuid,
  p_description text,
  p_article_code text,
  p_quantity numeric,
  p_unit text,
  p_notes text,
  p_attachment_file_id uuid,
  p_work_order text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_length_mm numeric DEFAULT NULL
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
  v_length numeric;
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
    RAISE EXCEPTION 'Kolicina mora biti veca od 0';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.material_orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Narudzbina nije pronadjena';
  END IF;

  IF p_length_mm IS NOT NULL AND p_length_mm <= 0 THEN
    v_length := NULL;
  ELSE
    v_length := p_length_mm;
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
    created_by,
    work_order,
    position,
    color,
    length_mm
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
    'needs_order',
    auth.uid(),
    nullif(trim(coalesce(p_work_order, '')), ''),
    nullif(trim(coalesce(p_position, '')), ''),
    nullif(trim(coalesce(p_color, '')), ''),
    v_length
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_procurement_ad_hoc_item(uuid, text, text, numeric, text, text, uuid, text, text, text, numeric) TO service_role;

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
    'procurement'::public.user_role,
    'production'::public.user_role
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
  WHERE upper(pc.barcode) = v_code
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

    IF v_order_id IS NOT NULL THEN
      SELECT count(*)
        INTO v_active_complaints
      FROM public.procurement_complaints
      WHERE order_id = v_order_id
        AND status IN ('reported_issue', 'awaiting_delivery');

      IF v_active_complaints = 0 THEN
        UPDATE public.material_orders
        SET delivery_status = 'materials_received'::public.delivery_status
        WHERE id = v_order_id
          AND delivery_status = 'received_with_issues'::public.delivery_status;
      END IF;
    END IF;

    IF v_job_id IS NOT NULL THEN
      BEGIN
        PERFORM public.recompute_job_status(v_job_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'recompute_job_status after C-barcode scan: %', SQLERRM;
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
         (a.status = 'received')
    INTO v_id, v_order_id, v_job_id, v_already
  FROM public.procurement_ad_hoc_items a
  INNER JOIN public.material_orders mo ON mo.id = a.order_id
  WHERE upper(a.barcode) = v_code
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
    SET status = 'received',
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = v_id;

    IF v_job_id IS NOT NULL THEN
      BEGIN
        PERFORM public.recompute_job_status(v_job_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'recompute_job_status after A-barcode scan: %', SQLERRM;
      END;
    END IF;

    RETURN jsonb_build_object(
      'kind', v_kind,
      'id', v_id,
      'order_id', v_order_id,
      'already_resolved', false
    );
  END IF;

  RAISE EXCEPTION 'Barkod nije pronadjen u reklamacijama ili vanrednim stavkama';
END;
$rfn$;

REVOKE ALL ON FUNCTION public.receive_procurement_barcode(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_procurement_barcode(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_procurement_barcode(text) TO service_role;

DROP FUNCTION IF EXISTS public.get_procurement_order_public_redirect(uuid, text);

CREATE OR REPLACE FUNCTION public.get_procurement_order_public_redirect(p_order_id uuid, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gfn$
DECLARE
  v_kind text;
  v_supplier text;
  v_attach_url text;
  v_attach_name text;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_kind := lower(coalesce(trim(p_kind), 'adhoc'));
  IF v_kind NOT IN ('adhoc', 'complaint') THEN
    v_kind := 'adhoc';
  END IF;

  SELECT mo.supplier
    INTO v_supplier
  FROM public.material_orders mo
  WHERE mo.id = p_order_id
  LIMIT 1;

  IF v_supplier IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_kind = 'adhoc' THEN
    SELECT f.storage_url, f.filename
      INTO v_attach_url, v_attach_name
    FROM public.procurement_ad_hoc_items a
    LEFT JOIN public.files f ON f.id = a.attachment_file_id
    WHERE a.order_id = p_order_id
      AND a.status IN ('needs_order', 'ordered')
      AND a.attachment_file_id IS NOT NULL
    ORDER BY a.created_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'kind', v_kind,
    'supplier', v_supplier,
    'attachment_url', v_attach_url,
    'attachment_name', v_attach_name
  );
END;
$gfn$;

REVOKE ALL ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_procurement_order_public_redirect(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
