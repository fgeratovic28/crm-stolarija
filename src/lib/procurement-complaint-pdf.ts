import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  generateBarcodePngDataUrl,
  generateQrPngDataUrl,
  loadPublicImageDataUrl,
} from "@/lib/material-order-procurement-pdf";
import { buildProcurementOrderPublicRedirectUrl } from "@/lib/procurement-order-public-redirect-url";

const HEADER_ASSET = "memorandum.png";

const SERBIAN_MAP: Record<string, string> = {
  "đ": "dj", "Đ": "Dj",
  "č": "c", "Č": "C",
  "ć": "c", "Ć": "C",
  "š": "s", "Š": "S",
  "ž": "z", "Ž": "Z",
};

function translit(text: string): string {
  return text.split("").map((ch) => SERBIAN_MAP[ch] ?? ch).join("");
}

export type ProcurementComplaintPdfRow = {
  id: string;
  order_id: string;
  supplier: string | null;
  item_details: Record<string, unknown>;
  photo_evidence_urls: string[];
  created_at?: string | null;
  /** Code128 vrednost (C…) za prijem reklamacije skeniranjem u magacinu. */
  barcode?: string | null;
};

export type SupplierPdfResult = {
  supplier: string;
  blob: Blob;
  filename: string;
};

const QUANTITY_FIELDS = new Set(["missing_qty", "damaged_qty", "uom"]);

const DETAIL_COLUMNS: { key: string; label: string; isQty: boolean }[] = [
  { key: "article_code", label: "Sifra", isQty: false },
  { key: "article", label: "Artikal", isQty: false },
  { key: "color", label: "Boja", isQty: false },
  { key: "length_mm", label: "Duz.(mm)", isQty: false },
  { key: "description", label: "Opis", isQty: false },
  { key: "uom", label: "JM", isQty: true },
  { key: "missing_qty", label: "Nedostaje", isQty: true },
  { key: "damaged_qty", label: "Osteceno", isQty: true },
  { key: "notes", label: "Napomena", isQty: false },
];

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function getVisibleColumns(rows: ProcurementComplaintPdfRow[]) {
  const activeKeys = new Set<string>();
  for (const r of rows) {
    const d = r.item_details;
    if (!d || typeof d !== "object") continue;
    for (const k of Object.keys(d)) {
      if (cellStr(d[k]).length > 0) activeKeys.add(k);
    }
  }
  return DETAIL_COLUMNS.filter((c) => activeKeys.has(c.key));
}

function buildSameOriginImageProxyUrl(remoteUrl: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  let basePath = import.meta.env.BASE_URL ?? "/";
  if (basePath === "./") basePath = "/";
  if (!basePath.endsWith("/")) basePath = `${basePath}/`;
  const root = `${origin}${basePath.replace(/^\.\//, "")}`;
  const pu = new URL(root);
  return new URL(`api/proxy-external-image?u=${encodeURIComponent(remoteUrl)}`, pu).href;
}

/** Direktno sa R2 često blokira CORS (GET); UI sa `<img src>` radi, ali za PDF treba blob — zato fallback na isti-origin proxy. */
async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string; fmt: "JPEG" | "PNG" } | null> {
  const fromBlob = async (blob: Blob): Promise<{ dataUrl: string; fmt: "JPEG" | "PNG" } | null> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(new Error("read"));
      fr.readAsDataURL(blob);
    });
    const t = blob.type.toLowerCase();
    if (t.includes("png")) return { dataUrl, fmt: "PNG" };
    return { dataUrl, fmt: "JPEG" };
  };

  const tryResponse = async (res: Response | null): Promise<{ dataUrl: string; fmt: "JPEG" | "PNG" } | null> => {
    if (!res?.ok) return null;
    try {
      const blob = await res.blob();
      return await fromBlob(blob);
    } catch {
      return null;
    }
  };

  try {
    const direct = await fetch(url, { mode: "cors" });
    const out = await tryResponse(direct);
    if (out) return out;
  } catch {
    /* nedostatak CORS / mreže */
  }

  try {
    if (typeof window === "undefined") return null;
    const proxyHref = buildSameOriginImageProxyUrl(url);
    const proxied = await fetch(proxyHref, { credentials: "omit", mode: "cors" });
    return await tryResponse(proxied);
  } catch {
    return null;
  }
}

