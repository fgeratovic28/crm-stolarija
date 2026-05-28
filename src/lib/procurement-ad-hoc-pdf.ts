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

export type ProcurementAdHocPdfRow = {
  id: string;
  orderId: string;
  description: string;
  articleCode: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
  barcode: string;
  supplier: string | null;
  createdAt: string;
  /** Opciona nabavna polja — kolone se prikazuju samo ako bar jedna stavka u grupi ima vrednost. */
  workOrder?: string | null;
  position?: string | null;
  color?: string | null;
  lengthMm?: number | null;
};

export type AdHocSupplierPdfResult = {
  supplier: string;
  blob: Blob;
  filename: string;
};

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

async function generateAdHocSupplierPdf(
  rows: ProcurementAdHocPdfRow[],
  supplier: string,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  const contentW = pageW - 2 * margin;

  const header = await loadPublicImageDataUrl(HEADER_ASSET);
  const headerH = contentW * (header.heightPx / header.widthPx);
  doc.addImage(header.dataUrl, "JPEG", margin, margin, contentW, headerH);

  let cursorY = margin + headerH + 5;

  // QR po jedinstvenoj porudžbini (jedan PDF može da pokrije više porudžbina istog dobavljača).
  const uniqueOrderIds = Array.from(new Set(rows.map((r) => r.orderId).filter(Boolean)));
  const qrSize = 26;
  const qrPairs: { id: string; dataUrl: string | null }[] = await Promise.all(
    uniqueOrderIds.map(async (id) => {
      const link = buildProcurementOrderPublicRedirectUrl(id, "adhoc");
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
  doc.text(translit("Vanredne stavke nabavke — cekaju prijem"), margin, cursorY + 4, {
    maxWidth: titleMaxW,
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0, 90, 160);
  doc.text(`Dobavljac: ${translit(supplier)}`, margin, cursorY + 10, { maxWidth: titleMaxW });

  const dateStr = new Date().toLocaleDateString("sr-Latn");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Datum: ${dateStr} · Broj stavki: ${rows.length}`, margin, cursorY + 15, {
    maxWidth: titleMaxW,
  });

  cursorY = Math.max(cursorY + qrSize, cursorY + 15) + 6;

  /** Dinamičke kolone — prikazuju se samo ako bar jedna stavka u grupi ima vrednost. */
  const showWorkOrder = rows.some((r) => String(r.workOrder ?? "").trim().length > 0);
  const showPosition = rows.some((r) => String(r.position ?? "").trim().length > 0);
  const showSifra = rows.some((r) => String(r.articleCode ?? "").trim().length > 0);
  const showColor = rows.some((r) => String(r.color ?? "").trim().length > 0);
  const showLength = rows.some((r) => r.lengthMm != null && Number.isFinite(Number(r.lengthMm)));
  const showNotes = rows.some((r) => String(r.notes ?? "").trim().length > 0);

  type AdHocColumnDef = {
    head: string;
    cell: (r: ProcurementAdHocPdfRow) => string;
    width: number;
    align?: "left" | "center" | "right";
    minH?: number;
  };

  const columnDefs: AdHocColumnDef[] = [
    { head: "R.br.", cell: (_r) => "", width: 8, align: "center" },
  ];
  if (showWorkOrder) {
    columnDefs.push({
      head: "Nalog",
      cell: (r) => translit(cellStr(r.workOrder)),
      width: 14,
    });
  }
  if (showPosition) {
    columnDefs.push({
      head: "Poz.",
      cell: (r) => translit(cellStr(r.position)),
      width: 10,
      align: "center",
    });
  }
  if (showSifra) {
    columnDefs.push({ head: "Sifra", cell: (r) => translit(cellStr(r.articleCode)), width: 16 });
  }
  columnDefs.push({
    head: "Naziv / opis",
    cell: (r) => translit(cellStr(r.description)),
    width: 0, // popunjava preostali prostor
  });
  if (showColor) {
    columnDefs.push({
      head: "Boja",
      cell: (r) => translit(cellStr(r.color)),
      width: 14,
    });
  }
  if (showLength) {
    columnDefs.push({
      head: "Duz. (mm)",
      cell: (r) =>
        r.lengthMm != null && Number.isFinite(Number(r.lengthMm))
          ? String(Math.round(Number(r.lengthMm)))
          : "",
      width: 14,
      align: "center",
    });
  }
  columnDefs.push({ head: "Kolicina", cell: (r) => cellStr(r.quantity), width: 12, align: "center" });
  columnDefs.push({
    head: "JM",
    cell: (r) => translit(cellStr(r.unit)),
    width: 10,
    align: "center",
  });
  if (showNotes) {
    columnDefs.push({ head: "Napomena", cell: (r) => translit(cellStr(r.notes)), width: 28 });
  }
  columnDefs.push({ head: "BARKOD", cell: () => " ", width: 50, minH: 20 });

  /** Auto-širina za kolonu "Naziv / opis" tako da se popuni preostali prostor stranice. */
  const fixedWidth = columnDefs
    .filter((c) => c.width > 0)
    .reduce((sum, c) => sum + c.width, 0);
  const remaining = Math.max(24, contentW - fixedWidth);
  const descIndex = columnDefs.findIndex((c) => c.head === "Naziv / opis");
  if (descIndex >= 0) {
    columnDefs[descIndex].width = remaining;
  }

  const barcodeColIndex = columnDefs.length - 1;
  const barcodeRasters = rows.map((r) => {
    const code = String(r.barcode ?? "").trim();
    if (!code) return null;
    try {
      return generateBarcodePngDataUrl(code);
    } catch {
      return null;
    }
  });

  const tableHead = columnDefs.map((c) => c.head);
  const tableBody = rows.map((r, idx) =>
    columnDefs.map((c, ci) => (ci === 0 ? String(idx + 1) : ci === barcodeColIndex ? " " : c.cell(r))),
  );
  const columnStyles: Record<number, { cellWidth: number; halign?: "left" | "center" | "right"; minCellHeight?: number }> = {};
  columnDefs.forEach((c, i) => {
    columnStyles[i] = {
      cellWidth: c.width,
      ...(c.align ? { halign: c.align } : {}),
      ...(c.minH != null ? { minCellHeight: c.minH } : {}),
    };
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [tableHead],
    body: tableBody,
    columnStyles,
    styles: {
      fontSize: 7.2,
      cellPadding: 1.5,
      valign: "middle",
      overflow: "linebreak",
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [40, 80, 130],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: 2.4,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
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

/** Jedan PDF za sve vanredne stavke istog dobavljača (jedan klik → jedan tab). */
export async function generateProcurementAdHocPdfForSupplierGroup(
  rows: ProcurementAdHocPdfRow[],
  supplierDisplayName: string,
): Promise<AdHocSupplierPdfResult> {
  const supplier = supplierDisplayName.trim() || "Nepoznat dobavljač";
  const blob = await generateAdHocSupplierPdf(rows, supplier);
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeSupplier = supplier.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_").slice(0, 30);
  return {
    supplier,
    blob,
    filename: `Vanredne_stavke_${safeSupplier}_${dateStr}.pdf`,
  };
}
