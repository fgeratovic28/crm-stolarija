import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { PROCUREMENT_FIELD_LABELS_COMPACT, type ImportedOrderItem } from "@/lib/procurement-excel-import";
import type { MaterialOrderItemsJsonV1 } from "@/lib/material-order-items-json";
import { buildPublicNarudzbenicaUrl } from "@/lib/public-narudzbenica-url";
import { RECEPTION_ACTION_BARCODE_ROWS } from "@/lib/item-reception-modal-barcodes";

const HEADER_ASSET = "memorandum.png";

export type LoadedRasterImage = {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
};

const HEADER_MAX_PX = 1100;
const HEADER_JPEG_QUALITY = 0.8;

/** Public folder asset → JPEG data URL (manji PDF od PNG memoranduma). */
export async function loadPublicImageDataUrl(assetPath: string): Promise<LoadedRasterImage> {
  const path = assetPath.replace(/^\//, "");
  const base = import.meta.env.BASE_URL || "/";
  const href =
    typeof window !== "undefined"
      ? new URL(path, `${window.location.origin}${base.endsWith("/") ? base : `${base}/`}`).toString()
      : path;

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Ne mogu da učitam sliku: ${path}`));
    img.src = href;
  });

  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > HEADER_MAX_PX) {
    const s = HEADER_MAX_PX / w;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nije dostupan.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", HEADER_JPEG_QUALITY),
    widthPx: w,
    heightPx: h,
  };
}

/**
 * Ista ASCII + skraćivanje kao u Code128 PDF-u — koristiti za poređenje sa USB/fizičkim skenerom
 * (često šalje razmake, retko drugačiji Unicode od štampе).
 */
export function normalizeProcurementBarcodePlainText(text: string): string {
  const combined = text.trim();
  const ascii = combined
    .split("")
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c >= 32 && c <= 126) return ch;
      return "_";
    })
    .join("");
  const v = ascii.length > 0 ? ascii : "TP-EMPTY";
  return v.length > 48 ? v.slice(0, 48) : v;
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h, 33) + s.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Sistemska vrednost za Code128: **M + tačno 9 cifara** (uvek ista dužina), deterministički za isti `scopeId` + red.
 * Koristi se za sve stavke porudžbine na PDF-u i pri prijemu kad postoji id narudžbine ili draft ključ.
 * `scopeId` = id narudžbine (UUID) ili privremeni ključ za pregled (npr. `pregled:job:…`).
 */
export function assignedManualProcurementBarcode(scopeId: string, lineIndex: number): string {
  const key = `${scopeId.trim()}:${lineIndex}`;
  const h = djb2(key) >>> 0;
  const nine = String(h % 1_000_000_000).padStart(9, "0");
  return `M${nine}`;
}

function normalizeArticleCodeForBarcode(articleCode: string | undefined): string {
  const raw = String(articleCode ?? "").trim().toUpperCase();
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  return cleaned;
}

/**
 * Barkod payload zasnovan na šifri:
 * - ako je šifra već ciljne dužine, koristi se bez dopune
 * - ako je kraća, dopunjava se determinističkim sistemskim ciframa; od šifre su one odvojene crticom (čitljivost)
 * - ako je prazna, koristi se sistemski fallback iste dužine
 */
export function assignedFixedLengthProcurementBarcode(
  scopeId: string,
  lineIndex: number,
  articleCode?: string,
): string {
  const TARGET_LEN = 10;
  const code = normalizeArticleCodeForBarcode(articleCode);
  if (code.length === TARGET_LEN) return code;
  if (code.length > TARGET_LEN) return code.slice(0, TARGET_LEN);
  if (code.length === 0) {
    return assignedManualProcurementBarcode(scopeId, lineIndex);
  }
  const sysKey = `${scopeId.trim()}:${lineIndex}:${code}`;
  const remaining = TARGET_LEN - code.length;
  /** Jedna pozicija: nema mesta za crticu i cifre — samo jedna dopunska cifra (isto kao ranije). */
  if (remaining <= 1) {
    const mod = 10 ** Math.min(9, remaining);
    const suffix = String(djb2(sysKey) % mod).padStart(remaining, "0");
    return `${code}${suffix}`;
  }
  const digitLen = remaining - 1;
  const mod = 10 ** Math.min(9, digitLen);
  const suffix = String(djb2(sysKey) % mod).padStart(digitLen, "0");
  return `${code}-${suffix}`;
}

/** Kontekst za štampu / prijem — id ili draft ključ + indeks reda za fiksni M-barkod. */
export type ProcurementBarcodeScope = {
  materialOrderId?: string | null;
  /** Pregled PDF pre čuvanja narudžbine (npr. `job:<uuid>`) — ne mešati sa pravim UUID-em porudžbine. */
  draftScopeKey?: string | null;
  lineIndex: number;
};

function scopeKeyFromProcurementBarcodeScope(scope: ProcurementBarcodeScope): string | null {
  const m = scope.materialOrderId?.trim();
  if (m) return m;
  const d = scope.draftScopeKey?.trim();
  return d && d.length > 0 ? d : null;
}

/**
 * Code128 payload za porudžbinu: kad postoji scope (narudžbina ili pregled) — **uvek** M + 9 cifara (ista dužina za Excel i ručno).
 * Bez scope-a (retko): segmenti iz nabavnih kolona ili naziv artikla kao ranije.
 */
export function procurementBarcodeValue(item: ImportedOrderItem, scope?: ProcurementBarcodeScope): string {
  const scopeKey = scope ? scopeKeyFromProcurementBarcodeScope(scope) : null;
  const lineIndex = scope?.lineIndex ?? 0;
  if (scopeKey) {
    return normalizeProcurementBarcodePlainText(
      assignedFixedLengthProcurementBarcode(scopeKey, lineIndex, item.article_code),
    );
  }

  const lenSeg =
    item.length_mm != null && Number.isFinite(Number(item.length_mm))
      ? String(Math.round(Number(item.length_mm)))
      : "";
  const segments = [
    item.work_order?.trim(),
    item.position?.trim(),
    item.article_code?.trim(),
    lenSeg || undefined,
  ].filter((s): s is string => Boolean(s && s.length > 0));
  const combined =
    segments.length > 0 ? segments.join("-") : (item.article?.trim() || "TP-EMPTY");
  return normalizeProcurementBarcodePlainText(combined);
}

export type BarcodeRaster = { dataUrl: string; aspect: number };

/** Maks. širina rasterske slike (px) — uži raster = bolji odnos širina/visina u PDF ćeliji (veća iscrtana visina). */
const BARCODE_RASTER_MAX_WIDTH_PX = 260;

export function generateBarcodePngDataUrl(value: string): BarcodeRaster {
  const safe = value.trim().length > 0 ? value : "TP-EMPTY";
  /** Kraći moduli za duže vrednosti — uže polazno platno, čitljivije u istoj ćeliji. */
  const moduleW = Math.max(1, Math.min(2, 52 / Math.max(safe.length, 8)));
  /** Niži moduli u PDF-u (čitljivost zadržana, manja visina reda u tabeli). */
  const barH = safe.length > 28 ? 54 : 46;

  const src = document.createElement("canvas");
  JsBarcode(src, safe, {
    format: "CODE128",
    displayValue: false,
    margin: 4,
    width: moduleW,
    height: barH,
    background: "#ffffff",
    lineColor: "#000000",
  });

  let w = Math.max(1, src.width);
  let h = Math.max(1, src.height);
  let out: HTMLCanvasElement = src;

  if (w > BARCODE_RASTER_MAX_WIDTH_PX) {
    const sc = BARCODE_RASTER_MAX_WIDTH_PX / w;
    const scaled = document.createElement("canvas");
    scaled.width = BARCODE_RASTER_MAX_WIDTH_PX;
    scaled.height = Math.max(36, Math.round(h * sc));
    const ctx = scaled.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, scaled.width, scaled.height);
      ctx.drawImage(src, 0, 0, scaled.width, scaled.height);
      out = scaled;
      w = out.width;
      h = out.height;
    }
  }

  return { dataUrl: out.toDataURL("image/jpeg", 0.88), aspect: w / h };
}

export async function generateQrPngDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    margin: 1,
    width: 160,
    errorCorrectionLevel: "L",
    type: "image/jpeg",
    quality: 0.85,
  });
}

/** Javni link porudžbine (QR za dobavljača) ili CRM link kad token još nema. */
export function buildMaterialOrderShareOrCrmUrl(params: {
  publicShareToken?: string | null;
  jobId?: string | null;
  materialOrderId?: string | null;
}): string {
  const token = params.publicShareToken?.trim();
  if (token) return buildPublicNarudzbenicaUrl(token);
  return buildCrmMaterialOrderUrl({
    jobId: params.jobId ?? undefined,
    materialOrderId: params.materialOrderId ?? undefined,
  });
}

/** HashRouter (Electron) vs BrowserRouter — deep link to job (and optional material order id). */
export function buildCrmMaterialOrderUrl(params: {
  jobId?: string | null;
  materialOrderId?: string | null;
}): string {
  const jobId = params.jobId?.trim();
  const mo = params.materialOrderId?.trim();
  const hashMode =
    typeof window !== "undefined" &&
    Boolean(window.location.hash) &&
    window.location.hash.startsWith("#/");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const pathname = typeof window !== "undefined" ? window.location.pathname || "/" : "/";
  const q = mo ? `?materialOrderId=${encodeURIComponent(mo)}` : "";
  if (!jobId) {
    if (hashMode) return `${origin}${pathname}#/jobs${q}`;
    return `${origin}/jobs${q}`;
  }
  if (hashMode) return `${origin}${pathname}#/jobs/${jobId}${q}`;
  return `${origin}/jobs/${jobId}${q}`;
}

type JSPDFWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

function drawWrappedFooterNote(
  doc: jsPDF,
  text: string,
  x: number,
  yStart: number,
  maxWidth: number,
  fontSize: number,
  lineHeightMm: number,
): number {
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(text, maxWidth);
  let y = yStart;
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineHeightMm;
  }
  return y;
}

/** Visina bloka sa 3 fiksna barkoda za prijem (potvrda / otkaz / završetak porudžbine). */
const RECEPTION_ACTION_BARCODE_FOOTER_BLOCK_MM = 34;

/**
 * Tri fiksna Code128 barkoda na dnu porudžbenice — uvek isti kodovi kao na stranici prijema.
 * Vraća Y ispod bloka.
 */
function drawReceptionActionBarcodesFooter(
  doc: jsPDF,
  yStart: number,
  pageW: number,
  pageH: number,
  margin: number,
): number {
  const contentW = pageW - 2 * margin;
  const blockH = RECEPTION_ACTION_BARCODE_FOOTER_BLOCK_MM;
  let y = yStart + 3;

  if (y + blockH > pageH - margin) {
    doc.addPage();
    y = margin + 2;
  }

  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageW - margin, y);
  y += 3.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(55, 55, 55);
  doc.text("Barkodovi za prijem materijala (magacin)", margin, y);
  y += 4.5;

  const colW = contentW / 3;
  const barMaxW = colW - 6;
  const barMaxH = 14;

  for (let i = 0; i < RECEPTION_ACTION_BARCODE_ROWS.length; i += 1) {
    const row = RECEPTION_ACTION_BARCODE_ROWS[i];
    const colCenterX = margin + i * colW + colW / 2;
    const colLeft = margin + i * colW;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(30, 30, 30);
    const labelLines = doc.splitTextToSize(row.label, colW - 4);
    doc.text(labelLines, colCenterX, y, { align: "center" });

    const raster = generateBarcodePngDataUrl(row.code);
    let barW = Math.min(barMaxW, 42);
    let barH = Math.min(barMaxH, barW / Math.max(raster.aspect, 0.35));
    if (barH > barMaxH) {
      barH = barMaxH;
      barW = barH * raster.aspect;
    }
    const barX = colLeft + (colW - barW) / 2;
    const barY = y + 3.2;
    doc.addImage(raster.dataUrl, "JPEG", barX, barY, barW, barH);

    doc.setFont("courier", "bold");
    doc.setFontSize(7);
    doc.setTextColor(20, 20, 20);
    doc.text(row.code, colCenterX, barY + barH + 3.2, { align: "center" });
  }

  return y + blockH;
}

