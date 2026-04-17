-- Align app_settings write access with the app: only `admin` has the settings module (see src/config/permissions.ts).

DROP POLICY IF EXISTS app_settings_update_office_admin ON public.app_settings;
DROP POLICY IF EXISTS app_settings_insert_office_admin ON public.app_settings;
DROP POLICY IF EXISTS app_settings_update_admin ON public.app_settings;
DROP POLICY IF EXISTS app_settings_insert_admin ON public.app_settings;

CREATE POLICY app_settings_update_admin ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin' AND id = 1);

CREATE POLICY app_settings_insert_admin ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (id = 1 AND public.get_current_user_role() = 'admin');
