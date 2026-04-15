import { JOB_STATUS_CONFIG, type JobStatus, type Job } from "@/types";
import { formatCurrencyBySettings, formatDateBySettings } from "@/lib/app-settings";

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

  const tableRows = filteredJobs.map(j => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${j.jobNumber}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${j.customer.fullName}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${JOB_STATUS_CONFIG[j.status as JobStatus]?.label || j.status}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">${formatMoney(j.totalPrice)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">${formatMoney(j.advancePayment)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;color:${j.unpaidBalance > 0 ? '#dc2626' : '#16a34a'}">${j.unpaidBalance > 0 ? formatMoney(j.unpaidBalance) : 'Plaćeno'}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Finansijski izveštaj</title>
<style>
  @page { size: A4 landscape; margin: 15mm; }
  body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; }
  .header h1 { font-size: 20px; margin: 0; }
  .header span { font-size: 12px; color: #666; }
  .stats { display: flex; gap: 16px; margin-bottom: 24px; }
  .stat { flex:1; background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
  .stat-label { font-size: 11px; color: #666; margin-bottom: 4px; }
  .stat-value { font-size: 18px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 600; color: #666; border-bottom: 2px solid #d1d5db; text-transform: uppercase; }
  th:nth-child(n+4) { text-align: right; }
  .footer { margin-top: 24px; font-size: 10px; color: #999; text-align: center; }
</style></head><body>
<div class="header">
  <h1>Finansijski izveštaj</h1>
  <span>Datum: ${today()} · Poslova: ${filteredJobs.length}</span>
</div>
<div class="stats">
  <div class="stat"><div class="stat-label">Ukupno fakturisano</div><div class="stat-value">${formatMoney(totalRevenue)}</div></div>
  <div class="stat"><div class="stat-label">Ukupno naplaćeno</div><div class="stat-value">${formatMoney(totalPaid)}</div></div>
  <div class="stat"><div class="stat-label">Preostalo za naplatu</div><div class="stat-value" style="color:#dc2626">${formatMoney(totalUnpaid)}</div></div>
  <div class="stat"><div class="stat-label">Stopa naplate</div><div class="stat-value">${collectionRate}%</div></div>
</div>
<table>
  <thead><tr>
    <th>Posao #</th><th>Kupac</th><th>Status</th><th>Fakturisano</th><th>Avans</th><th>Neplaćeno</th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<div class="footer">Generisano iz CRM sistema · ${today()}</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); }, 500);
  }
}
