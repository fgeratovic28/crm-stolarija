-- Office vidi hitni banner; treba SELECT na `invoice_missing_part_secured` da UI sakrije „Prosledi u nabavku“
-- kad je već kliknuto „Zaboravljeno u magacinu“.

DROP POLICY IF EXISTS invoice_missing_part_secured_office_read ON public.invoice_missing_part_secured;

CREATE POLICY invoice_missing_part_secured_office_read ON public.invoice_missing_part_secured
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() = 'office'::public.user_role);
