import { supabase } from "@/lib/supabase";
import { fetchJobsList } from "@/hooks/use-jobs";
import {
  formatCurrencyBySettings,
  formatDateBySettings,
  formatMaterialOrderDateForDisplay,
  readAppSettingsCache,
} from "@/lib/app-settings";
import type { Job, MaterialOrder, WorkOrder } from "@/types";
import { labelJobStatus, labelMaterialType } from "@/lib/activity-labels";
import { listStaleJobsForSla } from "@/lib/job-sla-stale";

export type NotificationType =
  | "overdue_payment"
  | "material_delivery"
  | "upcoming_installation"
  | "complaint"
  | "job_status_change"
  | "stale_job_status";
export type NotificationPriority = "high" | "medium" | "low";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  priority: NotificationPriority;
  timestamp: string;
  read: boolean;
  jobId?: string;
  jobNumber?: string;
}

type WorkOrderWithTeamLabel = WorkOrder & { assignedTeam: string };

async function fetchMaterialOrdersForNotifications(): Promise<MaterialOrder[]> {
  const { data, error } = await supabase
    .from("material_orders")
    .select(`
      *,
      suppliers (id, name, contact_person),
      jobs (id, job_number)
    `)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(d => {
    const supplierData = Array.isArray(d.suppliers) ? d.suppliers[0] : d.suppliers;
    const jobData = Array.isArray(d.jobs) ? d.jobs[0] : d.jobs;
    return {
      id: d.id,
      jobId: d.job_id,
      materialType: d.material_type,
      supplierId: d.supplier_id,
      supplier: (supplierData as { name?: string } | null)?.name || d.supplier,
      supplierContact: (supplierData as { contact_person?: string } | null)?.contact_person || d.supplier_contact,
      orderDate: d.request_date,
      requestDate: d.request_date,
      deliveryDate: d.delivery_date,
      expectedDelivery: d.expected_delivery_date || d.delivery_date || "",
      price: d.supplier_price,
      supplierPrice: d.supplier_price,
      paid: d.paid,
      barcode: d.barcode,
      deliveryStatus: d.delivery_status,
      deliveryVerified: d.delivered_ok,
      quantityVerified: d.delivered_ok,
      allDelivered: d.delivery_status === "delivered",
      requestFile: d.request_file,
      quoteFile: d.quote_file,
      notes: d.notes,
      job: jobData
        ? {
            id: (jobData as { id: string }).id,
            jobNumber: (jobData as { job_number: string }).job_number,
          }
        : undefined,
    };
  }) as MaterialOrder[];
}

