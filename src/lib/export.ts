import { JOB_STATUS_CONFIG, type JobStatus, type Job } from "@/types";
import { formatCurrencyBySettings, formatDateBySettings } from "@/lib/app-settings";
import { pdfMemorandumHeaderHtml } from "@/lib/pdf-memorandum";
import { PDF_DOCUMENT_STYLES } from "@/lib/pdf-document-theme";

const formatMoney = (v: number) => formatCurrencyBySettings(v);
const today = () => formatDateBySettings(new Date());

/** Ukupno plaćeno po poslu (iz stanja posla nakon učitavanja uplata). */
function totalPaidForJob(j: Job): number {
  return Math.max(0, j.totalPrice - j.unpaidBalance);
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob(["\uFEFF" + content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportFinancesCSV(filteredJobs: Job[]) {
  const header = ["Posao #", "Kupac", "Status", "Fakturisano", "Avans", "Plaćeno", "Neplaćeno"];
  const rows = filteredJobs.map(j => [
    j.jobNumber,
    j.customer.fullName,
    JOB_STATUS_CONFIG[j.status as JobStatus]?.label || j.status,
    j.totalPrice,
    j.advancePayment,
    totalPaidForJob(j),
    j.unpaidBalance,
  ]);

  const totalRevenue = filteredJobs.reduce((s, j) => s + j.totalPrice, 0);
  const totalPaid = filteredJobs.reduce((s, j) => s + totalPaidForJob(j), 0);
  const totalUnpaid = filteredJobs.reduce((s, j) => s + j.unpaidBalance, 0);

  const csv = [
    header.join(";"),
    ...rows.map(r => r.join(";")),
    "",
    `Ukupno fakturisano;${totalRevenue}`,
    `Ukupno naplaćeno;${totalPaid}`,
    `Preostalo za naplatu;${totalUnpaid}`,
  ].join("\n");

  downloadFile(csv, `finansijski-izvestaj-${today()}.csv`, "text/csv");
}

export function exportFinancesPDF(filteredJobs: Job[]) {
  const totalRevenue = filteredJobs.reduce((s, j) => s + j.totalPrice, 0);
  const totalPaid = filteredJobs.reduce((s, j) => s + totalPaidForJob(j), 0);
  const totalUnpaid = filteredJobs.reduce((s, j) => s + j.unpaidBalance, 0);
  const collectionRate = totalRevenue > 0 ? Math.round((totalPaid / totalRevenue) * 100) : 0;

  const tableRows = filteredJobs
    .map((j) => {
      const paidCell =
        j.unpaidBalance > 0
          ? `<td class="fin-num fin-warn">${formatMoney(j.unpaidBalance)}</td>`
          : `<td class="fin-num fin-ok">Plaćeno</td>`;
      return `<tr>
      <td>${j.jobNumber}</td>
      <td>${j.customer.fullName}</td>
      <td>${JOB_STATUS_CONFIG[j.status as JobStatus]?.label || j.status}</td>
      <td class="fin-num">${formatMoney(j.totalPrice)}</td>
      <td class="fin-num">${formatMoney(j.advancePayment)}</td>
      ${paidCell}
    </tr>`;
    })
    .join("");

  const docStyles = PDF_DOCUMENT_STYLES;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Finansijski izveštaj</title>
<style>
  ${docStyles}
  @page { size: A4 landscape; margin: 12mm; }
  body { padding: 0 8px 12px; }
  .fin-land .doc-memorandum img { max-height: 26mm; max-width: min(100%, 168mm); margin: 0 auto; }
  .fin-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 18px;
    padding-bottom: 12px;
    border-bottom: 1px solid #e2e8f0;
  }
  .fin-header h1 { font-size: 18px; margin: 0; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; }
  .fin-header span { font-size: 11px; color: #64748b; display: block; margin-top: 6px; }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
  .stat {
    flex: 1 1 140px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
  }
  .stat-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 6px; }
  .stat-value { font-size: 17px; font-weight: 700; color: #0f172a; }
  .fin-table-wrap { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #fff; }
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; text-align: center; }
</style></head><body>
<div class="doc-wrap fin-land">
  ${pdfMemorandumHeaderHtml()}
  <div class="doc-accent"></div>
  <div class="fin-header">
    <div>
      <div class="doc-brand-line" style="margin-bottom:8px">Finansije · Interni pregled</div>
      <h1>Finansijski izveštaj</h1>
      <span>Datum: ${today()} · Poslova: ${filteredJobs.length}</span>
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Ukupno fakturisano</div><div class="stat-value">${formatMoney(totalRevenue)}</div></div>
    <div class="stat"><div class="stat-label">Ukupno naplaćeno</div><div class="stat-value">${formatMoney(totalPaid)}</div></div>
    <div class="stat"><div class="stat-label">Preostalo za naplatu</div><div class="stat-value" style="color:#b91c1c">${formatMoney(totalUnpaid)}</div></div>
    <div class="stat"><div class="stat-label">Stopa naplate</div><div class="stat-value">${collectionRate}%</div></div>
  </div>
  <div class="section" style="margin-top:0">
    <div class="section-title">Pregled po poslovima</div>
    <div class="fin-table-wrap">
    <table class="fin-data-table">
      <thead><tr>
        <th>Posao #</th><th>Kupac</th><th>Status</th><th class="fin-num">Fakturisano</th><th class="fin-num">Avans</th><th class="fin-num">Neplaćeno</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>
  </div>
  <div class="footer">Stolarija Kovačević · Finansijski izveštaj · ${today()}</div>
</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); }, 500);
  }
}
