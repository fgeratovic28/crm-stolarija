-- Opis RN za radnika: kratka radna uputstva, bez [AUTO] i dispečerskih poruka.

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
    RETURN LEFT('Ugraditi nedostajući deo sa predračuna.', 6000);
  END IF;

  v_multi := position(',' IN v_pos) > 0;

  IF v_multi THEN
    RETURN LEFT(
      'Ugraditi nedostajuće delove sa predračuna (poz. ' || v_pos || ').',
      6000
    );
  END IF;

  RETURN LEFT(
    'Ugraditi nedostajući deo sa predračuna (poz. ' || v_pos || ').',
    6000
  );
END;
$desc$;

COMMENT ON FUNCTION public.invoice_missing_followup_wo_description(text) IS
  'Kratak opis RN dopune ugradnje za ekipu na terenu (bez [AUTO] i uputa za kancelariju).';

-- Osveži pending RN dopune ugradnje povezane sa invoice_missing_part_secured.
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
      AND w.status IN (
        'pending'::public.work_order_status,
        'in_progress'::public.work_order_status
      )
  LOOP
    PERFORM public.invoice_missing_sync_followup_wo_description(r.wo_id);
  END LOOP;
END;
$backfill$;
