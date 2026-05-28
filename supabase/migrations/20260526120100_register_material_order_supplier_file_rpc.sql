-- OTPREMA priloga uz narudžbinu materijala (category supplier + material_order_id) mora da radi
-- i za ulogu production (magacin), gde direktan INSERT u `files` često ne prolazi RLS
-- (politike su bile usmerene na procurement + supplier ili production + work_order).
-- RPC sa SECURITY DEFINER upisuje red uz eksplicitnu proveru uloge i auth.uid().

CREATE OR REPLACE FUNCTION public.register_material_order_supplier_file(
  p_job_id uuid,
  p_material_order_id uuid,
  p_filename text,
  p_size text,
  p_size_bytes bigint,
  p_storage_key text,
  p_storage_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_new_id uuid;
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Morate biti prijavljeni';
  END IF;

  v_role := public.get_current_user_role();
  IF v_role IS NULL OR v_role NOT IN (
    'admin'::public.user_role,
    'office'::public.user_role,
    'procurement'::public.user_role,
    'production'::public.user_role
  ) THEN
    RAISE EXCEPTION 'Nemate dozvolu za otpremu priloga uz narudžbinu materijala';
  END IF;

  IF p_material_order_id IS NULL THEN
    RAISE EXCEPTION 'Nedostaje identifikator narudžbine materijala';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.material_orders mo WHERE mo.id = p_material_order_id) THEN
    RAISE EXCEPTION 'Narudžbina materijala nije pronađena';
  END IF;

  INSERT INTO public.files (
    job_id,
    material_order_id,
    category,
    filename,
    size,
    size_bytes,
    uploaded_by,
    uploaded_at,
    storage_key,
    storage_url
  ) VALUES (
    p_job_id,
    p_material_order_id,
    'supplier'::public.file_category,
    p_filename,
    p_size,
    p_size_bytes,
    v_uid,
    now(),
    nullif(trim(p_storage_key), ''),
    nullif(trim(p_storage_url), '')
  )
  RETURNING id INTO v_new_id;

  SELECT to_jsonb(f.*) INTO v_row
  FROM public.files f
  WHERE f.id = v_new_id;

  RETURN v_row;
END;
$fn$;

COMMENT ON FUNCTION public.register_material_order_supplier_file(uuid, uuid, text, text, bigint, text, text) IS
  'Upis priloga uz narudžbinu (supplier + material_order_id) za uloge admin/office/procurement/production; uploaded_by = auth.uid().';

REVOKE ALL ON FUNCTION public.register_material_order_supplier_file(uuid, uuid, text, text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_material_order_supplier_file(uuid, uuid, text, text, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_material_order_supplier_file(uuid, uuid, text, text, bigint, text, text) TO service_role;