async function fetchWorkOrdersForNotifications(): Promise<WorkOrderWithTeamLabel[]> {
  const { data, error } = await supabase
    .from("work_orders")
    .select(`
      *,
      teams (name),
      jobs (id, job_number, installation_address)
    `)
    .order("date", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(d => {
    const teamData = Array.isArray(d.teams) ? d.teams[0] : d.teams;
    const teamName = (teamData as { name?: string } | null)?.name;
    return {
      id: d.id,
      jobId: d.job_id,
      type: d.type,
      description: d.description,
      measurementLocation: d.measurement_location ?? undefined,
      measurementScope: d.measurement_scope ?? undefined,
      assignedTeamId: d.team_id,
      date: d.date,
      status: d.status,
      attachmentName: d.file_id ? "attachment" : undefined,
      installationRef: d.installation_ref,
      productionRef: d.production_ref,
      assignedTeam: teamName ?? "Nedodeljen",
    };
  });
}

function generateNotifications(
  jobs: Job[],
  materialOrders: MaterialOrder[],
  workOrders: WorkOrderWithTeamLabel[],
  excludeSyntheticJobStatusChangeForJobIds?: Set<string>,
): Notification[] {
  const settings = readAppSettingsCache();
  const notifications: Notification[] = [];

  if (settings.notifOverduePayments) {
    jobs
      .filter(
        (j) =>
          j.unpaidBalance > 0 &&
          j.status !== "new" &&
          j.status !== "canceled" &&
          Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86400000) > settings.overdueDays
      )
      .forEach((j) => {
        notifications.push({
          id: `notif-pay-${j.id}`,
          type: "overdue_payment",
          title: "Dospelo plaćanje",
          description: `${j.customer.fullName} — ${formatCurrencyBySettings(j.unpaidBalance)} neplaćeno za ${j.jobNumber}`,
          priority: j.unpaidBalance > 300000 ? "high" : "medium",
          timestamp: j.createdAt,
          read: false,
          jobId: j.id,
          jobNumber: j.jobNumber,
        });
      });
  }

  if (settings.notifLateDeliveries) {
    materialOrders
      .filter((m) =>
        [
          "pending",
          "email_sent",
          "sent_to_supplier",
          "waiting_for_payment",
          "waiting_for_delivery",
          "shipped",
        ].includes(m.deliveryStatus),
      )
      .forEach((m) => {
        const expected = m.expectedDelivery || "";
        const expectedDate = expected ? new Date(expected) : null;
        const now = new Date();
        const isLate = expectedDate != null && !Number.isNaN(expectedDate.getTime()) && expectedDate < now;
        notifications.push({
          id: `notif-mat-${m.id}`,
          type: "material_delivery",
          title: isLate ? "Isporuka kasni" : "Isporuka stiže uskoro",
          description: `${labelMaterialType(String(m.materialType))} od ${m.supplier} — očekivano ${
            expected ? formatMaterialOrderDateForDisplay(expected) : "N/A"
          }`,
          priority: isLate ? "high" : "low",
          timestamp: m.requestDate,
          read: false,
          jobId: m.jobId,
          jobNumber: m.job?.jobNumber,
        });
      });
  }

  if (settings.notifUpcomingInstalls) {
    workOrders
      .filter((w) => w.type === "installation" && w.status === "pending")
      .forEach((w) => {
        notifications.push({
          id: `notif-inst-${w.id}`,
          type: "upcoming_installation",
          title: "Predstojeća ugradnja",
          description: `${w.description} — zakazano ${formatDateBySettings(w.date)}, ${w.assignedTeam}`,
          priority: "medium",
          timestamp: w.date,
          read: false,
          jobId: w.jobId,
        });
      });
  }

  if (settings.notifNewComplaints) {
    jobs.filter(j => j.status === "complaint").forEach(j => {
      notifications.push({
        id: `notif-comp-${j.id}`,
        type: "complaint",
        title: "Otvorena reklamacija",
        description: `${j.customer.fullName} — ${j.summary.slice(0, 60)}...`,
        priority: "high",
        timestamp: j.createdAt,
        read: false,
        jobId: j.id,
        jobNumber: j.jobNumber,
      });
    });
  }

  if (settings.notifJobStatusChange) {
    const now = Date.now();
    const recentWindowMs = 48 * 60 * 60 * 1000;
    jobs
      .filter((j) => {
        if (excludeSyntheticJobStatusChangeForJobIds?.has(j.id)) return false;
        if (!j.statusChangedAt) return false;
        const changedAt = new Date(j.statusChangedAt).getTime();
        if (Number.isNaN(changedAt)) return false;
        if (now - changedAt > recentWindowMs) return false;
        // Skip initial "new" and canceled noise.
        return j.status !== "new" && j.status !== "canceled";
      })
      .forEach((j) => {
        notifications.push({
          id: `notif-status-${j.id}-${j.statusChangedAt}`,
          type: "job_status_change",
          title: "Promena statusa posla",
          description: `${j.jobNumber} — ${labelJobStatus(j.status)} (${j.customer.fullName})`,
          priority: j.status === "complaint" ? "high" : "low",
          timestamp: j.statusChangedAt ?? j.createdAt,
          read: false,
          jobId: j.id,
          jobNumber: j.jobNumber,
        });
      });
  }

  if (settings.notifStaleJobStatus) {
    listStaleJobsForSla(jobs, settings.jobStaleStatusDays).forEach((row) => {
      notifications.push({
        id: `notif-sla-${row.jobId}`,
        type: "stale_job_status",
        title: "SLA: zastoj u statusu",
        description: `${row.jobNumber} — ${row.statusLabel} bez promene statusa ${row.daysInStatus} dana (od ${formatDateBySettings(row.statusChangedAt)})`,
        priority: row.priority,
        timestamp: row.statusChangedAt,
        read: false,
        jobId: row.jobId,
        jobNumber: row.jobNumber,
      });
    });
  }

  return notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

const KNOWN_NOTIFICATION_TYPES: NotificationType[] = [
  "overdue_payment",
  "material_delivery",
  "upcoming_installation",
  "complaint",
  "job_status_change",
  "stale_job_status",
];

function coerceNotificationType(value: string): NotificationType {
  return (KNOWN_NOTIFICATION_TYPES as string[]).includes(value)
    ? (value as NotificationType)
    : "job_status_change";
}

async function fetchPersistedUserNotifications(): Promise<{
  rows: Notification[];
  excludeSyntheticStatusJobIds: Set<string>;
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) {
    return { rows: [], excludeSyntheticStatusJobIds: new Set() };
  }

  const { data, error } = await supabase
    .from("user_notifications")
    .select("id, notification_type, title, description, priority, job_id, read, created_at, dedupe_key, jobs ( job_number )")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("user_notifications fetch:", error.message);
    return { rows: [], excludeSyntheticStatusJobIds: new Set() };
  }

  const excludeSyntheticStatusJobIds = new Set<string>();
  const rows: Notification[] = (data ?? []).map((row) => {
    const r = row as {
      id: string;
      notification_type: string;
      title: string;
      description: string;
      priority: string;
      job_id: string | null;
      read: boolean;
      created_at: string;
      dedupe_key: string | null;
      jobs: { job_number?: string } | { job_number?: string }[] | null;
    };

    const dk = typeof r.dedupe_key === "string" ? r.dedupe_key : "";
    if (r.job_id && (dk.startsWith("meas-done:") || dk.startsWith("quote-acc:"))) {
      excludeSyntheticStatusJobIds.add(r.job_id);
    }

    const jobRel = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
    const jobNumber = jobRel?.job_number;

    const pri = r.priority === "high" || r.priority === "low" ? r.priority : r.priority === "medium" ? "medium" : "medium";

    return {
      id: `db:${r.id}`,
      type: coerceNotificationType(r.notification_type),
      title: r.title,
      description: r.description,
      priority: pri as NotificationPriority,
      timestamp: r.created_at,
      read: !!r.read,
      jobId: r.job_id ?? undefined,
      jobNumber,
    };
  });

  return { rows, excludeSyntheticStatusJobIds };
}