function drawProcurementPdfClosingFooter(
  doc: jsPDF,
  yAfterContent: number,
  pageW: number,
  pageH: number,
  margin: number,
  contentW: number,
  footerNote: string,
): void {
  let y = yAfterContent + 6;
  const bottomReserve = RECEPTION_ACTION_BARCODE_FOOTER_BLOCK_MM + 10;
  const note = footerNote.trim();

  doc.setFont("helvetica", "normal");
  doc.setTextColor(45, 45, 45);

  if (note) {
    const projected = y + 48;
    if (projected > pageH - bottomReserve) {
      doc.addPage();
      y = margin;
    }
    y = drawWrappedFooterNote(doc, note, margin, y + 4, contentW, 8.5, 4) + 3;
    if (y + 10 > pageH - bottomReserve) {
      doc.addPage();
      y = margin + 4;
    }
  } else {
    y += 4;
    if (y + 10 > pageH - bottomReserve) {
      doc.addPage();
      y = margin + 4;
    }
  }

  doc.setFontSize(9);
  doc.setTextColor(45, 45, 45);
  doc.text("Termoplast doo", pageW - margin, y, { align: "right" });
  y += 5;

  drawReceptionActionBarcodesFooter(doc, y, pageW, pageH, margin);
}

export type ProcurementOrderPdfInput = {
  rows: ImportedOrderItem[];
  nalogLabel: string;
  crmUrl: string;
  footerNote: string;
  /** Opcioni nazivi kolona za tabelu (po uvozu). */
  columnLabels?: Record<string, string>;
  /**
   * Sa `materialOrderId` ili `draftScopeKey`: svi redovi dobijaju M + 9 cifara (jednaka dužina barkoda).
   * Bez scope-a: segmentni / artikal payload (legacy).
   */
  barcodeScope?: Pick<ProcurementBarcodeScope, "materialOrderId" | "draftScopeKey">;
  /**
   * Naslov dokumenta (default: „PORUDZBINA-MOLBA ZA PREDRACUN").
   * Koristi se npr. za „Porudžbinu po nedostatku" gde nema nove molbe za predračun.
   */
  pdfTitle?: string;
  /**
   * Eksplicitne vrednosti barkoda po redu (string ili null/undefined).
   * Kada je definisan i nije prazno: koristi se direktno za Code128; inače pada na sistemski izračun.
   * Koristi se za „Porudžbinu po nedostatku" — magacin skenira ORIGINALNE barkodove sa stare porudžbenice.
   */
  perRowBarcodes?: (string | null | undefined)[];
};

