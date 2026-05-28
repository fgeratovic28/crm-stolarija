-- Radni nalozi: planirani termin sa vremenom (ranije samo DATE bez vremena).
ALTER TABLE public.work_orders
  ALTER COLUMN date TYPE timestamptz
  USING (
    CASE
      WHEN date IS NULL THEN NULL
      ELSE date::timestamptz
    END
  );

COMMENT ON COLUMN public.work_orders.date IS 'Planirani termin naloga (datum i opciono vreme).';