async function generateSingleSupplierPdf(
  complaints: ProcurementComplaintPdfRow[],
  supplier: string,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - 2 * margin;

  const header = await loadPublicImageDataUrl(HEADER_ASSET);
  const headerH = contentW * (header.heightPx / header.widthPx);
  doc.addImage(header.dataUrl, "JPEG", margin, margin, contentW, headerH);

  let cursorY = margin + headerH + 5;

  // QR po jedinstvenoj porudžbini — magacin skenira da otvori prijem.
  const uniqueOrderIds = Array.from(new Set(complaints.map((c) => c.order_id).filter(Boolean)));
  const qrSize = 26;
  const qrPairs: { id: string; dataUrl: string | null }[] = await Promise.all(
    uniqueOrderIds.map(async (id) => {
      const link = buildProcurementOrderPublicRedirectUrl(id, "complaint");
      if (!link) return { id, dataUrl: null };
      try {
        return { id, dataUrl: await generateQrPngDataUrl(link) };
      } catch {
        return { id, dataUrl: null };
      }
    }),
  );

  const qrsToRender = qrPairs.filter((p) => p.dataUrl);
  if (qrsToRender.length > 0) {
    const qrGap = 4;
    const totalQrW = qrsToRender.length * qrSize + (qrsToRender.length - 1) * qrGap;
    let qrX = pageW - margin - totalQrW;
    if (qrX < margin) qrX = margin;
    for (const p of qrsToRender) {
      if (p.dataUrl) {
        doc.addImage(p.dataUrl, "JPEG", qrX, cursorY, qrSize, qrSize);
      }
      qrX += qrSize + qrGap;
    }
  }

  const titleMaxW = qrsToRender.length > 0 ? contentW - qrSize - 6 : contentW;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text(translit("Reklamacija nabavke — nedostatak / ostecenje"), margin, cursorY + 4, {
    maxWidth: titleMaxW,
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(180, 0, 0);
  doc.text(`Dobavljac: ${translit(supplier)}`, margin, cursorY + 10, { maxWidth: titleMaxW });

  const dateStr = new Date().toLocaleDateString("sr-Latn");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Datum: ${dateStr} · Broj stavki: ${complaints.length}`, margin, cursorY + 15, {
    maxWidth: titleMaxW,
  });

  cursorY = Math.max(cursorY + qrSize, cursorY + 15) + 6;

  const columns = getVisibleColumns(complaints);
  const headCols = columns.map((c) => c.label);

  const tableHead = ["R.br.", ...headCols, "BARKOD"];
  const tableBody = complaints.map((c, idx) => {
    const d = (c.item_details && typeof c.item_details === "object" ? c.item_details : {}) as Record<string, unknown>;
    return [
      String(idx + 1),
      ...columns.map((col) => translit(cellStr(d[col.key]))),
      " ",
    ];
  });
  const barcodeColIndex = tableHead.length - 1;
  const barcodeRasters = complaints.map((c) => {
    const code = String(c.barcode ?? "").trim();
    if (!code) return null;
    try {
      return generateBarcodePngDataUrl(code);
    } catch {
      return null;
    }
  });

  const colStyles: Record<number, unknown> = {};
  colStyles[0] = { halign: "center" as const, cellWidth: 10 };
  for (let i = 0; i < columns.length; i++) {
    const colIdx = i + 1;
    const col = columns[i];
    if (col.key === "article" || col.key === "description") {
      colStyles[colIdx] = { cellWidth: 23 };
    } else if (col.isQty) {
      colStyles[colIdx] = { halign: "center" as const, cellWidth: 10 };
    } else if (col.key === "notes") {
      colStyles[colIdx] = { cellWidth: 18 };
    } else if (col.key === "article_code") {
      colStyles[colIdx] = { cellWidth: 12 };
    } else if (col.key === "color") {
      colStyles[colIdx] = { cellWidth: 10 };
    } else if (col.key === "length_mm") {
      colStyles[colIdx] = { halign: "center" as const, cellWidth: 10 };
    }
  }
  colStyles[barcodeColIndex] = { cellWidth: 48, minCellHeight: 20 };

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [tableHead],
    body: tableBody,
    columnStyles: colStyles,
    styles: {
      fontSize: 6.5,
      cellPadding: 1.4,
      valign: "middle",
      overflow: "linebreak",
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [50, 50, 50],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: 2,
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    theme: "grid",
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== barcodeColIndex) return;
      const raster = barcodeRasters[data.row.index];
      if (!raster) return;
      const pad = 0.6;
      const cw = Math.max(1, data.cell.width - 2 * pad);
      const ch = Math.max(1, data.cell.height - 2 * pad);
      let dh = ch;
      let dw = dh * (raster.aspect || 3);
      if (dw > cw) {
        dw = cw;
        dh = cw / (raster.aspect || 3);
      }
      const dx = data.cell.x + pad + (cw - dw) / 2;
      const dy = data.cell.y + pad + (ch - dh) / 2;
      data.doc.addImage(raster.dataUrl, "JPEG", dx, dy, dw, dh);
    },
  });

  const last = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let y = (last?.finalY ?? cursorY) + 8;

  const imgMaxWidth = 70;
  const imgMaxHeight = 50;
  const imgGap = 4;
  const colsInRow = Math.max(1, Math.floor((contentW + imgGap) / (imgMaxWidth + imgGap)));

  let photoIndex = 0;
  let rowStartY = y;
  let colInRow = 0;

  for (const c of complaints) {
    const urls = Array.isArray(c.photo_evidence_urls)
      ? c.photo_evidence_urls.filter((u) => typeof u === "string" && u.trim())
      : [];
    if (urls.length === 0) continue;

    const article = cellStr(c.item_details["article"]) || c.id.slice(0, 8);

    if (y > pageH - 25) {
      doc.addPage();
      y = margin;
      rowStartY = y;
      colInRow = 0;
    }

    if (colInRow === 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(30, 30, 30);
      doc.text(`Fotografije — ${article}`, margin, y);
      y += 5;
    }

    for (const url of urls) {
      const img = await fetchImageAsDataUrl(url);
      if (!img) continue;

      const aspectRatio = img.fmt === "PNG" ? 1 : 1.33;
      let imgW = imgMaxWidth;
      let imgH = imgW / aspectRatio;
      if (imgH > imgMaxHeight) {
        imgH = imgMaxHeight;
        imgW = imgH * aspectRatio;
      }

      const xPos = margin + colInRow * (imgMaxWidth + imgGap);

      if (y + imgH + 6 > pageH - margin) {
        doc.addPage();
        y = margin;
        colInRow = 0;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(30, 30, 30);
        doc.text(`Fotografije — ${article}`, margin, y);
        y += 5;
      }

      const drawX = margin + colInRow * (imgMaxWidth + imgGap);
      doc.addImage(img.dataUrl, img.fmt, drawX, y, imgW, imgH);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(120, 120, 120);
      const label = `${photoIndex + 1}`;
      doc.text(label, drawX + imgW / 2, y + imgH + 3, { align: "center" });

      photoIndex++;
      colInRow++;

      if (colInRow >= colsInRow) {
        colInRow = 0;
        y += imgH + 7;
      }
    }

    if (colInRow !== 0) {
      y += imgMaxHeight + 7;
      colInRow = 0;
    }
  }

  if (photoIndex === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text("(Nema priloženih fotografija)", margin, y);
  }

  const lastPage = doc.getNumberOfPages();
  doc.setPage(lastPage);
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Termoplast doo", pw - margin, ph - margin, { align: "right" });

  return doc.output("blob");
}

/** Jedan PDF za unapred grupisane reklamacije istog dobavljača (jedan user-klik → jedan tab). */
export async function generateProcurementComplaintPdfForSupplierGroup(
  rows: ProcurementComplaintPdfRow[],
  supplierDisplayName: string,
): Promise<SupplierPdfResult> {
  const supplier = supplierDisplayName.trim() || "Nepoznat dobavljač";
  const blob = await generateSingleSupplierPdf(rows, supplier);
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeSupplier = supplier.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_").slice(0, 30);
  return {
    supplier,
    blob,
    filename: `Reklamacija_${safeSupplier}_${dateStr}.pdf`,
  };
}

export async function generateProcurementComplaintsDiscrepancyPdfBlobs(
  complaints: ProcurementComplaintPdfRow[],
): Promise<SupplierPdfResult[]> {
  const groups = new Map<string, ProcurementComplaintPdfRow[]>();
  for (const c of complaints) {
    const supplier = c.supplier?.trim() || "Nepoznat dobavljač";
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier)!.push(c);
  }

  const results: SupplierPdfResult[] = [];
  const dateStr = new Date().toISOString().slice(0, 10);

  for (const [supplier, rows] of groups.entries()) {
    const safeSupplier = supplier.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_").slice(0, 30);
    const blob = await generateSingleSupplierPdf(rows, supplier);
    const filename = `Reklamacija_${safeSupplier}_${dateStr}.pdf`;
    results.push({ supplier, blob, filename });
  }

  return results;
}