export async function generateProcurementOrderPdfBlob(input: ProcurementOrderPdfInput): Promise<Blob> {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - 2 * margin;

  const header = await loadPublicImageDataUrl(HEADER_ASSET);
  const headerH = contentW * (header.heightPx / header.widthPx);
  doc.addImage(header.dataUrl, "JPEG", margin, margin, contentW, headerH);

  let cursorY = margin + headerH + 5;

  const qrDataUrl = await generateQrPngDataUrl(input.crmUrl);
  const qrMm = 26;
  const qrX = pageW - margin - qrMm;
  doc.addImage(qrDataUrl, "JPEG", qrX, cursorY, qrMm, qrMm);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(20, 20, 20);
  const title = input.pdfTitle?.trim() || "PORUDZBINA-MOLBA ZA PREDRACUN";
  doc.text(title, margin, cursorY + 8);
  const nalogRef = input.nalogLabel.trim();
  if (nalogRef.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(`Referenca: ${nalogRef}`, margin, cursorY + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
  }

  cursorY = Math.max(cursorY + qrMm, cursorY + 12) + 4;

  const rows = input.rows;
  /** Jedinstveni radni nalozi iz Excela — jedna linija iznad tabele. */
  const distinctWorkOrders = [
    ...new Set(rows.map((r) => r.work_order?.trim()).filter((s): s is string => Boolean(s))),
  ];

  let tableStartY = cursorY;
  /** Jedan isti nalog za sve redove → samo linija iznad tabele, bez kolone NALOG. Više različitih → kolona NALOG u tabeli. */
  const singleNalogForAllRows = distinctWorkOrders.length === 1;
  const multipleNalogVariants = distinctWorkOrders.length > 1;

  if (singleNalogForAllRows) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(28, 28, 28);
    doc.text(`Nalog: ${distinctWorkOrders[0]}`, margin, tableStartY + 5);
    tableStartY += 9;
  }

  const showNalogColumn = multipleNalogVariants;
  const showPoz = rows.some((r) => String(r.position ?? "").trim());
  const showBoja = rows.some((r) => r.color?.trim());
  const showDuz = rows.some(
    (r) => r.length_mm != null && Number.isFinite(Number(r.length_mm)),
  );
  const showJm = rows.some((r) => r.uom?.trim());

  const colLabel = (key: "NALOG" | "POZ" | "ŠIFRA" | "ARTIKAL" | "BOJA" | "DUŽ" | "JM" | "KOL"): string => {
    const map = input.columnLabels ?? {};
    switch (key) {
      case "NALOG":
        return (map.work_order || map["NALOG"] || "NALOG").toString();
      case "POZ":
        return (map.position || map["POZ"] || "POZ").toString();
      case "ŠIFRA":
        return (map.article_code || map["ŠIFRA"] || "ŠIFRA").toString();
      case "ARTIKAL":
        return (map.article || map["ARTIKAL"] || "ARTIKAL").toString();
      case "BOJA":
        return (map.color || map["BOJA"] || "BOJA").toString();
      case "DUŽ":
        return (map.length_mm || map["DUŽ"] || "DUŽ. (mm)").toString();
      case "JM":
        return (map.uom || map["JM"] || "JM").toString();
      case "KOL":
        return (map.quantity || map["KOL"] || "KOL").toString();
    }
  };

  type ColDef = { head: string; cell: (r: ImportedOrderItem) => string; width: number | "auto"; minH?: number };
  const colDefs: ColDef[] = [];
  if (showNalogColumn) colDefs.push({ head: colLabel("NALOG"), cell: (r) => r.work_order?.trim() ?? "", width: 18 });
  if (showPoz) colDefs.push({ head: colLabel("POZ"), cell: (r) => r.position ?? "", width: 12 });
  colDefs.push({ head: colLabel("ARTIKAL"), cell: (r) => r.article, width: "auto" });
  if (showBoja) colDefs.push({ head: colLabel("BOJA"), cell: (r) => r.color?.trim() ?? "", width: 16 });
  if (showDuz) {
    colDefs.push({
      head: colLabel("DUŽ"),
      cell: (r) =>
        r.length_mm != null && Number.isFinite(Number(r.length_mm)) ? String(Math.round(Number(r.length_mm))) : "",
      width: 22,
    });
  }
  if (showJm) colDefs.push({ head: colLabel("JM"), cell: (r) => r.uom?.trim() ?? "", width: 12 });
  colDefs.push({ head: colLabel("KOL"), cell: (r) => String(r.quantity), width: 12 });
  colDefs.push({ head: "BARKOD", cell: () => " ", width: 64, minH: 20 });

  const barcodeColIndex = colDefs.length - 1;
  const barcodeRasters = rows.map((row, i) => {
    const override = input.perRowBarcodes?.[i];
    const value =
      override && String(override).trim().length > 0
        ? normalizeProcurementBarcodePlainText(String(override).trim())
        : procurementBarcodeValue(row, {
            materialOrderId: input.barcodeScope?.materialOrderId,
            draftScopeKey: input.barcodeScope?.draftScopeKey,
            lineIndex: i,
          });
    return generateBarcodePngDataUrl(value);
  });

  const columnStyles: Record<number, { cellWidth: number | "auto"; minCellHeight?: number }> = {};
  colDefs.forEach((c, i) => {
    columnStyles[i] = { cellWidth: c.width, ...(c.minH != null ? { minCellHeight: c.minH } : {}) };
  });

  autoTable(doc, {
    startY: tableStartY,
    margin: { top: margin, left: margin, right: margin, bottom: margin },
    head: [colDefs.map((c) => c.head)],
    body: rows.map((r) => colDefs.map((c) => c.cell(r))),
    styles: { fontSize: 7.5, cellPadding: 1.2, valign: "middle", overflow: "linebreak" },
    headStyles: { fillColor: [235, 235, 235], textColor: 30, fontStyle: "bold", fontSize: 7.5 },
    columnStyles,
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === barcodeColIndex) {
        const raster = barcodeRasters[data.row.index];
        if (!raster) return;
        const pad = 0.6;
        const cw = Math.max(1, data.cell.width - 2 * pad);
        const ch = Math.max(1, data.cell.height - 2 * pad);
        const imgAR = raster.aspect;
        /** Prvo ispuni visinu ćelije (što je uže — veći vizuelni barkod); ako širina pređe ćeliju, skaliraj po širini. */
        let dh = ch;
        let dw = ch * imgAR;
        if (dw > cw) {
          dw = cw;
          dh = cw / imgAR;
        }
        const dx = data.cell.x + pad + (cw - dw) / 2;
        const dy = data.cell.y + pad + (ch - dh) / 2;
        data.doc.addImage(raster.dataUrl, "JPEG", dx, dy, dw, dh);
      }
    },
  });

  const finalY = (doc as JSPDFWithAutoTable).lastAutoTable?.finalY ?? cursorY;
  drawProcurementPdfClosingFooter(doc, finalY, pageW, pageH, margin, contentW, input.footerNote);

  return doc.output("blob");
}

