-- Svaka ulogovana uloga mora moći da učita sopstveni red u public.users (profil za CRM).
-- Bez ovoga fetch profila iz klijenta pada na RLS za finance, procurement, production, montaza, teren,
-- useSupabaseAuth tada poziva signOut() i korisnik ne može da ostane prijavljen.

CREATE POLICY users_select_own_row ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());
