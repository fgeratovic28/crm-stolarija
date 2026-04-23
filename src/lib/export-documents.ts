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
import { buildNarudzbenicaDocumentHtml } from "@/lib/narudzbenica-html";
import { pdfMemorandumHeaderHtml } from "@/lib/pdf-memorandum";
import { PDF_DOCUMENT_STYLES } from "@/lib/pdf-document-theme";
import { upsertQuoteGeneratedPdf } from "@/lib/quote-generated-pdf-upload";
import { mapMaterialOrderRow } from "@/lib/map-material-order";
import type { FieldReport, FieldReportDetails, Job, MaterialOrder, Quote, WorkOrder } from "@/types";
import { jobPrimaryPhone } from "@/lib/job-contact-phone";
import { labelWorkOrderType } from "@/lib/activity-labels";

const today = () => formatDateBySettings(new Date());

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
      suppliers (id, name, contact_person, address, phone, email, bank_account, pib, nb_shipping_method),
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
    everythingOk: data.everything_ok ?? !data.issues,
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
      <div class="doc-brand-line">Stolarija Kovačević · Interni dokument</div>
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
    <div>${reportData.missingItems.map((i) => `<span class="tag">${escapeHtml(i)}</span>`).join("")}</div>
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

  <div class="footer">Stolarija Kovačević d.o.o. · Terenski izveštaj · ${today()}</div>
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
      <div class="doc-brand-line">Stolarija Kovačević · Interni dokument</div>
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

  <div class="footer">Stolarija Kovačević d.o.o. · Radni nalog · ${today()}</div>
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
};

