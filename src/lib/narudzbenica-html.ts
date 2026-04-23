import QRCode from "qrcode";
import { formatCurrencyBySettings, formatDateBySettings, readAppSettingsCache } from "@/lib/app-settings";
import { labelMaterialType } from "@/lib/activity-labels";
import { memorandumImageUrlForDocument } from "@/lib/pdf-memorandum";
import { buildPublicNarudzbenicaUrl } from "@/lib/public-narudzbenica-url";
import { normalizeOrderLines } from "@/lib/material-order-lines";
import type { MaterialOrder, MaterialOrderLine, MaterialType } from "@/types";

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

function pickIssuerStr(v: unknown): string {
  return v != null && String(v).trim() ? String(v).trim() : "";
}

function issuerCompanyLines(overlay?: Record<string, unknown>): string[] {
  const s = readAppSettingsCache();
  const name =
    pickIssuerStr(overlay?.issuerCompanyName) || s.companyName.trim() || "Stolarija Kovačević d.o.o.";
  const addr = pickIssuerStr(overlay?.issuerCompanyAddress) || s.companyAddress.trim() || "—";
  const pib = pickIssuerStr(overlay?.issuerCompanyPib) || s.companyPib.trim();
  const mb = pickIssuerStr(overlay?.issuerCompanyMb) || s.companyMb.trim();
  const taxLine = pib ? `PIB: ${pib}` : "PIB: —";
  if (mb) return [name, addr, taxLine, `MB: ${mb}`];
  return [name, addr, taxLine];
}

/** Kupac (naručilac) — iz Podešavanja; `overlay` koristi javni RPC (isti podaci iz baze). */
function issuerBuyerForNarudzbenica(overlay?: Record<string, unknown>): {
  buyerName: string;
  buyerAddress: string;
  buyerPhone: string;
  buyerTaxId: string;
} {
  const s = readAppSettingsCache();
  const name =
    pickIssuerStr(overlay?.issuerCompanyName) || s.companyName.trim() || "Stolarija Kovačević d.o.o.";
  const addr = pickIssuerStr(overlay?.issuerCompanyAddress) || s.companyAddress.trim() || "—";
  const phone = pickIssuerStr(overlay?.issuerCompanyPhone) || s.companyPhone.trim() || "—";
  const pib = pickIssuerStr(overlay?.issuerCompanyPib) || s.companyPib.trim();
  return {
    buyerName: name,
    buyerAddress: addr,
    buyerPhone: phone,
    buyerTaxId: pib ? `PIB: ${pib}` : "PIB: —",
  };
}

/** Žiro naručioca — Podešavanja → Firma; javni link iz RPC; inače snapshot sa narudžbine. */
function issuerBankLineForNarudzbenica(fallbackFromOrder?: string, overlay?: Record<string, unknown>): string {
  const fromRpc = pickIssuerStr(overlay?.issuerCompanyBankAccount);
  if (fromRpc) return `Žiro račun naručioca: ${fromRpc}`;
  const fromSettings = readAppSettingsCache().companyBankAccount?.trim();
  if (fromSettings) return `Žiro račun naručioca: ${fromSettings}`;
  const fb = fallbackFromOrder?.trim();
  if (fb) return `Žiro račun naručioca: ${fb}`;
  return "Žiro račun naručioca: —";
}

function buildSupplierNarudzbenicaBlock(order: MaterialOrder): string {
  const lines: string[] = [];
  const addr = order.supplierAddress?.trim();
  if (addr) lines.push(addr);
  const contact = order.supplierContact?.trim();
  if (contact) lines.push(`Kontakt: ${contact}`);
  const ph = order.supplierPhone?.trim();
  if (ph) lines.push(`Tel.: ${ph}`);
  const em = order.supplierEmail?.trim();
  if (em) lines.push(`E-mail: ${em}`);
  const bank = order.supplierBankAccount?.trim();
  if (bank) lines.push(`Žiro / tekući račun: ${bank}`);
  const pib = order.supplierPib?.trim();
  if (pib) lines.push(`PIB: ${pib}`);
  return lines.length > 0 ? lines.join("\n") : "—";
}

