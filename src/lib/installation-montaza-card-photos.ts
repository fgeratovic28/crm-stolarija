import type { WorkOrder } from "@/types";

/** Sažetak poslednjeg izveštaja za istu logiku kao u NewFieldReportModal (`mountingPhotosOptional`). */
export type LatestFieldReportBriefForMontazaCard = {
  everythingOk: boolean | null;
  siteCanceled: boolean;
  additionalNeedsCount: number;
} | null;

/** 
 * Sekcija „Fotografije montaže“ na kartici terenskog dashboarda — bez otkaza, problema ili dopuni.
 * Skrivena i kad RN nije aktivan (`pending` / `in_progress`).
 */
export function showInstallationMontazaPhotosOnFieldCard(wo: {
  type: WorkOrder["type"];
  status: WorkOrder["status"];
  latestFieldReportBrief: LatestFieldReportBriefForMontazaCard;
}): boolean {
  if (wo.type !== "installation") return false;
  if (wo.status !== "pending" && wo.status !== "in_progress") return false;

  const r = wo.latestFieldReportBrief;
  if (!r) return true;

  if (r.siteCanceled) return false;
  if (r.everythingOk === false) return false;
  if (r.additionalNeedsCount > 0) return false;
  return true;
}
