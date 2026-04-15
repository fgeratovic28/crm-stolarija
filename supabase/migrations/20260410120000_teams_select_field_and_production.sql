-- Omogući čitanje timova za uloge koje vide radne naloge (lista koristi useTeams + team_id na nalogu).
-- Bez ovoga useTeams vraća prazan skup; ugnježdeni select teams(...) na work_orders je uklonjen iz klijenta.

CREATE POLICY production_read_teams ON teams
  FOR SELECT TO authenticated
  USING (get_current_user_role() = 'production');

CREATE POLICY montaza_read_own_team ON teams
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'montaza'
    AND id IN (SELECT team_id FROM users WHERE id = auth.uid() AND team_id IS NOT NULL)
  );

CREATE POLICY teren_read_own_team ON teams
  FOR SELECT TO authenticated
  USING (
    get_current_user_role() = 'teren'
    AND id IN (SELECT team_id FROM users WHERE id = auth.uid() AND team_id IS NOT NULL)
  );
