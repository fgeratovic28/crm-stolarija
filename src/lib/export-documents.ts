import { supabase } from "@/lib/supabase";
import { fetchJobByIdForExport } from "@/hooks/use-jobs";
import {
  formatCurrencyBySettings,
  formatDateBySettings,
  formatDateTimeBySettings,
  readAppSettingsCache,
} from "@/lib/app-settings";
import {
  buildMaterialOrderPdfDisplayName,
  upsertMaterialOrderGeneratedPdf,
  type MaterialOrderPdfUpsertResult,
} from "@/lib/material-order-pdf-upload";
import { upsertJobScopedGeneratedPdf } from "@/lib/job-generated-pdf-upload";
import {
  generateProcurementOrderPdfBlob,
  generateProcurementOrderPdfBlobFromSmartItems,
  buildMaterialOrderShareOrCrmUrl,
} from "@/lib/material-order-procurement-pdf";
import { parseMaterialOrderItemsJson, validateSmartItemsJson, type MaterialOrderItemsJsonV1 } from "@/lib/material-order-items-json";
import { buildOrderReceptionAbsoluteUrl } from "@/lib/order-reception-url";
import type { MaterialOrderLineFormValues } from "@/lib/material-order-form-schema";
import { materialOrderFormLinesToMaterialOrderLines } from "@/lib/material-order-form-lines-mapper";
import { normalizeOrderLines } from "@/lib/material-order-lines";
import {
  materialOrderLineToImportedItemForBarcode,
  procurementBarcodeValueForOrderLine,
  procurementPdfRowsFromOrderLines,
} from "@/lib/material-order-procurement-rows";
import { pdfMemorandumHeaderHtml } from "@/lib/pdf-memorandum";
import { PDF_DOCUMENT_STYLES } from "@/lib/pdf-document-theme";
import { openPdfBlobInNewTabOrDownload } from "@/lib/pdf-from-html";
import { mapMaterialOrderRow } from "@/lib/map-material-order";
import type { ImportedOrderItem } from "@/lib/procurement-excel-import";
import type { FieldReport, FieldReportDetails, Job, MaterialOrder, MaterialOrderLine, WorkOrder } from "@/types";
import { fieldReportEverythingOkFromDbRow, displayFieldReportMissingItem } from "@/lib/field-report-mappers";
import { jobPrimaryPhone } from "@/lib/job-contact-phone";
import { labelWorkOrderType } from "@/lib/activity-labels";

const today = () => formatDateBySettings(new Date());

/** Ručne stavke za smart PDF (isti dodatak kao u pregledu u formi). */
function manualAppendixImportedFromNormalizedLines(lines: MaterialOrderLine[]): ImportedOrderItem[] {
  const out: ImportedOrderItem[] = [];
  for (const line of lines) {
    if (line.procurementMeta?.manual_line === false) continue;
    const item = materialOrderLineToImportedItemForBarcode(line);
    if (item) out.push(item);
  }
  return out;
}

/** Stabilan ključ za sistemski barkod ručnih stavki u PDF-u pre snimanja narudžbine (isti dok se ne promene redovi). */
function fingerprintProcurementDraftNbLines(nb: MaterialOrderLineFormValues[]): string {
  const s = JSON.stringify(
    nb.map((l) => [String(l.description ?? "").trim(), l.quantity, String(l.unit ?? "").trim()]),
  );
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h, 33) + s.charCodeAt(i);
  }
  return String((h >>> 0) % 1_000_000_000).padStart(9, "0");
}

function buildProcurementDraftScopeKey(jobId: string | undefined, nb: MaterialOrderLineFormValues[]): string {
  return `pregled:${jobId?.trim() || "bez-posla"}:${fingerprintProcurementDraftNbLines(nb)}`;
}

function fingerprintSmartItemsJson(ij: MaterialOrderItemsJsonV1): string {
  const s = JSON.stringify([ij.columns, ij.rows, ij.articleColumnKey, ij.quantityColumnKey]);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h, 33) + s.charCodeAt(i);
  }
  return String((h >>> 0) % 1_000_000_000).padStart(9, "0");
}

