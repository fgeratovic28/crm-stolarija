import { supabase } from "@/lib/supabase";
import { fetchJobsList } from "@/hooks/use-jobs";
import { formatCurrencyBySettings, formatDateBySettings, readAppSettingsCache } from "@/lib/app-settings";
import type { Job, MaterialOrder, WorkOrder } from "@/types";
import { labelJobStatus, labelMaterialType } from "@/lib/activity-labels";

export type NotificationType =
  | "overdue_payment"
  | "material_delivery"
  | "upcoming_installation"
  | "complaint"
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
    .order("request_date", { ascending: false });

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
): Notification[] {
  const settings = readAppSettingsCache();
  const notifications: Notification[] = [];

  if (settings.notifOverduePayments) {
    jobs
      .filter(
        (j) =>
          j.unpaidBalance > 0 &&
          j.status !== "new" &&
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
      .filter((m) => m.deliveryStatus === "shipped" || m.deliveryStatus === "pending")
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
            expected ? formatDateBySettings(expected) : "N/A"
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

  if (settings.notifStaleJobStatus) {
    const threshold = settings.jobStaleStatusDays;
    const slaStatuses = new Set<Job["status"]>(["new", "quote_sent", "measuring", "in_production"]);
    jobs
      .filter((j) => slaStatuses.has(j.status) && j.statusLocked !== true)
      .forEach((j) => {
        const anchorStr = j.statusChangedAt ?? j.createdAt;
        const days = Math.floor((Date.now() - new Date(anchorStr).getTime()) / 86400000);
        if (days < threshold) return;
        notifications.push({
          id: `notif-sla-${j.id}`,
          type: "stale_job_status",
          title: "SLA: zastoj u statusu",
          description: `${j.jobNumber} — ${labelJobStatus(j.status)} bez promene statusa ${days} dana (od ${formatDateBySettings(anchorStr)})`,
          priority: days >= threshold * 2 ? "high" : "medium",
          timestamp: anchorStr,
          read: false,
          jobId: j.id,
          jobNumber: j.jobNumber,
        });
      });
  }

  return notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function fetchNotifications(): Promise<Notification[]> {
  await supabase.rpc("run_job_sla_stale_reminders");

  const [jobs, materialOrders, workOrders] = await Promise.all([
    fetchJobsList(),
    fetchMaterialOrdersForNotifications(),
    fetchWorkOrdersForNotifications(),
  ]);
  return generateNotifications(jobs, materialOrders, workOrders);
}
