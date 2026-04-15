import { supabase } from "@/lib/supabase";
import { fetchJobByIdForExport } from "@/hooks/use-jobs";
import { formatDateBySettings, formatDateTimeBySettings } from "@/lib/app-settings";
import type { FieldReport, WorkOrder } from "@/types";

const today = () => formatDateBySettings(new Date());

const typeLabels: Record<string, string> = {
  measurement: "Merenje",
  measurement_verification: "Provera mera",
  installation: "Ugradnja",
  complaint: "Reklamacija",
  service: "Servis",
  production: "Proizvodni nalog",
  site_visit: "Terenska poseta",
  control_visit: "Kontrolna poseta",
};

const statusLabels: Record<string, string> = {
  completed: "Završen", in_progress: "U toku", pending: "Na čekanju", canceled: "Otkazan",
};

async function fetchFieldReportForExport(reportId: string): Promise<FieldReport | null> {
  const { data, error } = await supabase
    .from("field_reports")
    .select(`
      *,
      work_orders (
        id,
        job_id,
        type,
        jobs (
          id,
          job_number,
          customers (name)
        )
      )
    `)
    .eq("id", reportId)
    .maybeSingle();

  if (error || !data) return null;

  const workOrderRaw = Array.isArray(data.work_orders) ? data.work_orders[0] : data.work_orders;
  const jobRaw = workOrderRaw?.jobs ? (Array.isArray(workOrderRaw.jobs) ? workOrderRaw.jobs[0] : workOrderRaw.jobs) : undefined;
  const customerRaw = jobRaw?.customers ? (Array.isArray(jobRaw.customers) ? jobRaw.customers[0] : jobRaw.customers) : undefined;

  return {
    id: data.id,
    jobId: data.job_id ?? workOrderRaw?.job_id ?? "",
    address: data.address || "Adresa nije upisana",
    arrived: !!data.arrived,
    arrivalDate: data.arrival_datetime ?? undefined,
    siteCanceled: !!data.site_canceled,
    cancelReason: data.cancel_reason ?? undefined,
    jobCompleted: !!data.completed,
    everythingOk: data.everything_ok ?? !data.issues,
    issueDescription: data.issues ?? undefined,
    handoverDate: data.handover_date ?? undefined,
    images: Array.isArray(data.images) ? data.images : [],
    missingItems: Array.isArray(data.missing_items) ? data.missing_items : [],
    additionalNeeds: Array.isArray(data.additional_needs) ? data.additional_needs : [],
    measurements: data.measurements ?? undefined,
    generalNotes: data.general_report ?? undefined,
    workOrderId: data.work_order_id ?? undefined,
    workOrderType: workOrderRaw?.type ?? undefined,
    job: jobRaw
      ? {
          id: jobRaw.id,
          jobNumber: jobRaw.job_number,
          customer: {
            fullName: customerRaw?.name || "Nepoznat",
          },
        }
      : undefined,
  };
}

async function fetchWorkOrderForExport(orderId: string): Promise<WorkOrder | null> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    jobId: data.job_id,
    type: data.type,
    description: data.description,
    assignedTeamId: data.team_id ?? undefined,
    date: data.date,
    status: data.status,
    attachmentName: data.file_id ? "attachment" : undefined,
    installationRef: data.installation_ref ?? undefined,
    productionRef: data.production_ref ?? undefined,
  };
}

function openPrintWindow(html: string) {
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }
}