export type SmartItemsProcurementPdfInput = {
  itemsJson: MaterialOrderItemsJsonV1;
  nalogLabel: string;
  crmUrl: string;
  footerNote: string;
  barcodeScope?: Pick<ProcurementBarcodeScope, "materialOrderId" | "draftScopeKey">;
  /** Ručne stavke — ista širina strane, blago odvojena tabela ispod smart redova; sva nabavna polja + barkod. */
  manualAppendixImportedRows?: ImportedOrderItem[];
  /** Naslovi kolona za dodatak (isti ključevi kao za klasični PDF). */
  columnLabels?: Record<string, string>;
  /** Naslov dokumenta (default: „PORUDZBINA-MOLBA ZA PREDRACUN"). */
  pdfTitle?: string;
};

function importedItemFromSmartRow(json: MaterialOrderItemsJsonV1, row: Record<string, string>): ImportedOrderItem {
  const article = String(row[json.articleColumnKey] ?? "").trim() || "—";
  const code = String(row[json.sifraColumnKey] ?? "").trim();
  const position = json.positionColumnKey ? String(row[json.positionColumnKey] ?? "").trim() : "";
  const work_order = json.workOrderColumnKey ? String(row[json.workOrderColumnKey] ?? "").trim() : "";
  const color = json.colorColumnKey ? String(row[json.colorColumnKey] ?? "").trim() : "";
  const uom = json.uomColumnKey ? String(row[json.uomColumnKey] ?? "").trim() : "";
  let length_mm: number | null = null;
  if (json.lengthColumnKey) {
    const lr = String(row[json.lengthColumnKey] ?? "").trim();
    if (lr) {
      const n = Number(lr.replace(/\s/g, "").replace(",", "."));
      length_mm = Number.isFinite(n) ? Math.round(n) : null;
    }
  }
  const qtyRaw = row[json.quantityColumnKey];
  const qtyNum = Number(String(qtyRaw ?? "").replace(/\s/g, "").replace(",", "."));
  const quantity = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 0.0001;
  return {
    ...(work_order ? { work_order } : {}),
    ...(position ? { position } : {}),
    ...(code ? { article_code: code } : {}),
    article,
    ...(color ? { color } : {}),
    ...(uom ? { uom } : {}),
    length_mm,
    quantity,
    raw_row: row,
    manual_line: false,
  };
}

