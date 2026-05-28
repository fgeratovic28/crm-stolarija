/**
 * Jedan izvor istine za "da li terenski/montažni izveštaj kaže da je sve u redu" pri čitanju iz baze.
 * Ako u redu postoji neusklađenost (npr. everything_ok = true, a issues / missing_items nisu prazni),
 * veruje se sadržaju — da problemi ne nestanu sa ekrana i PDF-a.
 */
export function fieldReportEverythingOkFromDbRow(row: {
  everything_ok?: boolean | null;
  issues?: string | null;
  missing_items?: string[] | null;
}): boolean {
  if (row.everything_ok === false) return false;
  const issueText = typeof row.issues === "string" ? row.issues.trim() : "";
  if (issueText.length > 0) return false;
  if (Array.isArray(row.missing_items) && row.missing_items.length > 0) return false;
  return true;
}

const MISSING_ITEM_KEY_LABEL: Record<string, string> = {
  sol: "Sol",
  daska: "Daska",
  komarnici: "Komarnici",
  drugi_delovi: "Drugi delovi",
};

export function displayFieldReportMissingItem(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  return MISSING_ITEM_KEY_LABEL[t] ?? t;
}

/** Ime tima sa radnog naloga — isto kao na kartici radnih naloga (`useTeams` + `team_id`). */
export function formatAssignedTeamLabel(
  teamId: string | undefined,
  teamNameById: Map<string, string>,
): string {
  if (!teamId) return "Neraspoređeno";
  const name = teamNameById.get(teamId)?.trim();
  return name || "—";
}
