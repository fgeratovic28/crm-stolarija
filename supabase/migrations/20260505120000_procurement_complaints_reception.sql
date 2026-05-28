-- Step 8: Reklamacije nabavke + statusi prijema (materijal primljen / sa problemima).
-- Enum vrednosti: migracija 20260505115959_delivery_status_reception_enum.sql

CREATE TABLE IF NOT EXISTS public.procurement_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.material_orders (id) ON DELETE CASCADE,
  item_details jsonb NOT NULL,
  photo_evidence_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'urgent_pending',
  reported_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT procurement_complaints_status_nonempty CHECK (length(trim(status)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_procurement_complaints_order_id ON public.procurement_complaints (order_id);
CREATE INDEX IF NOT EXISTS idx_procurement_complaints_status ON public.procurement_complaints (status);

COMMENT ON TABLE public.procurement_complaints IS 'Reklamacije nabavke (nedostatak / oštećenje) posle prijema porudžbine.';
COMMENT ON COLUMN public.procurement_complaints.item_details IS 'JSON: article, article_code, color, missing_qty, damaged_qty, uom, notes (+ opciono work_order, position, length_mm, description).';
COMMENT ON COLUMN public.procurement_complaints.photo_evidence_urls IS 'R2 URL-ovi fotografija dokaza (naročito za oštećenje).';

ALTER TABLE public.procurement_complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_procurement_complaints ON public.procurement_complaints
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin'::public.user_role)
  WITH CHECK (public.get_current_user_role() = 'admin'::public.user_role);

CREATE POLICY procurement_all_procurement_complaints ON public.procurement_complaints
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'procurement'::public.user_role)
  WITH CHECK (public.get_current_user_role() = 'procurement'::public.user_role);

/* Narudžbina se smatra primljenom za posao (nije više „čeka materijal”) u ovim statusima. */
CREATE OR REPLACE FUNCTION public.material_order_delivery_resolved(p_status public.delivery_status)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $s$
  SELECT p_status IN (
    'delivered'::public.delivery_status,
    'partial'::public.delivery_status,
    'materials_received'::public.delivery_status,
    'received_with_issues'::public.delivery_status
  );
$s$;

COMMENT ON FUNCTION public.material_order_delivery_resolved(public.delivery_status) IS
  'TRUE kada je isporuka materijala završena za svrhe recompute_job_status (uključuje prijem magacina sa ili bez reklamacije).';

-- Ažuriraj recompute: novi statusi ne blokiraju waiting_material.
CREATE OR REPLACE FUNCTION public.recompute_job_status(p_job_id uuid)
RETURNS TABLE (
  did_update boolean,
  previous_status public.job_status,
  next_status public.job_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $func$
DECLARE
  v_current public.job_status;
  v_locked boolean;
  v_next public.job_status;
  v_has_meas boolean;
  v_meas_unfinished boolean;
  v_meas_phase_done boolean;
  v_measurement_completed boolean;
  v_meas_in_progress boolean;
  v_has_prod boolean;
  v_prod_unfinished boolean;
  v_prod_done boolean;
  v_prod_done_effective boolean;
  v_has_inst boolean;
  v_inst_unfinished boolean;
  v_inst_job_done boolean;
  v_inst_in_progress boolean;
  v_install_all_pending boolean;
  v_scheduled boolean;
  v_in_production boolean;
  v_has_accepted_quote boolean;
  v_has_material_order boolean;
  v_all_materials_delivered boolean;
BEGIN
  SELECT j.status, COALESCE(j.status_locked, false)
  INTO v_current, v_locked
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found: %', p_job_id;
  END IF;

  IF v_locked OR v_current IN (
    'service'::public.job_status,
    'quote_sent'::public.job_status,
    'final_quote_sent'::public.job_status
  ) THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (early exit): %', SQLERRM;
    END;
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  IF v_current = 'complaint'::public.job_status THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (complaint exit): %', SQLERRM;
    END;
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  IF v_current = 'installation_problem'::public.job_status THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (installation_problem exit): %', SQLERRM;
    END;
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  v_has_meas := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'measurement'::public.work_order_type,
        'measurement_verification'::public.work_order_type
      )
  );

  v_meas_unfinished := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'measurement'::public.work_order_type,
        'measurement_verification'::public.work_order_type
      )
      AND w.status NOT IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status)
  );

  v_has_prod := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.type = 'production'::public.work_order_type
  );

  v_meas_phase_done :=
    (v_has_meas AND NOT v_meas_unfinished)
    OR ((NOT v_has_meas) AND v_has_prod);

  v_measurement_completed := v_has_meas AND NOT v_meas_unfinished;

  v_meas_in_progress := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type IN (
        'measurement'::public.work_order_type,
        'measurement_verification'::public.work_order_type
      )
      AND w.status = 'in_progress'::public.work_order_status
  );

  v_prod_unfinished := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'production'::public.work_order_type
      AND w.status NOT IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status)
  );

  v_prod_done :=
    v_has_prod
    AND NOT v_prod_unfinished
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'production'::public.work_order_type
        AND w.status = 'completed'::public.work_order_status
    );

  v_prod_done_effective := (NOT v_has_prod) OR v_prod_done;

  v_has_inst := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id AND w.type = 'installation'::public.work_order_type
  );

  v_inst_unfinished := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status NOT IN ('completed'::public.work_order_status, 'canceled'::public.work_order_status)
  );

  v_inst_job_done :=
    v_has_inst
    AND NOT v_inst_unfinished
    AND EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status = 'completed'::public.work_order_status
    );

  v_inst_in_progress := EXISTS (
    SELECT 1
    FROM public.work_orders w
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'in_progress'::public.work_order_status
  );

  v_install_all_pending :=
    v_has_inst
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_orders w
      WHERE w.job_id = p_job_id
        AND w.type = 'installation'::public.work_order_type
        AND w.status IS DISTINCT FROM 'pending'::public.work_order_status
    );

  v_has_accepted_quote := EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.job_id = p_job_id
      AND q.status = 'accepted'::public.quote_status
  );

  v_has_material_order := EXISTS (
    SELECT 1
    FROM public.material_orders mo
    WHERE mo.job_id = p_job_id
  );

  v_all_materials_delivered :=
    v_has_material_order
    AND NOT EXISTS (
      SELECT 1
      FROM public.material_orders mo
      WHERE mo.job_id = p_job_id
        AND NOT public.material_order_delivery_resolved(mo.delivery_status)
    );

  v_scheduled :=
    v_meas_phase_done
    AND v_prod_done_effective
    AND (
      (v_has_inst AND v_install_all_pending)
      OR ((NOT v_has_inst) AND v_has_prod AND v_prod_done)
    );

  v_in_production :=
    v_meas_phase_done
    AND (NOT v_has_material_order OR v_all_materials_delivered)
    AND NOT v_meas_in_progress
    AND NOT v_scheduled
    AND NOT v_inst_in_progress
    AND NOT v_inst_job_done;

  IF EXISTS (
    SELECT 1
    FROM public.field_reports fr
    INNER JOIN public.work_orders w ON w.id = fr.work_order_id
    INNER JOIN public.jobs j ON j.id = w.job_id
    WHERE w.job_id = p_job_id
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'completed'::public.work_order_status
      AND fr.everything_ok IS FALSE
      AND j.first_completed_at IS NULL
  ) THEN
    v_next := 'installation_problem'::public.job_status;
  ELSIF v_inst_job_done THEN
    v_next := 'completed'::public.job_status;
  ELSIF v_inst_in_progress THEN
    v_next := 'installation_in_progress'::public.job_status;
  ELSIF v_has_meas AND NOT v_meas_phase_done THEN
    v_next := 'measuring'::public.job_status;
  ELSIF v_current = 'measuring'::public.job_status AND v_measurement_completed THEN
    v_next := 'measurement_processing'::public.job_status;
  ELSIF v_measurement_completed AND NOT v_has_accepted_quote THEN
    v_next := 'measurement_processing'::public.job_status;
  ELSIF v_measurement_completed AND v_has_material_order AND NOT v_all_materials_delivered THEN
    v_next := 'waiting_material'::public.job_status;
  ELSIF v_measurement_completed AND v_has_accepted_quote AND NOT v_has_material_order THEN
    v_next := 'ready_for_work'::public.job_status;
  ELSIF v_scheduled THEN
    v_next := 'scheduled'::public.job_status;
  ELSIF v_in_production THEN
    v_next := 'in_production'::public.job_status;
  ELSE
    v_next := 'new'::public.job_status;
  END IF;

  IF v_next IS NOT DISTINCT FROM v_current THEN
    BEGIN
      PERFORM public.ensure_workflow_work_orders(p_job_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ensure_workflow_work_orders (no status change): %', SQLERRM;
    END;
    RETURN QUERY VALUES (false::boolean, v_current::public.job_status, v_current::public.job_status);
    RETURN;
  END IF;

  UPDATE public.jobs
  SET status = v_next
  WHERE id = p_job_id;

  BEGIN
    PERFORM public.ensure_workflow_work_orders(p_job_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ensure_workflow_work_orders (after status update): %', SQLERRM;
  END;

  RETURN QUERY VALUES (true::boolean, v_current::public.job_status, v_next::public.job_status);
END;
$func$;

REVOKE ALL ON FUNCTION public.recompute_job_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_job_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_job_status(uuid) TO service_role;

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

      INSERT INTO public.procurement_complaints (
        order_id,
        item_details,
        photo_evidence_urls,
        status,
        reported_by
      )
      VALUES (
        p_order_id,
        item_details,
        photo_arr,
        'urgent_pending',
        p_reported_by
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