function fingerprintImportedAppendixForDraft(items: ImportedOrderItem[]): string {
  const s = JSON.stringify(
    items.map((r) => [
      r.article,
      r.quantity,
      r.work_order ?? "",
      r.position ?? "",
      r.article_code ?? "",
      r.color ?? "",
      r.uom ?? "",
      r.length_mm ?? "",
    ]),
  );
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h, 33) + s.charCodeAt(i);
  }
  return String((h >>> 0) % 1_000_000_000).padStart(9, "0");
}

function buildSmartDraftScopeKey(
  jobId: string | undefined,
  ij: MaterialOrderItemsJsonV1,
  appendix?: ImportedOrderItem[] | null,
): string {
  const core = fingerprintSmartItemsJson(ij);
  const suf = appendix?.length ? `:ap:${fingerprintImportedAppendixForDraft(appendix)}` : "";
  return `pregled-smart:${jobId?.trim() || "bez-posla"}:${core}${suf}`;
}

/** Blob za pregled u modalu / štampu — smart tabela ili klasične stavke. */
export async function buildDraftMaterialOrderProcurementPdfBlob(params: {
  itemsJson?: MaterialOrderItemsJsonV1 | null;
  nbLines: MaterialOrderLineFormValues[];
  jobId?: string;
  jobNumberLabel: string;
  notes?: string;
}): Promise<Blob | null> {
  const crmUrl = buildMaterialOrderShareOrCrmUrl({
    publicShareToken: null,
    jobId: params.jobId ?? null,
    materialOrderId: null,
  });
  const ij = params.itemsJson ?? null;
  if (ij && validateSmartItemsJson(ij) === null) {
    const appendixFormLines = params.nbLines.filter((l) => l.procurementMeta?.manual_line !== false);
    const appendixImported: ImportedOrderItem[] = [];
    if (appendixFormLines.length > 0) {
      const mappedLines = materialOrderFormLinesToMaterialOrderLines(appendixFormLines, { zeroLineNet: true });
      for (const line of mappedLines) {
        const item = materialOrderLineToImportedItemForBarcode(line);
        if (item) appendixImported.push(item);
      }
    }
    return generateProcurementOrderPdfBlobFromSmartItems({
      itemsJson: ij,
      nalogLabel: params.jobNumberLabel.trim() || "—",
      crmUrl,
      footerNote: params.notes?.trim() ?? "",
      manualAppendixImportedRows: appendixImported.length > 0 ? appendixImported : undefined,
      barcodeScope: {
        draftScopeKey: buildSmartDraftScopeKey(
          params.jobId,
          ij,
          appendixImported.length > 0 ? appendixImported : undefined,
        ),
      },
    });
  }
  const lines = materialOrderFormLinesToMaterialOrderLines(params.nbLines, { zeroLineNet: true });
  const rows = procurementPdfRowsFromOrderLines(lines);
  if (!rows) return null;
  return generateProcurementOrderPdfBlob({
    rows,
    nalogLabel: params.jobNumberLabel.trim() || "—",
    crmUrl,
    footerNote: params.notes?.trim() ?? "",
    barcodeScope: { draftScopeKey: buildProcurementDraftScopeKey(params.jobId, params.nbLines) },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeImageSrc(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || u.startsWith("data:")) return u;
  return null;
}

type JobLite = { id: string; job_number: string };

async function fetchMaterialOrderForExport(orderId: string): Promise<MaterialOrder | null> {
  const { data, error } = await supabase
    .from("material_orders")
    .select(`
      *,
      suppliers (id, name, contact_person, address, phone, email, bank_account, pib),
      jobs (id, job_number)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) return null;

  const jobData = Array.isArray(data.jobs) ? data.jobs[0] : data.jobs;
  return mapMaterialOrderRow(data as Record<string, unknown>, jobData as JobLite | null | undefined);
}

const statusLabels: Record<string, string> = {
  completed: "Završen",
  in_progress: "U toku",
  pending: "Na čekanju",
  canceled: "Otkazan",
};

async function fetchFieldReportForExport(reportId: string): Promise<FieldReport | null> {
  const { data, error } = await supabase
    .from("field_reports")
    .select(`
      *,
      work_orders!field_reports_work_order_id_fkey (
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

  const rawDetails = (data as { details?: unknown }).details;
  const detailsParsed =
    rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
      ? (rawDetails as FieldReportDetails)
      : undefined;
  const estH = (data as { estimated_installation_hours?: unknown }).estimated_installation_hours;
  const estNum =
    estH === null || estH === undefined ? undefined : typeof estH === "number" ? estH : Number(estH);

  return {
    id: data.id,
    jobId: data.job_id ?? workOrderRaw?.job_id ?? "",
    address: data.address || "Adresa nije upisana",
    arrived: !!data.arrived,
    arrivalDate: data.arrival_datetime ?? undefined,
    siteCanceled: !!data.site_canceled,
    cancelReason: data.cancel_reason ?? undefined,
    jobCompleted: !!data.completed,
    everythingOk: fieldReportEverythingOkFromDbRow({
      everything_ok: data.everything_ok,
      issues: data.issues,
      missing_items: data.missing_items,
    }),
    issueDescription: data.issues ?? undefined,
    details: detailsParsed,
    estimatedInstallationHours: Number.isFinite(estNum as number) ? (estNum as number) : undefined,
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
    measurementLocation: data.measurement_location ?? undefined,
    measurementScope: data.measurement_scope ?? undefined,
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

const docStyles = PDF_DOCUMENT_STYLES;
const pdfCompanyName = () => readAppSettingsCache().companyName.trim() || "Termo Plast D.O.O";

export type GeneratedPdfSaveOptions = {
  attachGeneratedPdf?: boolean;
  userId?: string;
  onPdfAttached?: (result: "created" | "updated") => void;
  onPdfAttachFailed?: (message: string) => void;
};

export async function exportFieldReportPDF(report: FieldReport, options?: GeneratedPdfSaveOptions) {
  const reportFromDb = await fetchFieldReportForExport(report.id);
  const reportData = reportFromDb ?? report;
  const job = (await fetchJobByIdForExport(reportData.jobId)) ?? null;

  const arrivalLine = reportData.arrivalDate ? formatDateTimeBySettings(reportData.arrivalDate) : "—";
  const det = reportData.details;
  const actionTimeRows: string[] = [];
  if (det?.arrivedAt) {
    actionTimeRows.push(
      `<div><div class="field-label">Stigao na teren (zabeleženo)</div><div class="field-value">${escapeHtml(formatDateTimeBySettings(det.arrivedAt))}</div></div>`,
    );
  }
  if (det?.canceledAt) {
    actionTimeRows.push(
      `<div><div class="field-label">Otkazivanje (zabeleženo)</div><div class="field-value">${escapeHtml(formatDateTimeBySettings(det.canceledAt))}</div></div>`,
    );
  }
  if (det?.finishedAt) {
    actionTimeRows.push(
      `<div><div class="field-label">Gotov (zabeleženo)</div><div class="field-value">${escapeHtml(formatDateTimeBySettings(det.finishedAt))}</div></div>`,
    );
  }
  if (det?.issueReportedAt) {
    actionTimeRows.push(
      `<div><div class="field-label">Prijava problema (zabeleženo)</div><div class="field-value">${escapeHtml(formatDateTimeBySettings(det.issueReportedAt))}</div></div>`,
    );
  }
  if (det?.additionalReqAt) {
    actionTimeRows.push(
      `<div><div class="field-label">Dodatni zahtev (zabeleženo)</div><div class="field-value">${escapeHtml(formatDateTimeBySettings(det.additionalReqAt))}</div></div>`,
    );
  }
  const jobSubtitle = job
    ? `${escapeHtml(job.jobNumber)} · ${escapeHtml(job.customer.fullName)}`
    : reportData.job
      ? `${escapeHtml(reportData.job.jobNumber)} · ${escapeHtml(reportData.job.customer.fullName)}`
      : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Terenski izveštaj</title>
<style>${docStyles}</style></head><body>
<div class="doc-wrap">
  ${pdfMemorandumHeaderHtml()}
  <div class="doc-accent"></div>
  <div class="doc-sheet">
  <div class="doc-header">
    <div class="doc-brand">
      <div class="doc-brand-line">${escapeHtml(pdfCompanyName())} · Interni dokument</div>
      <h1 class="doc-title">Terenski izveštaj</h1>
      <p class="doc-lead">${escapeHtml(reportData.address)}</p>
      ${jobSubtitle ? `<p class="doc-lead" style="margin-top:6px">${jobSubtitle}</p>` : ""}
    </div>
    <div class="doc-meta-right">
      <div><strong>Datum / vreme</strong><br/>${arrivalLine}</div>
      <div style="margin-top:10px"><strong>Štampano</strong><br/>${today()}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Status</div>
    <div class="badge-row">
      <span class="badge ${reportData.jobCompleted ? "badge-ok" : "badge-warn"}">${reportData.jobCompleted ? "Posao završen" : "Nezavršen"}</span>
      <span class="badge ${reportData.everythingOk ? "badge-ok" : "badge-bad"}">${reportData.everythingOk ? "Sve u redu" : "Ima problema"}</span>
      ${reportData.siteCanceled ? '<span class="badge badge-bad">Teren otkazan</span>' : ""}
    </div>
  </div>

  ${reportData.siteCanceled && reportData.cancelReason ? `
  <div class="alert">
    <div class="alert-title">Razlog otkazivanja</div>
    <div>${escapeHtml(reportData.cancelReason)}</div>
  </div>` : ""}

  ${reportData.issueDescription ? `
  <div class="alert">
    <div class="alert-title">Pronađeni problemi</div>
    <div>${escapeHtml(reportData.issueDescription)}</div>
  </div>` : ""}

  <div class="section">
    <div class="section-title">Vremena</div>
    <div class="card"><div class="grid">
      ${reportData.arrivalDate ? `<div><div class="field-label">Dolazak</div><div class="field-value">${escapeHtml(formatDateTimeBySettings(reportData.arrivalDate))}</div></div>` : ""}
      ${reportData.handoverDate ? `<div><div class="field-label">Primopredaja</div><div class="field-value">${escapeHtml(formatDateBySettings(reportData.handoverDate))}</div></div>` : ""}
      ${actionTimeRows.join("")}
    </div></div>
  </div>

  ${
    reportData.workOrderType === "measurement" &&
    reportData.estimatedInstallationHours != null &&
    Number.isFinite(reportData.estimatedInstallationHours)
      ? `
  <div class="section">
    <div class="section-title">Procena ugradnje</div>
    <div class="note-box">${escapeHtml(String(reportData.estimatedInstallationHours))} h</div>
  </div>`
      : ""
  }

  ${reportData.measurements ? `
  <div class="section">
    <div class="section-title">Mere</div>
    <div class="note-box">${escapeHtml(reportData.measurements)}</div>
  </div>` : ""}

  ${reportData.missingItems.length > 0 ? `
  <div class="section">
    <div class="section-title">Nedostajući delovi</div>
    <div>${reportData.missingItems.map((i) => `<span class="tag">${escapeHtml(displayFieldReportMissingItem(i))}</span>`).join("")}</div>
  </div>` : ""}

  ${reportData.additionalNeeds.length > 0 ? `
  <div class="section">
    <div class="section-title">Dodatne potrebe</div>
    <ul class="doc-list">${reportData.additionalNeeds.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
  </div>` : ""}

  ${reportData.generalNotes ? `
  <div class="section">
    <div class="section-title">Napomene</div>
    <div class="note-box">${escapeHtml(reportData.generalNotes)}</div>
  </div>` : ""}

  ${reportData.images.length > 0 ? `
  <div class="section">
    <div class="section-title">Fotografije (${reportData.images.length})</div>
    <div class="photo-grid">${reportData.images
      .map((img, i) => {
        const src = safeImageSrc(img);
        return src
          ? `<img src="${src.replace(/"/g, "&quot;")}" alt="Fotografija ${i + 1}" />`
          : "";
      })
      .join("")}</div>
  </div>` : ""}

  <div class="footer">${escapeHtml(pdfCompanyName())} · Terenski izveštaj · ${today()}</div>
  </div>
</div>
</body></html>`;

  openPrintWindow(html);

  if (options?.attachGeneratedPdf && options.userId && reportData.jobId) {
    void (async () => {
      try {
        const { htmlDocumentToPdfBlob } = await import("@/lib/pdf-from-html");
        const blob = await htmlDocumentToPdfBlob(html);
        const jn = job?.jobNumber?.trim().replace(/[^\w\u0400-\u04FF-]/g, "_") || "posao";
        const idShort = reportData.id.replace(/-/g, "").slice(0, 8).toUpperCase();
        const displayFilename = `Terenski_izvestaj_${jn}_${idShort}.pdf`;
        const result = await upsertJobScopedGeneratedPdf({
          jobId: reportData.jobId,
          storageLeaf: `terenski-izvestaj-${reportData.id}.pdf`,
          blob,
          uploadedBy: options.userId!,
          displayFilename,
          category: "reports",
          activityDescription: `PDF terenskog izveštaja (štampa): ${displayFilename}`,
          systemKey: `field-report-autopdf:${reportData.id}`,
        });
        options.onPdfAttached?.(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Greška pri snimanju PDF-a";
        options.onPdfAttachFailed?.(msg);
      }
    })();
  }
}

export async function exportWorkOrderPDF(order: WorkOrder, options?: GeneratedPdfSaveOptions) {
  const orderFromDb = await fetchWorkOrderForExport(order.id);
  const orderData = orderFromDb ?? order;
  const job = await fetchJobByIdForExport(orderData.jobId);

  let teamLabel = "Nedodeljen";
  if (orderData.assignedTeamId) {
    const { data: teamRow } = await supabase.from("teams").select("name").eq("id", orderData.assignedTeamId).maybeSingle();
    if (teamRow?.name) teamLabel = teamRow.name;
  }

  const statusClass = orderData.status === "completed" ? "badge-ok" : orderData.status === "canceled" ? "badge-bad" : "badge-warn";
  const typeLabel = labelWorkOrderType(orderData.type);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Radni nalog</title>
<style>${docStyles}</style></head><body>
<div class="doc-wrap">
  ${pdfMemorandumHeaderHtml()}
  <div class="doc-accent"></div>
  <div class="doc-sheet">
  <div class="doc-header">
    <div class="doc-brand">
      <div class="doc-brand-line">${escapeHtml(pdfCompanyName())} · Interni dokument</div>
      <h1 class="doc-title">Radni nalog</h1>
      <p class="doc-lead">${escapeHtml(typeLabel)}</p>
      ${job ? `<p class="doc-lead">${escapeHtml(job.jobNumber)} · ${escapeHtml(job.customer.fullName)}</p>` : ""}
    </div>
    <div class="doc-meta-right">
      <div><strong>Datum naloga</strong><br/>${escapeHtml(orderData.date || "—")}</div>
      <div style="margin-top:10px"><strong>Štampano</strong><br/>${today()}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Status</div>
    <span class="badge ${statusClass}">${statusLabels[orderData.status] || orderData.status}</span>
  </div>

  <div class="section">
    <div class="section-title">Detalji</div>
    <div class="card"><div class="grid">
      <div><div class="field-label">Tip</div><div class="field-value">${escapeHtml(typeLabel)}</div></div>
      <div><div class="field-label">Tim</div><div class="field-value">${escapeHtml(teamLabel)}</div></div>
      <div><div class="field-label">Datum</div><div class="field-value">${escapeHtml(orderData.date || "—")}</div></div>
      ${orderData.installationRef ? `<div><div class="field-label">Ref. ugradnje</div><div class="field-value">${escapeHtml(orderData.installationRef)}</div></div>` : ""}
      ${orderData.productionRef ? `<div><div class="field-label">Ref. proizvodnje</div><div class="field-value">${escapeHtml(orderData.productionRef)}</div></div>` : ""}
      ${
        orderData.type === "measurement" || orderData.type === "measurement_verification"
          ? `<div><div class="field-label">Gde se meri</div><div class="field-value">${escapeHtml(orderData.measurementLocation || "—")}</div></div>
      <div><div class="field-label">Šta se meri</div><div class="field-value">${escapeHtml(orderData.measurementScope || "—")}</div></div>`
          : ""
      }
    </div></div>
  </div>

  <div class="section">
    <div class="section-title">Opis posla</div>
    <div class="note-box">${escapeHtml(orderData.description || "—")}</div>
  </div>

  ${job ? `
  <div class="section">
    <div class="section-title">Kupac</div>
    <div class="card"><div class="grid">
      <div><div class="field-label">Naziv</div><div class="field-value">${escapeHtml(job.customer.fullName)}</div></div>
      <div><div class="field-label">Kontakt</div><div class="field-value">${escapeHtml(job.customer.contactPerson)}</div></div>
      <div><div class="field-label">Adresa ugradnje</div><div class="field-value">${escapeHtml(job.customer.installationAddress)}</div></div>
      <div><div class="field-label">Telefon</div><div class="field-value">${escapeHtml(jobPrimaryPhone(job) || "—")}</div></div>
    </div></div>
  </div>` : ""}

  <div class="sign-row">
    <div class="section-title">Potpisi</div>
    <div class="sign-grid">
      <div><div class="field-label">Predao</div><div class="sign-line"></div></div>
      <div><div class="field-label">Primio</div><div class="sign-line"></div></div>
      <div><div class="field-label">Datum</div><div class="sign-line"></div></div>
    </div>
  </div>

  <div class="footer">${escapeHtml(pdfCompanyName())} · Radni nalog · ${today()}</div>
  </div>
</div>
</body></html>`;

  openPrintWindow(html);

  if (options?.attachGeneratedPdf && options.userId && orderData.jobId) {
    void (async () => {
      try {
        const { htmlDocumentToPdfBlob } = await import("@/lib/pdf-from-html");
        const blob = await htmlDocumentToPdfBlob(html);
        const jn = job?.jobNumber?.trim().replace(/[^\w\u0400-\u04FF-]/g, "_") || "posao";
        const idShort = orderData.id.replace(/-/g, "").slice(0, 8).toUpperCase();
        const displayFilename = `Radni_nalog_${jn}_${idShort}.pdf`;
        const result = await upsertJobScopedGeneratedPdf({
          jobId: orderData.jobId,
          storageLeaf: `radni-nalog-${orderData.id}.pdf`,
          blob,
          uploadedBy: options.userId!,
          displayFilename,
          category: "work_order",
          activityDescription: `PDF radnog naloga (štampa): ${displayFilename}`,
          systemKey: `work-order-autopdf:${orderData.id}`,
        });
        options.onPdfAttached?.(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Greška pri snimanju PDF-a";
        options.onPdfAttachFailed?.(msg);
      }
    })();
  }
}

export type MaterialOrderExportOptions = {
  /** Snimi generisani PDF u priloge narudžbine (R2), jedan fajl po narudžbini — prepis pri izmeni. */
  attachGeneratedPdf?: boolean;
  userId?: string;
  onPdfAttached?: (result: MaterialOrderPdfUpsertResult) => void;
  onPdfAttachFailed?: (message: string) => void;
  /** Rezervisan tab/prozor otvoren tokom user klika (mobilni/PWA popup-safe). */
  targetWindow?: Window | null;
  /** Podrazumevano true; false = samo prilog (npr. posle kreiranja narudžbine). */
  openInBrowser?: boolean;
};

/**
 * PDF porudžbine iz trenutnih stavki u formi (pre čuvanja u CRM) — isti izgled kao posle snimanja.
 */
export async function exportDraftProcurementOrderPdfFromFormLines(params: {
  nbLines: MaterialOrderLineFormValues[];
  jobId?: string;
  jobNumberLabel: string;
  notes?: string;
  itemsJson?: MaterialOrderItemsJsonV1 | null;
  /** Rezervisan tab/prozor otvoren tokom user klika (mobilni/PWA popup-safe). */
  targetWindow?: Window | null;
}): Promise<void> {
  const blob = await buildDraftMaterialOrderProcurementPdfBlob({
    itemsJson: params.itemsJson,
    nbLines: params.nbLines,
    jobId: params.jobId,
    jobNumberLabel: params.jobNumberLabel,
    notes: params.notes,
  });
  if (!blob) {
    throw new Error(
      "Nema ispravnih stavki za PDF (svaka treba bar naziv / opis ili uvezene nabavke kolone). Dodajte ili uvezite stavke.",
    );
  }
  const safeJob = params.jobNumberLabel.trim().replace(/[^\w\u0400-\u04FF-]/g, "_") || "pregled";
  openPdfBlobInNewTabOrDownload(blob, `Porudzbenica_${safeJob}_pregled.pdf`, params.targetWindow);
}

export async function exportMaterialOrderPDF(order: MaterialOrder, options?: MaterialOrderExportOptions) {
  const orderFromDb = await fetchMaterialOrderForExport(order.id);
  const orderData = orderFromDb ?? order;
  const job = orderData.jobId ? await fetchJobByIdForExport(orderData.jobId) : null;

  const nalogLabel = (job?.jobNumber || orderData.job?.jobNumber || "").trim() || "—";
  const crmUrl = buildMaterialOrderShareOrCrmUrl({
    publicShareToken: orderData.publicShareToken,
    jobId: orderData.jobId,
    materialOrderId: orderData.id,
  });

  const isShortage = orderData.isShortageOrder === true;
  const pdfTitle = isShortage ? "PORUDZBINA PO NEDOSTATKU" : undefined;
  /** Za Porudžbinu po nedostatku ne štampamo nikakav footer — naslov dokumenta već
   *  identifikuje tip, a auto-generisane sistemske napomene (Express tok, referenca...)
   *  ne treba da budu na PDF-u koji se šalje dobavljaču. */
  const userNote = orderData.notes?.trim() ?? "";
  const footerNote = isShortage ? "" : userNote;

  const lines = normalizeOrderLines(orderData);
  const rowsFromLines = procurementPdfRowsFromOrderLines(lines);
  const ij = parseMaterialOrderItemsJson(orderData.itemsJson);
  const rowsFromSmart = ij && validateSmartItemsJson(ij) === null ? ij : null;

  /**
   * Za „Porudžbinu po nedostatku" magacin treba da skenira ISTE barkodove sa originalne porudžbenice
   * (svaka linija ima `shortageSource` koji upućuje na parent + parent_line_index). Ovde se ti
   * barkodovi unapred izračunaju da PDF ne generiše nove na osnovu svog (shortage) ID-a.
   */
  const perRowBarcodes = isShortage
    ? lines.map((l, idx) =>
        procurementBarcodeValueForOrderLine(l, { materialOrderId: orderData.id, lineIndex: idx }),
      )
    : undefined;

  let blob: Blob;
  /** Sa validnim `items_json` štampa se ista smart tabela kao u pregledu (ne klasični PDF iz `nb_lines`). */
  if (rowsFromSmart != null && !isShortage) {
    const appendixImported = manualAppendixImportedFromNormalizedLines(lines);
    blob = await generateProcurementOrderPdfBlobFromSmartItems({
      itemsJson: rowsFromSmart,
      nalogLabel,
      crmUrl,
      footerNote,
      manualAppendixImportedRows: appendixImported.length > 0 ? appendixImported : undefined,
      barcodeScope: { materialOrderId: orderData.id },
    });
  } else if (rowsFromLines && rowsFromLines.length > 0) {
    blob = await generateProcurementOrderPdfBlob({
      rows: rowsFromLines,
      nalogLabel,
      crmUrl,
      footerNote,
      barcodeScope: { materialOrderId: orderData.id },
      pdfTitle,
      perRowBarcodes,
    });
  } else if (rowsFromSmart) {
    const appendixImported = manualAppendixImportedFromNormalizedLines(lines);
    blob = await generateProcurementOrderPdfBlobFromSmartItems({
      itemsJson: rowsFromSmart,
      nalogLabel,
      crmUrl,
      footerNote,
      manualAppendixImportedRows: appendixImported.length > 0 ? appendixImported : undefined,
      barcodeScope: { materialOrderId: orderData.id },
      pdfTitle,
    });
  } else {
    throw new Error(
      "PDF porudžbine nije dostupan: stavke nemaju nazive / podatke za nabavku. Dopunite stavke ili uvezite Excel, sačuvajte pa ponovo štampajte.",
    );
  }

  const displayFilename = buildMaterialOrderPdfDisplayName(
    orderData.id,
    job?.jobNumber ?? orderData.job?.jobNumber ?? null,
  );
  if (options?.openInBrowser !== false) {
    openPdfBlobInNewTabOrDownload(blob, displayFilename, options?.targetWindow);
  }

  if (options?.attachGeneratedPdf && options.userId) {
    void (async () => {
      try {
        const result = await upsertMaterialOrderGeneratedPdf({
          materialOrderId: orderData.id,
          jobId: orderData.jobId,
          blob,
          uploadedBy: options.userId!,
          displayFilename,
        });
        options.onPdfAttached?.(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Greška pri snimanju PDF priloga";
        options.onPdfAttachFailed?.(msg);
      }
    })();
  }
}