function buildSupplierNarudzbenicaBlockFromPublicRow(row: Record<string, unknown>): string {
  const lines: string[] = [];
  const addr = row.supplierAddress != null ? String(row.supplierAddress).trim() : "";
  if (addr) lines.push(addr);
  const contact = row.supplierContact != null ? String(row.supplierContact).trim() : "";
  if (contact) lines.push(`Kontakt: ${contact}`);
  const ph = row.supplierPhone != null ? String(row.supplierPhone).trim() : "";
  if (ph) lines.push(`Tel.: ${ph}`);
  const em = row.supplierEmail != null ? String(row.supplierEmail).trim() : "";
  if (em) lines.push(`E-mail: ${em}`);
  const bank = row.supplierBankAccount != null ? String(row.supplierBankAccount).trim() : "";
  if (bank) lines.push(`Žiro / tekući račun: ${bank}`);
  const pib = row.supplierPib != null ? String(row.supplierPib).trim() : "";
  if (pib) lines.push(`PIB: ${pib}`);
  return lines.length > 0 ? lines.join("\n") : "—";
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

/**
 * U koloni „Trgovački naziv“ za profile: bez vodeće šifre u formatu `ŠIFRA - naziv…`
 * (šifra = prvi segment bez razmaka, tipičan za krojnu listu).
 */
function narudzbenicaTradeNameFromDescription(
  raw: string,
  lineMaterialType: MaterialType | undefined,
  orderMaterialType: MaterialType | undefined,
): string {
  const s = raw.trim();
  if (!s) return s;
  const effective = lineMaterialType ?? orderMaterialType;
  if (effective !== "profile") return s;
  const idx = s.indexOf(" - ");
  if (idx <= 0) return s;
  const head = s.slice(0, idx).trim();
  const tail = s.slice(idx + 3).trim();
  if (!tail) return s;
  const codeLike = /^[\w.-]+$/.test(head) && head.length <= 64;
  return codeLike ? tail : s;
}

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

function buildTableRows(
  lines: MaterialOrderLine[],
  orderMaterialType?: MaterialType,
): NarudzbenicaTableRow[] {
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
      itemName: narudzbenicaTradeNameFromDescription(l.description, l.materialType, orderMaterialType),
      unit: l.unit,
      quantity: formatQty(l.quantity),
      unitPriceNet: fmtMoney(unitPrice),
      lineNet: fmtMoney(l.lineNet),
    };
  });
}

