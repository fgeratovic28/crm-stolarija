-- Opis automatskog RN dopune ugradnje: šta radnik radi na terenu (bez dispečerskih uputstava).

CREATE OR REPLACE FUNCTION public.invoice_missing_followup_wo_description(p_positions text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $desc$
DECLARE
  v_pos text;
  v_multi boolean;
BEGIN
  v_pos := nullif(trim(both ' ' FROM coalesce(p_positions, '')), '');
  IF v_pos IS NULL THEN
    RETURN LEFT('[AUTO] Dopuna ugradnje — ugraditi nedostajući deo sa predračuna. Materijal spreman u magacinu.', 6000);
  END IF;

  v_multi := position(',' IN v_pos) > 0;

  IF v_multi THEN
    RETURN LEFT(
      '[AUTO] Dopuna ugradnje — ugraditi nedostajuće delove sa predračuna (poz. '
        || v_pos
        || '). Materijal spreman u magacinu.',
      6000
    );
  END IF;

  RETURN LEFT(
    '[AUTO] Dopuna ugradnje — ugraditi nedostajući deo sa predračuna (poz. '
      || v_pos
      || '). Materijal spreman u magacinu.',
    6000
  );
END;
$desc$;

COMMENT ON FUNCTION public.invoice_missing_followup_wo_description(text) IS
  'Tekst opisa RN dopune ugradnje za radnika (jedna ili više pozicija predračuna).';

CREATE OR REPLACE FUNCTION public.invoice_missing_sync_followup_wo_description(p_wo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  SET description = public.invoice_missing_followup_wo_description(v_agg)
  WHERE w.id = p_wo_id;
END;
$sync$;

-- Postojeći pending RN dopune: osveži opis prema vezanim pozicijama.
DO $backfill$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT s.followup_work_order_id AS wo_id
    FROM public.invoice_missing_part_secured s
    INNER JOIN public.work_orders w ON w.id = s.followup_work_order_id
    WHERE s.followup_work_order_id IS NOT NULL
      AND w.type = 'installation'::public.work_order_type
      AND w.status = 'pending'::public.work_order_status
  LOOP
    PERFORM public.invoice_missing_sync_followup_wo_description(r.wo_id);
  END LOOP;
END;
$backfill$;