const baseStyle = `
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 20px; font-size: 13px; line-height: 1.5; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; }
  .header h1 { font-size: 18px; margin: 0 0 4px 0; }
  .header .meta { font-size: 11px; color: #666; }
  .section { margin-bottom: 16px; }
  .section-title { font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .field-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.3px; }
  .field-value { font-size: 13px; margin-bottom: 8px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-right: 6px; }
  .badge-ok { background: #dcfce7; color: #166534; }
  .badge-warn { background: #fef9c3; color: #854d0e; }
  .badge-bad { background: #fee2e2; color: #991b1b; }
  .alert { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 10px; margin-bottom: 12px; }
  .alert-title { font-weight: 600; color: #991b1b; margin-bottom: 4px; font-size: 12px; }
  .tag { display: inline-block; background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; margin: 2px 4px 2px 0; }
  .note-box { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; font-size: 13px; }
  .footer { margin-top: 24px; font-size: 10px; color: #999; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 10px; font-size: 12px; border-bottom: 1px solid #e5e7eb; }
  th { font-weight: 600; color: #666; font-size: 10px; text-transform: uppercase; }
`;

export async function exportFieldReportPDF(report: FieldReport) {
  const reportFromDb = await fetchFieldReportForExport(report.id);
  const reportData = reportFromDb ?? report;
  const job = (await fetchJobByIdForExport(reportData.jobId)) ?? null;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Terenski izveštaj</title>
<style>${baseStyle}</style></head><body>
<div class="header">
  <div>
    <h1>Terenski izveštaj</h1>
    <div class="meta">${reportData.address}</div>
    ${job ? `<div class="meta">Posao: ${job.jobNumber} — ${job.customer.fullName}</div>` : reportData.job ? `<div class="meta">Posao: ${reportData.job.jobNumber} — ${reportData.job.customer.fullName}</div>` : ""}
  </div>
  <div style="text-align:right">
    <div class="meta">Datum: ${reportData.arrivalDate ? formatDateBySettings(reportData.arrivalDate) : "N/A"}</div>
    <div class="meta">Generisano: ${today()}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Status</div>
  <div>
    <span class="badge ${reportData.arrived ? "badge-ok" : "badge-warn"}">${reportData.arrived ? "Stigao na teren" : "Nije stigao"}</span>
    <span class="badge ${reportData.jobCompleted ? "badge-ok" : "badge-warn"}">${reportData.jobCompleted ? "Posao završen" : "Nezavršen"}</span>
    <span class="badge ${reportData.everythingOk ? "badge-ok" : "badge-bad"}">${reportData.everythingOk ? "Sve u redu" : "Ima problema"}</span>
    ${reportData.siteCanceled ? '<span class="badge badge-bad">Teren otkazan</span>' : ""}
  </div>
</div>

${reportData.siteCanceled && reportData.cancelReason ? `
<div class="alert">
  <div class="alert-title">Razlog otkazivanja</div>
  <div>${reportData.cancelReason}</div>
</div>` : ""}

${reportData.issueDescription ? `
<div class="alert">
  <div class="alert-title">Pronađeni problemi</div>
  <div>${reportData.issueDescription}</div>
</div>` : ""}

<div class="grid">
  ${reportData.arrivalDate ? `<div><div class="field-label">Datum dolaska</div><div class="field-value">${formatDateTimeBySettings(reportData.arrivalDate)}</div></div>` : ""}
  ${reportData.handoverDate ? `<div><div class="field-label">Primopredaja</div><div class="field-value">${formatDateBySettings(reportData.handoverDate)}</div></div>` : ""}
</div>

${reportData.measurements ? `
<div class="section">
  <div class="section-title">Mere</div>
  <div class="note-box">${reportData.measurements}</div>
</div>` : ""}

${reportData.missingItems.length > 0 ? `
<div class="section">
  <div class="section-title">Nedostajući delovi</div>
  <div>${reportData.missingItems.map(i => `<span class="tag">${i}</span>`).join("")}</div>
</div>` : ""}

${reportData.additionalNeeds.length > 0 ? `
<div class="section">
  <div class="section-title">Dodatne potrebe</div>
  <ul style="margin:0;padding-left:18px">${reportData.additionalNeeds.map(n => `<li>${n}</li>`).join("")}</ul>
</div>` : ""}

${reportData.generalNotes ? `
<div class="section">
  <div class="section-title">Napomene</div>
  <div class="note-box">${reportData.generalNotes}</div>
</div>` : ""}

${reportData.images.length > 0 ? `
<div class="section">
  <div class="section-title">Fotografije (${reportData.images.length})</div>
  <div>${reportData.images.map(img => `<span style="display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px;margin:2px 4px 2px 0;font-size:11px">📷 ${img}</span>`).join("")}</div>
</div>` : ""}

<div class="footer">Stolarija Kovačević d.o.o. · Terenski izveštaj · ${today()}</div>
</body></html>`;

  openPrintWindow(html);
}

export async function exportWorkOrderPDF(order: WorkOrder) {
  const orderFromDb = await fetchWorkOrderForExport(order.id);
  const orderData = orderFromDb ?? order;
  const job = await fetchJobByIdForExport(orderData.jobId);

  let teamLabel = "Nedodeljen";
  if (orderData.assignedTeamId) {
    const { data: teamRow } = await supabase.from("teams").select("name").eq("id", orderData.assignedTeamId).maybeSingle();
    if (teamRow?.name) teamLabel = teamRow.name;
  }

  const statusClass = orderData.status === "completed" ? "badge-ok" : orderData.status === "canceled" ? "badge-bad" : "badge-warn";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Radni nalog</title>
<style>${baseStyle}</style></head><body>
<div class="header">
  <div>
    <h1>Radni nalog</h1>
    <div class="meta">${typeLabels[orderData.type] || orderData.type}</div>
    ${job ? `<div class="meta">Posao: ${job.jobNumber} — ${job.customer.fullName}</div>` : ""}
  </div>
  <div style="text-align:right">
    <div class="meta">Datum: ${orderData.date}</div>
    <div class="meta">Generisano: ${today()}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Status</div>
  <span class="badge ${statusClass}">${statusLabels[orderData.status] || orderData.status}</span>
</div>

<div class="section">
  <div class="section-title">Detalji</div>
  <div class="grid">
    <div><div class="field-label">Tip</div><div class="field-value">${typeLabels[orderData.type]}</div></div>
    <div><div class="field-label">Tim</div><div class="field-value">${teamLabel}</div></div>
    <div><div class="field-label">Datum</div><div class="field-value">${orderData.date}</div></div>
    ${orderData.installationRef ? `<div><div class="field-label">Ref. ugradnje</div><div class="field-value">${orderData.installationRef}</div></div>` : ""}
    ${orderData.productionRef ? `<div><div class="field-label">Ref. proizvodnje</div><div class="field-value">${orderData.productionRef}</div></div>` : ""}
  </div>
</div>

<div class="section">
  <div class="section-title">Opis posla</div>
  <div class="note-box">${orderData.description}</div>
</div>

${job ? `
<div class="section">
  <div class="section-title">Podaci o kupcu</div>
  <div class="grid">
    <div><div class="field-label">Kupac</div><div class="field-value">${job.customer.fullName}</div></div>
    <div><div class="field-label">Kontakt</div><div class="field-value">${job.customer.contactPerson}</div></div>
    <div><div class="field-label">Adresa ugradnje</div><div class="field-value">${job.customer.installationAddress}</div></div>
    <div><div class="field-label">Telefon</div><div class="field-value">${job.customer.phones[0] || "—"}</div></div>
  </div>
</div>` : ""}

<div style="margin-top:40px;border-top:1px solid #ccc;padding-top:16px">
  <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
    <div><div class="field-label">Potpis predao</div><div style="border-bottom:1px solid #999;height:40px;margin-top:8px"></div></div>
    <div><div class="field-label">Potpis primio</div><div style="border-bottom:1px solid #999;height:40px;margin-top:8px"></div></div>
    <div><div class="field-label">Datum</div><div style="border-bottom:1px solid #999;height:40px;margin-top:8px"></div></div>
  </div>
</div>

<div class="footer">Stolarija Kovačević d.o.o. · Radni nalog · ${today()}</div>
</body></html>`;

  openPrintWindow(html);
}