export function materialOrderToNarudzbenicaParts(order: MaterialOrder): NarudzbenicaParts {
  const lines = normalizeOrderLines(order);
  const totalNet =
    lines.length > 0
      ? roundMoney(lines.reduce((s, l) => s + Number(l.lineNet || 0), 0))
      : roundMoney(Number(order.price ?? order.supplierPrice ?? 0));
  const vatPct = Number(order.nbVatRatePercent ?? 20);
  const { lineNet, vatAmt, gross } = computeVatTotals(totalNet, vatPct);

  const buyer = issuerBuyerForNarudzbenica();
  const buyerName = buyer.buyerName;
  const buyerAddr = buyer.buyerAddress;
  const buyerPhone = buyer.buyerPhone;
  const buyerTaxId = buyer.buyerTaxId;
  const deliveryAddr =
    order.nbDeliveryAddressOverride?.trim() || buyer.buyerAddress;

  const docId = order.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const docNumber = docId || "—";
  const token = order.publicShareToken ?? "";
  const publicViewUrl = token ? buildPublicNarudzbenicaUrl(token) : "";

  const bankLine = issuerBankLineForNarudzbenica(order.nbBuyerBankAccount);

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

  const supplierName = order.supplier?.trim() || "—";
  const supplierBlock = buildSupplierNarudzbenicaBlock(order);

  return {
    companyLines: issuerCompanyLines(),
    buyerName,
    buyerAddress: buyerAddr,
    buyerPhone,
    buyerTaxId,
    supplierName,
    supplierBlock,
    docNumber,
    orderDate: fmtDate(order.requestDate || order.orderDate),
    ourRef: docNumber,
    bankLine,
    deliveryWhere: deliveryAddr,
    deliveryWhen: fmtDate(order.expectedDelivery),
    shippingMethod: ship,
    legalReference: legal || "",
    tableRows: buildTableRows(lines, order.materialType),
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
  const orderMt = row.materialType as MaterialType | undefined;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((item) => {
      const o = item as Record<string, unknown>;
      const lineMt = (o.materialType as MaterialType | undefined) ?? orderMt;
      return {
        description: String(o.description ?? "").trim() || "—",
        quantity: Math.max(0.0001, Number(o.quantity) || 1),
        unit: String(o.unit ?? "kom"),
        lineNet: roundMoney(Number(o.lineNet ?? o.line_net ?? 0)),
        ...(lineMt ? { materialType: lineMt } : {}),
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
      ...(orderMt ? { materialType: orderMt } : {}),
    },
  ];
}

function paddedTableBodyHtml(tableRows: NarudzbenicaTableRow[]): string {
  const dataRows = tableRows.map(
    (r) => `<tr>
    <td class="nb-c-num">${r.num}</td>
    <td class="nb-c-desc">${escapeHtml(r.itemName)}</td>
    <td class="nb-c-jm">${escapeHtml(r.unit)}</td>
    <td class="nb-c-q">${escapeHtml(r.quantity)}</td>
    <td class="nb-c-p">${escapeHtml(r.unitPriceNet)}</td>
    <td class="nb-c-a">${escapeHtml(r.lineNet)}</td>
  </tr>`,
  );
  const empty = `<tr><td class="nb-c-num">&nbsp;</td><td class="nb-c-desc">&nbsp;</td><td class="nb-c-jm">&nbsp;</td><td class="nb-c-q">&nbsp;</td><td class="nb-c-p">&nbsp;</td><td class="nb-c-a">&nbsp;</td></tr>`;
  while (dataRows.length < TABLE_BODY_ROWS) dataRows.push(empty);
  return dataRows.join("");
}

export async function buildNarudzbenicaDocumentHtml(order: MaterialOrder): Promise<string> {
  const p = materialOrderToNarudzbenicaParts(order);
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

  const buyer = issuerBuyerForNarudzbenica(row);
  const buyerName = buyer.buyerName;
  const buyerAddr = buyer.buyerAddress;
  const buyerPhone = buyer.buyerPhone;
  const buyerTaxId = buyer.buyerTaxId;
  const override = row.nbDeliveryAddressOverride ? String(row.nbDeliveryAddressOverride) : "";
  const deliveryAddr = override.trim() || buyer.buyerAddress;

  const bankLine = issuerBankLineForNarudzbenica(
    row.nbBuyerBankAccount != null ? String(row.nbBuyerBankAccount) : undefined,
    row,
  );

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

  const supplierName = String(row.supplier || "—").trim() || "—";
  const supplierBlock = buildSupplierNarudzbenicaBlockFromPublicRow(row);

  return {
    companyLines: issuerCompanyLines(row),
    buyerName,
    buyerAddress: buyerAddr,
    buyerPhone,
    buyerTaxId,
    supplierName,
    supplierBlock,
    docNumber,
    orderDate: fmtDate(row.requestDate as string | undefined),
    ourRef: docNumber,
    bankLine,
    deliveryWhere: deliveryAddr,
    deliveryWhen: fmtDate(row.expectedDelivery as string | undefined),
    shippingMethod: ship,
    legalReference: legal,
    tableRows: buildTableRows(lines, row.materialType as MaterialType | undefined),
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

  const memSrc = memorandumImageUrlForDocument();
  const memorandumBlock = `<div class="nb-memorandum"><img src="${escapeHtml(memSrc)}" alt="" width="1088" height="288" decoding="sync" fetchpriority="high" /></div>`;

  const legalBlock = p.legalReference
    ? `<div class="nb-line nb-line-legal"><strong>Na temelju:</strong> ${escapeHtml(p.legalReference)}</div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Narudžbenica ${escapeHtml(p.docNumber)}</title>
<style>${NARUDZBENICA_CSS}</style></head><body>
<div class="nb-wrap">
  <div class="nb-head-grid">
    <div class="nb-memorandum-cell">${memorandumBlock}</div>
    <div class="nb-supplier-cell">
      <div class="nb-co nb-supplier">
        <h2>Dobavljač</h2>
        <p><strong>${escapeHtml(p.supplierName)}</strong></p>
        <p class="nb-pre">${escapeHtml(p.supplierBlock)}</p>
      </div>
    </div>
    <div class="nb-buyer-cell">
      <div class="nb-buyer-qr">
        <div class="nb-co nb-buyer">
          <h2>Kupac (naručilac)</h2>
          <p><strong>${escapeHtml(p.buyerName)}</strong></p>
          <p>${escapeHtml(p.buyerAddress)}</p>
          <p>Tel.: ${escapeHtml(p.buyerPhone)}</p>
          <p>${escapeHtml(p.buyerTaxId)}</p>
        </div>
        ${qrBlock}
      </div>
    </div>
  </div>

  <div class="nb-title-row">
    <h1 class="nb-title">NARUDŽBENICA br. ${escapeHtml(p.docNumber)}</h1>
    <div class="nb-meta-wrap">
      <div class="nb-meta-lines">
        <div class="nb-meta-line"><strong>Nadnevak:</strong> ${escapeHtml(p.orderDate)}</div>
        <div class="nb-meta-line"><strong>Naš znak i broj:</strong> ${escapeHtml(p.ourRef)}</div>
      </div>
    </div>
  </div>
  ${legalBlock}

  <div class="nb-line nb-line-bank"><strong>${escapeHtml(p.bankLine)}</strong></div>

  <div class="nb-sub2">
    <div class="nb-box"><strong>Naručena dobra — isporuka na adresu</strong><span class="nb-box-body">${escapeHtml(p.deliveryWhere)}</span></div>
    <div class="nb-box"><strong>Rok isporuke</strong><span class="nb-box-body">${escapeHtml(p.deliveryWhen)}</span></div>
    <div class="nb-box"><strong>Način otpreme</strong><span class="nb-box-body">${escapeHtml(p.shippingMethod)}</span></div>
  </div>

  <p class="nb-order-label">NARUČUJEMO:</p>
  <table class="nb-t" aria-label="Stavke narudžbenice">
    <thead>
      <tr>
        <th class="nb-c-num">R.br.</th>
        <th class="nb-c-desc">Trgovački naziv dobra — usluge</th>
        <th class="nb-c-jm">Jed. mj.</th>
        <th class="nb-c-q">Količina</th>
        <th class="nb-c-p">Cena (bez PDV-a)</th>
        <th class="nb-c-a">Iznos (bez PDV-a)</th>
      </tr>
    </thead>
    <tbody>
      ${paddedTableBodyHtml(p.tableRows)}
    </tbody>
  </table>

  <div class="nb-foot">
    <div class="nb-pay">
      <strong>Uslovi plaćanja</strong>
      <p class="nb-pay-body">${escapeHtml(p.paymentTerms)}</p>
      <p class="nb-pay-due">Rok plaćanja (datum): <strong>${escapeHtml(p.paymentDueLine)}</strong></p>
      <p class="nb-pay-footer"><em>${escapeHtml(p.footerStatus)}</em></p>
    </div>
    <div class="nb-sum">
      <table>
        <tr><td>UKUPNO (bez PDV-a)</td><td>${escapeHtml(p.lineNetTotal)}</td></tr>
        <tr><td>PDV (${escapeHtml(p.vatRatePct)}%)</td><td>${escapeHtml(p.vatAmount)}</td></tr>
        <tr><td><strong>SVEUKUPNO (sa PDV)</strong></td><td><strong>${escapeHtml(p.grandTotal)}</strong></td></tr>
      </table>
    </div>
  </div>

  <div class="nb-pay nb-pay-notes"><strong>Napomena</strong><p class="nb-pay-body">${escapeHtml(p.notes)}</p></div>

  <div class="nb-sign">
    <div>
      <div class="line">M.P. / pečat naručioca</div>
    </div>
    <div>
      <div class="line">Potpis ovlaštene osobe</div>
    </div>
  </div>
</div>
</body></html>`;
}

export const NARUDZBENICA_CSS = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 10px 12px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    line-height: 1.45;
    color: #000;
    background: #fff;
  }
  .nb-wrap { max-width: 190mm; margin: 0 auto; }
  .nb-head-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    column-gap: 14px;
    row-gap: 12px;
    align-items: start;
    margin-bottom: 14px;
  }
  .nb-memorandum-cell { grid-column: 1; grid-row: 1; min-width: 0; }
  .nb-supplier-cell { grid-column: 1; grid-row: 2; min-width: 0; align-self: stretch; }
  .nb-buyer-cell { grid-column: 2; grid-row: 2; min-width: 0; align-self: stretch; display: flex; flex-direction: column; }
  .nb-memorandum { margin: 0; padding: 0; text-align: center; line-height: 0; }
  .nb-memorandum img {
    display: block;
    width: auto;
    max-width: min(420px, 100%);
    height: auto;
    margin: 0 auto;
    object-fit: contain;
    object-position: center center;
    image-rendering: auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media print {
    .nb-memorandum img {
      max-width: 92mm;
      width: auto;
      margin-left: auto;
      margin-right: auto;
    }
  }
  .nb-buyer-qr {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
    flex: 1;
    min-height: 100%;
  }
  .nb-buyer-qr .nb-co { flex: 1; min-width: 0; }
  .nb-pre { white-space: pre-line; margin: 6px 0 0; font-size: 9pt; line-height: 1.5; }
  .nb-co { flex: 1; border: 1px solid #000; padding: 9px 11px; min-height: 56px; }
  .nb-co h2 { margin: 0 0 6px 0; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; }
  .nb-co p { margin: 4px 0; font-size: 9pt; line-height: 1.45; }
  .nb-qr { flex-shrink: 0; margin: 0; padding: 0; border: none; line-height: 0; }
  .nb-qr img { width: 88px; height: 88px; display: block; margin: 0; vertical-align: top; }
  .nb-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 12px 16px;
    margin: 12px 0 10px;
    padding-bottom: 10px;
    border-bottom: 2px solid #000;
  }
  .nb-title { font-size: 14pt; font-weight: 700; letter-spacing: 0.04em; margin: 0; line-height: 1.25; }
  .nb-meta-wrap { text-align: right; max-width: 100%; flex: 1; min-width: 200px; }
  .nb-meta-lines { font-size: 9pt; line-height: 1.55; }
  .nb-meta-line { margin: 3px 0; }
  .nb-line { border: 1px solid #000; padding: 8px 11px; margin-bottom: 10px; font-size: 9pt; line-height: 1.45; }
  .nb-line-legal { margin-bottom: 10px; }
  .nb-line-bank { margin-bottom: 12px; }
  .nb-line strong { display: inline-block; min-width: 140px; font-size: 8pt; text-transform: uppercase; }
  .nb-sub2 { display: grid; grid-template-columns: 1fr 120px 120px; gap: 10px; margin-bottom: 12px; }
  .nb-box { border: 1px solid #000; padding: 8px 10px; font-size: 8.5pt; min-height: 42px; line-height: 1.45; }
  .nb-box strong { display: block; font-size: 7.5pt; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.02em; }
  .nb-box-body { display: block; margin-top: 2px; white-space: pre-line; }
  .nb-order-label { font-weight: 700; margin: 12px 0 8px; font-size: 9.5pt; letter-spacing: 0.02em; }
  table.nb-t {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
    margin-bottom: 14px;
    line-height: 1.4;
    table-layout: fixed;
  }
  table.nb-t th, table.nb-t td { border: 1px solid #000; padding: 6px 7px; vertical-align: top; }
  table.nb-t .nb-c-desc {
    word-break: break-word;
    overflow-wrap: anywhere;
    hyphens: auto;
    min-width: 0;
  }
  table.nb-t th { background: #f5f5f5; font-weight: 700; text-align: center; font-size: 7.5pt; text-transform: uppercase; padding: 7px 6px; }
  td.nb-c-num { width: 28px; text-align: center; }
  td.nb-c-jm { width: 44px; text-align: center; }
  td.nb-c-q { width: 48px; text-align: right; }
  td.nb-c-p { width: 72px; text-align: right; }
  td.nb-c-a { width: 78px; text-align: right; }
  .nb-foot { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; font-size: 8.5pt; line-height: 1.45; }
  .nb-pay { border: 1px solid #000; padding: 10px 11px; min-height: 64px; }
  .nb-pay-body { margin: 8px 0 0; }
  .nb-pay-due { margin: 10px 0 0; font-size: 8.5pt; }
  .nb-pay-footer { margin: 12px 0 0; font-size: 8pt; line-height: 1.45; }
  .nb-pay-notes { margin-top: 12px; }
  .nb-sum { border: 1px solid #000; padding: 10px 11px; text-align: right; }
  .nb-sum table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .nb-sum td { padding: 5px 6px; border: none; vertical-align: top; }
  .nb-sum td:first-child { text-align: left; font-weight: 600; }
  .nb-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 22px; font-size: 8.5pt; }
  .nb-sign .line { border-top: 1px solid #000; margin-top: 36px; padding-top: 5px; text-align: center; line-height: 1.4; }
`;
