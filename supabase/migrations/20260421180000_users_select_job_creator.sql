-- Omogući učitavanje kreatora posla (jobs.created_by -> public.users) svima koji smeju da vide taj posao.
-- Podupit na jobs podleže RLS-u na jobs, pa se ne otkrivaju kreatori poslova koje korisnik ne sme da vidi.

CREATE POLICY users_select_when_visible_as_job_creator ON public.users
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.created_by = users.id
    )
  );
