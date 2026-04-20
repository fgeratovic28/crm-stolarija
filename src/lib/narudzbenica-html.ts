import QRCode from "qrcode";
import { formatCurrencyBySettings, formatDateBySettings } from "@/lib/app-settings";
import { labelMaterialType } from "@/lib/activity-labels";
import { buildPublicNarudzbenicaUrl } from "@/lib/public-narudzbenica-url";
import { normalizeOrderLines } from "@/lib/material-order-lines";
import type { Job, MaterialOrder, MaterialOrderLine } from "@/types";

const TABLE_BODY_ROWS = 16;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(value: string | undefined): string {
  if (!value || String(value).trim() === "") return "—";
  return formatDateBySettings(value);
}

function fmtMoney(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "—";
  return formatCurrencyBySettings(Number(value));
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatQty(q: number): string {
  const n = Math.round(q * 10000) / 10000;
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function issuerCompanyLines(): string[] {
  const name = import.meta.env.VITE_COMPANY_NAME?.trim() || "Stolarija Kovačević d.o.o.";
  const addr = import.meta.env.VITE_COMPANY_ADDRESS?.trim() || "";
  const oib = import.meta.env.VITE_COMPANY_OIB?.trim() || "";
  return [name, addr || "—", oib ? `OIB: ${oib}` : "OIB: —"];
}

/** Ukupan neto iznos (bez PDV-a); PDV na ceo dokument preko jedne stope. */
function computeVatTotals(totalNet: number, vatPct: number): { lineNet: number; vatAmt: number; gross: number } {
  const lineNet = roundMoney(totalNet);
  const vatAmt = roundMoney(lineNet * (vatPct / 100));
  const gross = roundMoney(lineNet + vatAmt);
  return { lineNet, vatAmt, gross };
}

export type NarudzbenicaTableRow = {
  num: number;
  itemName: string;
  unit: string;
  quantity: string;
  unitPriceNet: string;
  lineNet: string;
};

export type NarudzbenicaParts = {
  companyLines: string[];
  buyerName: string;
  buyerAddress: string;
  buyerPhone: string;
  buyerTaxId: string;
  supplierName: string;
  supplierBlock: string;
  docNumber: string;
  orderDate: string;
  ourRef: string;
  bankLine: string;
  deliveryWhere: string;
  deliveryWhen: string;
  shippingMethod: string;
  legalReference: string;
  tableRows: NarudzbenicaTableRow[];
  lineNetTotal: string;
  vatRatePct: string;
  vatAmount: string;
  grandTotal: string;
  paymentTerms: string;
  paymentDueLine: string;
  notes: string;
  footerStatus: string;
  publicViewUrl: string;
};

function buildTableRows(lines: MaterialOrderLine[]): NarudzbenicaTableRow[] {
  if (lines.length === 0) {
    return [
      {
        num: 1,
        itemName: "—",
        unit: "kom",
        quantity: "1",
        unitPriceNet: fmtMoney(0),
        lineNet: fmtMoney(0),
      },
    ];
  }
  return lines.map((l, i) => {
    const qty = Math.max(0.0001, l.quantity);
    const unitPrice = qty > 0 ? l.lineNet / qty : l.lineNet;
    return {
      num: i + 1,
      itemName: l.description,
      unit: l.unit,
      quantity: formatQty(l.quantity),
      unitPriceNet: fmtMoney(unitPrice),
      lineNet: fmtMoney(l.lineNet),
    };
  });
}

export function materialOrderToNarudzbenicaParts(order: MaterialOrder, job: Job | null): NarudzbenicaParts {
  const lines = normalizeOrderLines(order);
  const totalNet =
    lines.length > 0
      ? roundMoney(lines.reduce((s, l) => s + Number(l.lineNet || 0), 0))
      : roundMoney(Number(order.price ?? order.supplierPrice ?? 0));
  const vatPct = Number(order.nbVatRatePercent ?? 20);
  const { lineNet, vatAmt, gross } = computeVatTotals(totalNet, vatPct);

  const buyerName = job?.customer.fullName ?? "—";
  const buyerAddr =
    order.nbDeliveryAddressOverride?.trim() ||
    job?.customer.installationAddress ||
    job?.jobInstallationAddress ||
    job?.customer.billingAddress ||
    "—";
  const buyerPhone = job?.customer.phones?.[0]?.trim() || job?.customerPhone?.trim() || "—";
  const buyerTaxId = job?.customer.pib?.trim() ? `PIB: ${job.customer.pib}` : "PIB: —";

  const docId = order.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const docNumber = docId || "—";
  const token = order.publicShareToken ?? "";
  const publicViewUrl = token ? buildPublicNarudzbenicaUrl(token) : "";

  const bankLine = order.nbBuyerBankAccount?.trim()
    ? `Žiro račun naručioca: ${order.nbBuyerBankAccount}`
    : "Žiro račun naručioca: —";

  const ship = order.nbShippingMethod?.trim() || "—";
  const payDue = order.nbPaymentDueDate ? fmtDate(order.nbPaymentDueDate) : "—";
  const payNote = order.nbPaymentNote?.trim();
  const legal = order.nbLegalReference?.trim();

  let paymentTerms = "";
  if (order.paid) {
    paymentTerms = "Plaćanje: izvršeno prema evidenciji u CRM-u.";
  } else if (payNote) {
    paymentTerms = payNote;
  } else {
    paymentTerms = `Rok plaćanja: ${payDue}. Način: dogovor ili avans prema ponudi.`;
  }

  return {
    companyLines: issuerCompanyLines(),
    buyerName,
    buyerAddress: buyerAddr,
    buyerPhone,
    buyerTaxId,
    supplierName: "",
    supplierBlock: "",
    docNumber,
    orderDate: fmtDate(order.requestDate || order.orderDate),
    ourRef: docNumber,
    bankLine,
    deliveryWhere: buyerAddr,
    deliveryWhen: fmtDate(order.expectedDelivery),
    shippingMethod: ship,
    legalReference: legal || "",
    tableRows: buildTableRows(lines),
    lineNetTotal: fmtMoney(lineNet),
    vatRatePct: String(vatPct),
    vatAmount: fmtMoney(vatAmt),
    grandTotal: fmtMoney(gross),
    paymentTerms,
    paymentDueLine: payDue,
    notes: order.notes?.trim() ? order.notes : "—",
    footerStatus: `Štampano: ${formatDateBySettings(new Date())}.`,
    publicViewUrl,
  };
}

function linesFromPublicRpcRow(row: Record<string, unknown>): MaterialOrderLine[] {
  const raw = row.nbLines;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((item) => {
      const o = item as Record<string, unknown>;
      return {
        description: String(o.description ?? "").trim() || "—",
        quantity: Math.max(0.0001, Number(o.quantity) || 1),
        unit: String(o.unit ?? "kom"),
        lineNet: roundMoney(Number(o.lineNet ?? o.line_net ?? 0)),
      };
    });
  }
  const price = Number(row.price ?? 0);
  const qty = Math.max(0.0001, Number(row.nbQuantity ?? 1));
  const materialLabel = labelMaterialType(String(row.materialType ?? "other"));
  const itemName =
    (row.nbLineDescription && String(row.nbLineDescription).trim()) ||
    materialLabel + (row.barcode ? ` (ref. ${String(row.barcode)})` : "");
  return [
    {
      description: itemName,
      quantity: qty,
      unit: row.nbUnit ? String(row.nbUnit) : "kom",
      lineNet: roundMoney(price),
    },
  ];
}

function paddedTableBodyHtml(tableRows: NarudzbenicaTableRow[]): string {
  const dataRows = tableRows.map(
    (r) => `<tr>
    <td class="nb-c-num">${r.num}</td>
    <td>${escapeHtml(r.itemName)}</td>
    <td class="nb-c-jm">${escapeHtml(r.unit)}</td>
    <td class="nb-c-q">${escapeHtml(r.quantity)}</td>
    <td class="nb-c-p">${escapeHtml(r.unitPriceNet)}</td>
    <td class="nb-c-a">${escapeHtml(r.lineNet)}</td>
  </tr>`,
  );
  const empty = `<tr><td class="nb-c-num">&nbsp;</td><td>&nbsp;</td><td class="nb-c-jm">&nbsp;</td><td class="nb-c-q">&nbsp;</td><td class="nb-c-p">&nbsp;</td><td class="nb-c-a">&nbsp;</td></tr>`;
  while (dataRows.length < TABLE_BODY_ROWS) dataRows.push(empty);
  return dataRows.join("");
}

export async function buildNarudzbenicaDocumentHtml(order: MaterialOrder, job: Job | null): Promise<string> {
  const p = materialOrderToNarudzbenicaParts(order, job);
  return buildNarudzbenicaHtmlFromParts(p);
}

/** Podaci iz RPC `get_public_narudzbenica`. */
export function narudzbenicaPartsFromPublicRpc(row: Record<string, unknown>): NarudzbenicaParts {
  const lines = linesFromPublicRpcRow(row);
  const totalNet = roundMoney(lines.reduce((s, l) => s + l.lineNet, 0));
  const vatPct = Number(row.nbVatRatePercent ?? 20);
  const { lineNet, vatAmt, gross } = computeVatTotals(totalNet, vatPct);

  const token = String(row.publicShareToken ?? "");
  const publicViewUrl = token ? buildPublicNarudzbenicaUrl(token) : "";
  const rawId = String(row.id ?? "");
  const docNumber = rawId.replace(/-/g, "").slice(0, 8).toUpperCase() || "—";

  const buyerName = String(row.customerName || "—");
  const override = row.nbDeliveryAddressOverride ? String(row.nbDeliveryAddressOverride) : "";
  const buyerAddr = override.trim() || String(row.installationAddress || row.billingAddress || "—");
  const buyerPhone = String(row.customerPhone || "—");
  const pib = row.customerPib ? String(row.customerPib) : "";
  const buyerTaxId = pib.trim() ? `PIB: ${pib}` : "PIB: —";

  const bankLine = row.nbBuyerBankAccount
    ? `Žiro račun naručioca: ${String(row.nbBuyerBankAccount)}`
    : "Žiro račun naručioca: —";

  const ship = row.nbShippingMethod ? String(row.nbShippingMethod) : "—";
  const payDue = row.nbPaymentDueDate ? fmtDate(String(row.nbPaymentDueDate)) : "—";
  const payNote = row.nbPaymentNote ? String(row.nbPaymentNote) : "";
  const legal = row.nbLegalReference ? String(row.nbLegalReference) : "";

  let paymentTerms = "";
  if (row.paid === true) {
    paymentTerms = "Plaćanje: izvršeno prema evidenciji.";
  } else if (payNote.trim()) {
    paymentTerms = payNote;
  } else {
    paymentTerms = `Rok plaćanja: ${payDue}.`;
  }

  return {
    companyLines: issuerCompanyLines(),
    buyerName,
    buyerAddress: buyerAddr,
    buyerPhone,
    buyerTaxId,
    supplierName: "",
    supplierBlock: "",
    docNumber,
    orderDate: fmtDate(row.requestDate as string | undefined),
    ourRef: docNumber,
    bankLine,
    deliveryWhere: buyerAddr,
    deliveryWhen: fmtDate(row.expectedDelivery as string | undefined),
    shippingMethod: ship,
    legalReference: legal,
    tableRows: buildTableRows(lines),
    lineNetTotal: fmtMoney(lineNet),
    vatRatePct: String(vatPct),
    vatAmount: fmtMoney(vatAmt),
    grandTotal: fmtMoney(gross),
    paymentTerms,
    paymentDueLine: payDue,
    notes: row.notes && String(row.notes).trim() ? String(row.notes) : "—",
    footerStatus: `Javni pregled · ${formatDateBySettings(new Date())}.`,
    publicViewUrl,
  };
}

export async function buildNarudzbenicaHtmlFromParts(p: NarudzbenicaParts): Promise<string> {
  let qrBlock = "";
  if (p.publicViewUrl) {
    try {
      const qrDataUrl = await QRCode.toDataURL(p.publicViewUrl, {
        width: 200,
        margin: 0,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" },
      });
      const safeSrc = qrDataUrl.replace(/"/g, "&quot;");
      qrBlock = `<div class="nb-qr"><img src="${safeSrc}" alt="" width="88" height="88" decoding="async" /></div>`;
    } catch {
      qrBlock = "";
    }
  }

  const letterhead = `<p style="margin:0 0 4px;font-size:10pt;font-weight:700;text-align:center">${escapeHtml(p.companyLines[0] ?? "")}</p>
    <p style="margin:0 0 8px;font-size:9pt;text-align:center;line-height:1.35">${escapeHtml(p.companyLines[1] ?? "")}<br/>${escapeHtml(p.companyLines[2] ?? "")}</p>`;

  const legalBlock = p.legalReference
    ? `<div class="nb-line" style="margin-bottom:6px;font-size:9pt"><strong>Na temelju:</strong> ${escapeHtml(p.legalReference)}</div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Narudžbenica ${escapeHtml(p.docNumber)}</title>
<style>${NARUDZBENICA_CSS}</style></head><body>
<div class="nb-wrap">
  ${letterhead}
  <div class="nb-top">
    <div class="nb-co" style="flex:1.35">
      <h2>Kupac (primatelj)</h2>
      <p><strong>${escapeHtml(p.buyerName)}</strong></p>
      <p>${escapeHtml(p.buyerAddress)}</p>
      <p>Tel.: ${escapeHtml(p.buyerPhone)}</p>
      <p>${escapeHtml(p.buyerTaxId)}</p>
    </div>
    ${qrBlock}
  </div>

  <div class="nb-title-row">
    <h1 class="nb-title">NARUDŽBENICA br. ${escapeHtml(p.docNumber)}</h1>
    <div class="nb-meta"><strong>Nadnevak:</strong> ${escapeHtml(p.orderDate)}<br/><strong>Naš znak i broj:</strong> ${escapeHtml(p.ourRef)}</div>
  </div>
  ${legalBlock}

  <div class="nb-line"><strong>${escapeHtml(p.bankLine)}</strong></div>

  <div class="nb-sub2">
    <div class="nb-box"><strong>Naručena dobra — isporuka na adresu</strong>${escapeHtml(p.deliveryWhere)}</div>
    <div class="nb-box"><strong>Rok isporuke</strong>${escapeHtml(p.deliveryWhen)}</div>
    <div class="nb-box"><strong>Način otpreme</strong>${escapeHtml(p.shippingMethod)}</div>
  </div>

  <p class="nb-order-label">NARUČUJEMO:</p>
  <table class="nb-t" aria-label="Stavke narudžbenice">
    <thead>
      <tr>
        <th class="nb-c-num">R.br.</th>
        <th>Trgovački naziv dobra — usluge</th>
        <th class="nb-c-jm">Jed. mj.</th>
        <th class="nb-c-q">Količina</th>
        <th class="nb-c-p">Cijena (bez PDV-a)</th>
        <th class="nb-c-a">Iznos (bez PDV-a)</th>
      </tr>
    </thead>
    <tbody>
      ${paddedTableBodyHtml(p.tableRows)}
    </tbody>
  </table>

  <div class="nb-foot">
    <div class="nb-pay">
      <strong>Uslovi plaćanja</strong><br/>
      ${escapeHtml(p.paymentTerms)}<br/>
      <span style="font-size:8.5pt">Rok plaćanja (datum): <strong>${escapeHtml(p.paymentDueLine)}</strong></span><br/><br/>
      <em style="font-size:8pt">${escapeHtml(p.footerStatus)}</em>
    </div>
    <div class="nb-sum">
      <table>
        <tr><td>UKUPNO (bez PDV-a)</td><td>${escapeHtml(p.lineNetTotal)}</td></tr>
        <tr><td>PDV (${escapeHtml(p.vatRatePct)}%)</td><td>${escapeHtml(p.vatAmount)}</td></tr>
        <tr><td><strong>SVEUKUPNO (sa PDV)</strong></td><td><strong>${escapeHtml(p.grandTotal)}</strong></td></tr>
      </table>
    </div>
  </div>

  <div class="nb-pay" style="margin-top:8px"><strong>Napomena</strong><br/>${escapeHtml(p.notes)}</div>

  <div class="nb-sign">
    <div>
      <div class="line">M.P. / pečat naručioca</div>
    </div>
    <div>
      <div class="line">Potpis ovlaštene osobe</div>
    </div>
  </div>

  <p class="nb-small">Interni dokument · ${escapeHtml(p.companyLines[0] ?? "CRM")} · CRM-NAR</p>
</div>
</body></html>`;
}

export const NARUDZBENICA_CSS = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 8px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    color: #000;
    background: #fff;
  }
  .nb-wrap { max-width: 190mm; margin: 0 auto; }
  .nb-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  .nb-co { flex: 1; border: 1px solid #000; padding: 6px 8px; min-height: 52px; }
  .nb-co h2 { margin: 0 0 4px 0; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; }
  .nb-co p { margin: 2px 0; font-size: 9pt; line-height: 1.35; }
  .nb-qr { flex-shrink: 0; margin: 0; padding: 0; border: none; line-height: 0; }
  .nb-qr img { width: 88px; height: 88px; display: block; margin: 0; vertical-align: top; }
  .nb-title-row { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 8px; margin: 10px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #000; }
  .nb-title { font-size: 14pt; font-weight: 700; letter-spacing: 0.04em; margin: 0; }
  .nb-meta { font-size: 9pt; text-align: right; }
  .nb-line { border: 1px solid #000; padding: 5px 8px; margin-bottom: 6px; font-size: 9pt; }
  .nb-line strong { display: inline-block; min-width: 140px; font-size: 8pt; text-transform: uppercase; }
  .nb-sub2 { display: grid; grid-template-columns: 1fr 120px 120px; gap: 6px; margin-bottom: 6px; }
  .nb-box { border: 1px solid #000; padding: 5px 6px; font-size: 8.5pt; min-height: 36px; }
  .nb-box strong { display: block; font-size: 7.5pt; margin-bottom: 3px; text-transform: uppercase; }
  .nb-order-label { font-weight: 700; margin: 8px 0 4px; font-size: 9.5pt; }
  table.nb-t { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 10px; }
  table.nb-t th, table.nb-t td { border: 1px solid #000; padding: 4px 5px; vertical-align: top; }
  table.nb-t th { background: #f5f5f5; font-weight: 700; text-align: center; font-size: 7.5pt; text-transform: uppercase; }
  td.nb-c-num { width: 28px; text-align: center; }
  td.nb-c-jm { width: 44px; text-align: center; }
  td.nb-c-q { width: 48px; text-align: right; }
  td.nb-c-p { width: 72px; text-align: right; }
  td.nb-c-a { width: 78px; text-align: right; }
  .nb-foot { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; font-size: 8.5pt; }
  .nb-pay { border: 1px solid #000; padding: 6px; min-height: 56px; }
  .nb-sum { border: 1px solid #000; padding: 6px; text-align: right; }
  .nb-sum table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .nb-sum td { padding: 2px 4px; border: none; }
  .nb-sum td:first-child { text-align: left; font-weight: 600; }
  .nb-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; font-size: 8.5pt; }
  .nb-sign .line { border-top: 1px solid #000; margin-top: 32px; padding-top: 3px; text-align: center; }
  .nb-small { font-size: 7.5pt; color: #333; margin-top: 10px; text-align: center; }
`;