export function isPersistedNotificationId(id: string): boolean {
  return id.startsWith("db:");
}

export function persistedNotificationUuid(id: string): string | null {
  return isPersistedNotificationId(id) ? id.slice(3) : null;
}

/** Označava redove u `user_notifications` kao pročitane (samo `db:` id-jevi). */
export async function markPersistedNotificationsRead(notificationIds: string[]): Promise<void> {
  const uuids = notificationIds
    .map(persistedNotificationUuid)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (uuids.length === 0) return;

  const { error } = await supabase.from("user_notifications").update({ read: true }).in("id", uuids);
  if (error) throw error;
}

export async function fetchNotifications(): Promise<Notification[]> {
  const settings = readAppSettingsCache();
  if (settings.notifStaleJobStatus) {
    await supabase.rpc("run_job_sla_stale_reminders");
  }

  const [jobs, materialOrders, workOrders, persisted] = await Promise.all([
    fetchJobsList(),
    fetchMaterialOrdersForNotifications(),
    fetchWorkOrdersForNotifications(),
    fetchPersistedUserNotifications(),
  ]);
  const generated = generateNotifications(
    jobs,
    materialOrders,
    workOrders,
    persisted.excludeSyntheticStatusJobIds,
  );
  const merged = [...persisted.rows, ...generated];
  return merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
