import { UserRole } from "@/types";

export type ModuleName =
  | "dashboard"
  | "customers"
  | "jobs"
  | "activities"
  | "finances"
  | "material-orders"
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
    "activities",
    "finances",
    "material-orders",
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
  /** Kupci, Poslovi, Aktivnosti; fajlovi na nivou posla (prilozi). */
  office: ["dashboard", "customers", "jobs", "activities", "files"],
  /** Dashboard + poslovi (evidencija uplata na poslu) + finansijski modul (tri dela: Finansije / Plaćanja / Izveštaji). */
  finance: ["dashboard", "jobs", "finances"],
  procurement: ["dashboard", "jobs", "material-orders", "suppliers", "vehicles", "files"],
  production: ["dashboard", "jobs", "work-orders", "files"],
  montaza: ["dashboard", "work-orders"],
  teren: ["dashboard", "work-orders", "field-reports"],
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
    "add_field_report",
    "add_mounting_report",
  ],
  finance: [
    "record_payment",
    "upload_file",
    "view_full_finance",
  ],
  procurement: [
    "create_order",
    "edit_order",
    "upload_file",
    "view_full_procurement",
    "create_vehicle",
    "edit_vehicle",
    "delete_vehicle",
    "archive_vehicle",
  ],
  production: [
    "view_production_details",
    "update_production_status",
    "upload_file",
  ],
  montaza: ["add_mounting_report", "view_own_team_only"],
  teren: ["add_field_report", "view_own_team_only"],
};