export async function exportMaterialOrderPDF(order: MaterialOrder, options?: MaterialOrderExportOptions) {
  const orderFromDb = await fetchMaterialOrderForExport(order.id);
  const orderData = orderFromDb ?? order;
  const job = orderData.jobId ? await fetchJobByIdForExport(orderData.jobId) : null;

  const html = await buildNarudzbenicaDocumentHtml(orderData);
  openPrintWindow(html);

  if (options?.attachGeneratedPdf && options.userId) {
    void (async () => {
      try {
        const { htmlDocumentToPdfBlob } = await import("@/lib/pdf-from-html");
        const blob = await htmlDocumentToPdfBlob(html);
        const displayFilename = buildMaterialOrderPdfDisplayName(
          orderData.id,
          job?.jobNumber ?? orderData.job?.jobNumber ?? null,
        );
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

function quoteIssuerCardHtml(): string {
  const s = readAppSettingsCache();
  const name = s.companyName.trim() || "Stolarija Kovačević d.o.o.";
  const rows: string[] = [];
  if (s.companyAddress.trim()) rows.push(`<p>${escapeHtml(s.companyAddress.trim())}</p>`);
  if (s.companyPib.trim()) rows.push(`<p><strong>PIB</strong> ${escapeHtml(s.companyPib.trim())}</p>`);
  if (s.companyMb.trim()) rows.push(`<p><strong>MB</strong> ${escapeHtml(s.companyMb.trim())}</p>`);
  if (s.companyPhone.trim()) rows.push(`<p><strong>Tel.</strong> ${escapeHtml(s.companyPhone.trim())}</p>`);
  if (s.companyEmail.trim()) rows.push(`<p><strong>E-mail</strong> ${escapeHtml(s.companyEmail.trim())}</p>`);
  if (s.companyWebsite.trim()) rows.push(`<p><strong>Web</strong> ${escapeHtml(s.companyWebsite.trim())}</p>`);
  if (s.companyBankAccount.trim()) rows.push(`<p><strong>Žiro račun</strong> ${escapeHtml(s.companyBankAccount.trim())}</p>`);
  const hint =
    rows.length === 0
      ? `<p class="doc-party-hint">Podatke firme (naziv, PIB, adresa, žiro…) unesite u Podešavanjima.</p>`
      : "";
  return `<div class="card"><div class="doc-party-label">Izdavalac ponude</div><div class="doc-party-body"><p><strong>${escapeHtml(name)}</strong></p>${rows.join("")}${hint}</div></div>`;
}

function quoteCustomerCardHtml(job: Job | null): string {
  if (!job?.customer) {
    return `<div class="card"><div class="doc-party-label">Kupac</div><div class="doc-party-body"><p class="doc-party-hint">—</p></div></div>`;
  }
  const c = job.customer;
  const rows: string[] = [`<p><strong>${escapeHtml(c.fullName)}</strong></p>`];
  if (c.contactPerson.trim()) rows.push(`<p>${escapeHtml(c.contactPerson.trim())}</p>`);
  if (c.billingAddress.trim()) {
    rows.push(`<p><strong>Adresa (naplata)</strong><br/>${escapeHtml(c.billingAddress.trim())}</p>`);
  }
  if (c.installationAddress.trim()) {
    rows.push(`<p><strong>Adresa ugradnje</strong><br/>${escapeHtml(c.installationAddress.trim())}</p>`);
  }
  const phone = c.phones?.[0]?.trim();
  if (phone) rows.push(`<p><strong>Tel.</strong> ${escapeHtml(phone)}</p>`);
  const em = c.emails?.[0]?.trim();
  if (em) rows.push(`<p><strong>E-mail</strong> ${escapeHtml(em)}</p>`);
  if (c.pib.trim()) rows.push(`<p><strong>PIB</strong> ${escapeHtml(c.pib.trim())}</p>`);
  if (c.registrationNumber.trim()) rows.push(`<p><strong>Matični broj</strong> ${escapeHtml(c.registrationNumber.trim())}</p>`);
  return `<div class="card"><div class="doc-party-label">Kupac</div><div class="doc-party-body">${rows.join("")}</div></div>`;
}

function quoteHtml(quote: Quote, job: Job | null) {
  const settings = readAppSettingsCache();
  const currency = settings.currency;
  const companyShort = settings.companyName.trim() || "Stolarija Kovačević d.o.o.";
  const jobNumber = job?.jobNumber ?? "—";
  const customerName = job?.customer?.fullName ?? "Kupac";

  const linesRows =
    quote.lines.length > 0
      ? quote.lines
          .map((line) => {
            const amount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
            return `<tr>
  <td>${escapeHtml(line.description)}</td>
  <td class="num">${escapeHtml(String(line.quantity))}</td>
  <td class="num">${escapeHtml(formatCurrencyBySettings(Number(line.unitPrice) || 0))}</td>
  <td class="num">${escapeHtml(formatCurrencyBySettings(amount))}</td>
</tr>`;
          })
          .join("")
      : `<tr class="doc-empty-row"><td colspan="4">Nema stavki u ponudi</td></tr>`;

  const totalFormatted = escapeHtml(formatCurrencyBySettings(quote.totalAmount));

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ponuda</title>
<style>${docStyles}</style></head><body>
<div class="doc-wrap">
  ${pdfMemorandumHeaderHtml()}
  <div class="doc-accent"></div>
  <div class="doc-sheet">
  <div class="doc-parties-grid">
    ${quoteIssuerCardHtml()}
    ${quoteCustomerCardHtml(job)}
  </div>
  <div class="doc-header">
    <div class="doc-brand">
      <div class="doc-brand-line">${escapeHtml(companyShort)} · Ponuda</div>
      <h1 class="doc-title">Ponuda ${escapeHtml(quote.quoteNumber)}</h1>
      <p class="doc-lead">Verzija ${quote.versionNumber} · Posao <strong>${escapeHtml(jobNumber)}</strong> · ${escapeHtml(customerName)}</p>
    </div>
    <div class="doc-meta-right">
      <div><strong>Štampano</strong><br/>${today()}</div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Stavke</div>
    <div class="doc-table-wrap">
    <table class="doc-data-table" aria-label="Stavke ponude">
      <thead>
        <tr>
          <th>Opis</th>
          <th class="num" style="width:52px">Kol.</th>
          <th class="num" style="width:96px">Jed. cena (${currency})</th>
          <th class="num" style="width:96px">Iznos (${currency})</th>
        </tr>
      </thead>
      <tbody>${linesRows}</tbody>
    </table>
    </div>
    <div class="doc-total-panel">
      <div class="doc-total-box">
        <div class="doc-total-label">Ukupno (sa PDV)</div>
        <div><span class="doc-total-value">${totalFormatted}</span></div>
      </div>
    </div>
  </div>
  ${quote.note ? `<div class="section"><div class="section-title">Napomena</div><div class="note-box">${escapeHtml(quote.note)}</div></div>` : ""}
  <div class="footer">${escapeHtml(companyShort)} · Ponuda · ${today()}</div>
  </div>
</div>
</body></html>`;
}

export async function exportQuotePDF(quote: Quote, jobId: string, options?: GeneratedPdfSaveOptions) {
  const job = await fetchJobByIdForExport(jobId);
  const html = quoteHtml(quote, job);
  openPrintWindow(html);

  if (options?.attachGeneratedPdf && options.userId) {
    void (async () => {
      try {
        const { htmlDocumentToPdfBlob } = await import("@/lib/pdf-from-html");
        const blob = await htmlDocumentToPdfBlob(html);
        const result = await upsertQuoteGeneratedPdf({
          quote,
          jobId,
          blob,
          uploadedBy: options.userId!,
        });
        options.onPdfAttached?.(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Greška pri snimanju PDF ponude";
        options.onPdfAttachFailed?.(msg);
      }
    })();
  }
}

export async function prepareQuoteEmailDraft(quote: Quote, jobId: string, options?: GeneratedPdfSaveOptions) {
  const job = await fetchJobByIdForExport(jobId);
  const html = quoteHtml(quote, job);

  const { htmlDocumentToPdfBlob } = await import("@/lib/pdf-from-html");
  const blob = await htmlDocumentToPdfBlob(html);
  const fileName = `ponuda_${quote.quoteNumber.replace(/[^\w-]/g, "_")}.pdf`;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(objectUrl);

  if (options?.attachGeneratedPdf && options.userId) {
    try {
      const result = await upsertQuoteGeneratedPdf({
        quote,
        jobId,
        blob,
        uploadedBy: options.userId,
      });
      options.onPdfAttached?.(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Greška pri snimanju PDF ponude";
      options.onPdfAttachFailed?.(msg);
    }
  }

  const targetEmail = job?.customer?.emails?.[0] ?? "";
  const subject = encodeURIComponent(`Ponuda ${quote.quoteNumber}`);
  const body = encodeURIComponent(
    `Poštovani,\n\nu prilogu je ponuda ${quote.quoteNumber}.\n\nPozdrav.`,
  );
  window.open(`mailto:${targetEmail}?subject=${subject}&body=${body}`, "_self");
}
