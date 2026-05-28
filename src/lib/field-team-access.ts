import type { UserRole, WorkOrderType } from "@/types";

/** Radni nalozi koje vidi uloga Montaža (samo ugradnja). */
export const MONTAZA_WORK_ORDER_TYPES: readonly WorkOrderType[] = ["installation"];

/** Terenski tipovi naloga za ulogu Teren. */
export const TEREN_WORK_ORDER_TYPES: readonly WorkOrderType[] = [
  "measurement",
  "measurement_verification",
  "complaint",
  "service",
  "site_visit",
  "control_visit",
];

export function isMontazaRole(role: UserRole | null | undefined): boolean {
  return role === "montaza";
}

export function isTerenRole(role: UserRole | null | undefined): boolean {
  return role === "teren";
}

export function isProductionRole(role: UserRole | null | undefined): boolean {
  return role === "production";
}

export function isFieldExecutionRole(role: UserRole | null | undefined): boolean {
  return isMontazaRole(role) || isTerenRole(role) || isProductionRole(role);
}

export function workOrderTypesForRole(role: UserRole | null | undefined): WorkOrderType[] {
  if (isMontazaRole(role)) return [...MONTAZA_WORK_ORDER_TYPES];
  if (isTerenRole(role)) return [...TEREN_WORK_ORDER_TYPES];
  if (isProductionRole(role)) return ["production"];
  return [];
}

/** Tip izveštaja u modalu u zavisnosti od tipa radnog naloga. */
export function fieldReportFlowForWorkOrderType(
  type: WorkOrderType | undefined,
): "mounting" | "field" | "production" {
  if (type === "installation") return "mounting";
  if (type === "production") return "production";
  return "field";
}

export function workOrderTypeMatchesRole(
  type: WorkOrderType,
  role: UserRole | null | undefined
): boolean {
  const allowed = workOrderTypesForRole(role);
  return allowed.length > 0 && allowed.includes(type);
}

/** Da li korisnik sme da čekira stavke i unosi mere na RN (isti uslov kao u detaljima naloga). */
export function canToggleWorkOrderChecklist(
  wo: { type: WorkOrderType; assignedTeamId?: string | null },
  role: UserRole | null | undefined,
  userTeamId: string | undefined,
): boolean {
  if (!userTeamId || !wo.assignedTeamId || wo.assignedTeamId !== userTeamId) return false;
  if (role === "teren") return TEREN_WORK_ORDER_TYPES.includes(wo.type);
  if (role === "montaza") return MONTAZA_WORK_ORDER_TYPES.includes(wo.type);
  if (role === "production") return wo.type === "production";
  return false;
}
