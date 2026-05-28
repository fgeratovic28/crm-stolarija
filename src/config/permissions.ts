import { UserRole } from "@/types";

export type ModuleName =
  | "dashboard"
  | "customers"
  | "jobs"
  | "quotes"
  | "jobs-map"
  | "activities"
  | "finances"
  | "material-orders"
  | "material-reception"
  | "suppliers"
  | "vehicles"
  | "workers"
  | "work-orders"
  | "field-reports"
  | "files"
  | "users"
  | "teams"
  | "settings";

export type ActionName =
  | "create_job"
  | "edit_job"
  | "delete_job"
  | "update_job_status"
  | "record_payment"
  | "create_order"
  | "edit_order"
  | "create_work_order"
  | "edit_work_order"
  | "cancel_work_order"
  | "upload_file"
  | "delete_file"
  | "create_vehicle"
  | "edit_vehicle"
  | "delete_vehicle"
  | "archive_vehicle"
  | "create_worker"
  | "edit_worker"
  | "delete_worker"
  | "manage_worker_sick_leave"
  | "manage_users"
  | "manage_teams"
  | "add_activity"
  | "add_field_report"
  | "add_mounting_report"
  | "view_full_finance"
  | "view_full_procurement"
  | "view_production_details"
  | "update_production_status"
  | "view_own_team_only";

/** Pristup modulima po ulozi. Svaka uloga uvek uključuje `dashboard` (kontrolna tabla). */
export const MODULE_ACCESS: Record<UserRole, ModuleName[]> = {
  admin: [
    "dashboard",
    "customers",
    "jobs",
    "quotes",
    "jobs-map",
    "activities",
    "finances",
    "material-orders",
    "material-reception",
    "suppliers",
    "vehicles",
    "workers",
    "work-orders",
    "field-reports",
    "files",
    "users",
    "teams",
    "settings",
  ],
  /** Kancelarija / Prodaja: kompletan rad na poslu (ponude/finansije/RN/izveštaji), bez mape završenih poslova. */
  office: [
    "dashboard",
    "customers",
    "jobs",
    "activities",
    "quotes",
    "finances",
    "work-orders",
    "field-reports",
    "files",
  ],
  /** Finansije: poslovi (uplate) + finansijski modul (tri dela: Finansije / Plaćanja / Izveštaji). Bez mape završenih poslova. */
  finance: ["dashboard", "jobs", "finances"],
  procurement: [
    "dashboard",
    "jobs",
    "finances",
    "material-orders",
    "material-reception",
    "suppliers",
    "vehicles",
    "workers",
    "files",
  ],
  /** Proizvodnja fizički prima materijal — vidi i koristi stranicu Prijema, bez pristupa listi porudžbina. */
  production: ["dashboard", "work-orders", "material-reception"],
  montaza: ["dashboard", "work-orders"],
  /** Teren: bez globalne stranice „Terenski izveštaji“ i bez kartice liste izveštaja na poslu; izveštaj samo kroz radni nalog. */
  teren: ["dashboard", "work-orders"],
};

/** Da li uloga iz baze/JWT-a postoji u aplikaciji i ima bar jedan modul (izbegava petlju / ↔ /login). */
export function roleHasAppAccess(role: string | undefined | null): boolean {
  if (!role) return false;
  const modules = MODULE_ACCESS[role as UserRole];
  return Array.isArray(modules) && modules.length > 0;
}

export const ACTION_ACCESS: Record<UserRole, ActionName[]> = {
  admin: [
    "create_job",
    "edit_job",
    "delete_job",
    "update_job_status",
    "record_payment",
    "create_order",
    "edit_order",
    "create_work_order",
    "edit_work_order",
    "cancel_work_order",
    "upload_file",
    "delete_file",
    "create_vehicle",
    "edit_vehicle",
    "delete_vehicle",
    "archive_vehicle",
    "create_worker",
    "edit_worker",
    "delete_worker",
    "manage_worker_sick_leave",
    "manage_users",
    "manage_teams",
    "add_activity",
    "add_field_report",
    "add_mounting_report",
    "view_full_finance",
    "view_full_procurement",
    "view_production_details",
    "update_production_status",
  ],
  office: [
    "create_job",
    "edit_job",
    "add_activity",
    "upload_file",
    "update_job_status",
    "record_payment",
    "create_work_order",
    "edit_work_order",
    "cancel_work_order",
    "add_field_report",
    "add_mounting_report",
  ],
  finance: [
    "record_payment",
    "upload_file",
    "view_full_finance",
  ],
  procurement: [
    "update_job_status",
    "create_order",
    "edit_order",
    "upload_file",
    "view_full_procurement",
    "create_vehicle",
    "edit_vehicle",
    "delete_vehicle",
    "archive_vehicle",
    "create_worker",
    "edit_worker",
    "delete_worker",
    "manage_worker_sick_leave",
  ],
  production: [
    "view_production_details",
    "update_production_status",
    "upload_file",
  ],
  montaza: ["add_mounting_report", "view_own_team_only"],
  teren: ["add_field_report", "view_own_team_only"],
};