/** PDF porudžbine iz dinamičke tabele (smart Excel): kolone = kao u UI, bez kolone Šifra u tekstu; kolona BARKOD uvek poslednja. */
export async function generateProcurementOrderPdfBlobFromSmartItems(
  input: SmartItemsProcurementPdfInput,
): Promise<Blob> {
  const json = input.itemsJson;
  const rows = json.rows;
  const noSifra = json.columns.filter((c) => c.key !== json.sifraColumnKey);
  const woKey = json.workOrderColumnKey?.trim() || null;
  const distinctWo = woKey
    ? [...new Set(rows.map((r) => String(r[woKey] ?? "").trim()).filter(Boolean))]
    : [];
  const singleNalogForAllRows = woKey != null && distinctWo.length === 1;
  const omitWoFromTable = woKey != null && distinctWo.length === 1;

  const tableCols = noSifra.filter((c) => !(omitWoFromTable && woKey && c.key === woKey));
  const articlePresent = tableCols.some((c) => c.key === json.articleColumnKey);
  if (!articlePresent) {
    throw new Error("Kolona artikla nije u tabeli za štampu.");
  }

  const importedForBarcode = rows.map((row) => importedItemFromSmartRow(json, row));

  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - 2 * margin;

  const header = await loadPublicImageDataUrl(HEADER_ASSET);
  const headerH = contentW * (header.heightPx / header.widthPx);
  doc.addImage(header.dataUrl, "JPEG", margin, margin, contentW, headerH);

  let cursorY = margin + headerH + 5;

  const qrDataUrl = await generateQrPngDataUrl(input.crmUrl);
  const qrMm = 26;
  const qrX = pageW - margin - qrMm;
  doc.addImage(qrDataUrl, "JPEG", qrX, cursorY, qrMm, qrMm);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(20, 20, 20);
  const title = input.pdfTitle?.trim() || "PORUDZBINA-MOLBA ZA PREDRACUN";
  doc.text(title, margin, cursorY + 8);
  const nalogRef = input.nalogLabel.trim();
  if (nalogRef.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(`Referenca: ${nalogRef}`, margin, cursorY + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
  }

  cursorY = Math.max(cursorY + qrMm, cursorY + 12) + 4;

  let tableStartY = cursorY;
  if (singleNalogForAllRows && distinctWo[0]) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(28, 28, 28);
    doc.text(`Nalog: ${distinctWo[0]}`, margin, tableStartY + 5);
    tableStartY += 9;
  }

  type ColDef = { head: string; cell: (row: Record<string, string>) => string; width: number | "auto"; minH?: number };
  const colDefs2: ColDef[] = tableCols.map((c) => {
    const isWo = Boolean(woKey && c.key === woKey && distinctWo.length > 1);
    return {
      head: c.label,
      cell: (r: Record<string, string>) => String(r[c.key] ?? "").trim(),
      width: (isWo ? 18 : "auto") as number | "auto",
    };
  });
  colDefs2.push({
    head: "BARKOD",
    cell: () => " ",
    width: 56,
    minH: 20,
  });
  const barcodeColIndex = colDefs2.length - 1;

  const barcodeRasters = importedForBarcode.map((row, i) =>
    generateBarcodePngDataUrl(
      procurementBarcodeValue(row, {
        materialOrderId: input.barcodeScope?.materialOrderId,
        draftScopeKey: input.barcodeScope?.draftScopeKey,
        lineIndex: i,
      }),
    ),
  );

  const columnStyles: Record<number, { cellWidth: number | "auto"; minCellHeight?: number }> = {};
  colDefs2.forEach((c, i) => {
    columnStyles[i] = { cellWidth: c.width, ...(c.minH != null ? { minCellHeight: c.minH } : {}) };
  });

  const smartTableMargin = { top: margin, left: margin, right: margin, bottom: margin };
  const smartTableBodyStyles = {
    fontSize: 7.5,
    cellPadding: 1.2,
    valign: "top" as const,
    overflow: "linebreak" as const,
  };
  const smartTableHeadStyles = {
    fillColor: [235, 235, 235] as [number, number, number],
    textColor: 30,
    fontStyle: "bold" as const,
    fontSize: 7.5,
  };

  const drawProcurementBarcodeInCell = (args: {
    data: Parameters<NonNullable<Parameters<typeof autoTable>[1]>["didDrawCell"]>[0];
    barcodeColIndex: number;
    rasters: BarcodeRaster[];
  }) => {
    const { data, barcodeColIndex: bcIx, rasters } = args;
    if (data.section !== "body") return;
    if (data.column.index !== bcIx) return;
    const raster = rasters[data.row.index];
    if (!raster) return;
    const pad = 0.6;
    const cw = Math.max(1, data.cell.width - 2 * pad);
    const ch = Math.max(1, data.cell.height - 2 * pad);
    const imgAR = raster.aspect;
    let dh = ch;
    let dw = dh * imgAR;
    if (dw > cw) {
      dw = cw;
      dh = cw / imgAR;
    }
    const dx = data.cell.x + pad + (cw - dw) / 2;
    const dy = data.cell.y + pad + (ch - dh) / 2;
    data.doc.addImage(raster.dataUrl, "JPEG", dx, dy, dw, dh);
  };

  autoTable(doc, {
    startY: tableStartY,
    margin: smartTableMargin,
    head: [colDefs2.map((c) => c.head)],
    body: rows.map((r) => colDefs2.map((c) => c.cell(r))),
    styles: smartTableBodyStyles,
    headStyles: smartTableHeadStyles,
    columnStyles,
    didDrawCell: (data) =>
      drawProcurementBarcodeInCell({ data, barcodeColIndex, rasters: barcodeRasters }),
  });

  let yAfterTables = (doc as JSPDFWithAutoTable).lastAutoTable?.finalY ?? cursorY;
  const appendix = input.manualAppendixImportedRows;
  const smartRowCount = rows.length;

  if (appendix && appendix.length > 0) {
    yAfterTables += 2.5;
    doc.setDrawColor(235, 235, 235);
    doc.setLineWidth(0.15);
    doc.line(margin, yAfterTables, pageW - margin, yAfterTables);
    yAfterTables += 3.2;

    const map = input.columnLabels ?? {};
    const L = PROCUREMENT_FIELD_LABELS_COMPACT;
    const pickHead = (altKeys: string[], fallback: string) => {
      for (const ak of altKeys) {
        const v = map[ak];
        if (v != null && String(v).trim()) return String(v).trim();
      }
      return fallback;
    };

    const showWo = appendix.some((r) => r.work_order?.trim());
    const showPoz = appendix.some((r) => r.position?.trim());
    const showSifra = appendix.some((r) => r.article_code?.trim());
    const showBoja = appendix.some((r) => r.color?.trim());
    const showDuz = appendix.some((r) => r.length_mm != null && Number.isFinite(Number(r.length_mm)));
    const showJm = appendix.some((r) => r.uom?.trim());

    type AppCol = { head: string; w: number | "auto"; cell: (r: ImportedOrderItem) => string; minH?: number };
    const appCols: AppCol[] = [];
    if (showWo) {
      appCols.push({
        head: pickHead(["work_order", "NALOG"], L.work_order),
        w: 18,
        cell: (r) => r.work_order?.trim() ?? "",
      });
    }
    if (showPoz) {
      appCols.push({
        head: pickHead(["position", "POZ"], L.position),
        w: 12,
        cell: (r) => r.position?.trim() ?? "",
      });
    }
    if (showSifra) {
      appCols.push({
        head: pickHead(["article_code", "ŠIFRA", "SIFRA"], L.article_code),
        w: "auto",
        cell: (r) => r.article_code?.trim() ?? "",
      });
    }
    appCols.push({
      head: pickHead(["article", "ARTIKAL"], L.article),
      w: "auto",
      cell: (r) => r.article,
    });
    if (showBoja) {
      appCols.push({
        head: pickHead(["color", "BOJA"], L.color),
        w: "auto",
        cell: (r) => r.color?.trim() ?? "",
      });
    }
    if (showDuz) {
      appCols.push({
        head: pickHead(["length_mm", "DUŽ", "DUZ"], "Duž. (mm)"),
        w: "auto",
        cell: (r) =>
          r.length_mm != null && Number.isFinite(Number(r.length_mm)) ? String(Math.round(Number(r.length_mm))) : "",
      });
    }
    if (showJm) {
      appCols.push({
        head: pickHead(["uom", "JM"], L.uom),
        w: 12,
        cell: (r) => r.uom?.trim() ?? "",
      });
    }
    appCols.push({
      head: pickHead(["quantity", "KOL"], L.quantity),
      w: 12,
      cell: (r) => String(r.quantity),
    });
    appCols.push({ head: "BARKOD", w: 56, cell: () => " ", minH: 20 });
    const appBarcodeIx = appCols.length - 1;
    const appendixBarcodeRasters = appendix.map((row, i) =>
      generateBarcodePngDataUrl(
        procurementBarcodeValue(row, {
          materialOrderId: input.barcodeScope?.materialOrderId,
          draftScopeKey: input.barcodeScope?.draftScopeKey,
          lineIndex: smartRowCount + i,
        }),
      ),
    );

    const appColumnStyles: Record<number, { cellWidth: number | "auto"; minCellHeight?: number }> = {};
    appCols.forEach((c, i) => {
      appColumnStyles[i] = { cellWidth: c.w, ...(c.minH != null ? { minCellHeight: c.minH } : {}) };
    });

    autoTable(doc, {
      startY: yAfterTables,
      margin: smartTableMargin,
      head: [appCols.map((c) => c.head)],
      body: appendix.map((r) => appCols.map((c) => c.cell(r))),
      styles: smartTableBodyStyles,
      headStyles: smartTableHeadStyles,
      columnStyles: appColumnStyles,
      didDrawCell: (data) =>
        drawProcurementBarcodeInCell({ data, barcodeColIndex: appBarcodeIx, rasters: appendixBarcodeRasters }),
    });

    yAfterTables = (doc as JSPDFWithAutoTable).lastAutoTable?.finalY ?? yAfterTables;
  }

  drawProcurementPdfClosingFooter(doc, yAfterTables, pageW, pageH, margin, contentW, input.footerNote);

  return doc.output("blob");
}

export { openPdfBlobInNewTabOrDownload } from "@/lib/pdf-from-html";
