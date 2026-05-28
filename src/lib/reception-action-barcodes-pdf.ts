import { jsPDF } from "jspdf";
import { generateBarcodePngDataUrl } from "@/lib/material-order-procurement-pdf";
import {
  ITEM_RECEPTION_CANCEL_BARCODE,
  ITEM_RECEPTION_CONFIRM_BARCODE,
  ORDER_RECEPTION_FINALIZE_BARCODE,
  RECEPTION_ACTION_BARCODE_ROWS,
} from "@/lib/item-reception-modal-barcodes";

export async function generateReceptionActionBarcodesPdfBlob(): Promise<Blob> {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  const contentW = pageW - 2 * margin;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Barkodovi za prijem materijala", pageW / 2, margin, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80);
  doc.text(
    "Odstampajte i postavite na radno mesto magacina. Skenirajte USB citacem (Code128).",
    pageW / 2,
    margin + 7,
    { align: "center" },
  );
  doc.setTextColor(0);

  let y = margin + 16;
  const boxH = 58;

  for (const row of RECEPTION_ACTION_BARCODE_ROWS) {
    doc.setDrawColor(190);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentW, boxH, 2, 2);

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(row.label, margin + 6, y + 10);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    doc.text(row.hint, margin + 6, y + 16);
    doc.setTextColor(0);

    const raster = generateBarcodePngDataUrl(row.code);
    const barW = Math.min(contentW - 20, 130);
    const barH = Math.min(22, barW / Math.max(raster.aspect, 0.4));
    const barX = margin + (contentW - barW) / 2;
    doc.addImage(raster.dataUrl, "PNG", barX, y + 21, barW, barH);

    doc.setFont("courier", "bold");
    doc.setFontSize(12);
    doc.text(row.code, pageW / 2, y + boxH - 5, { align: "center" });

    y += boxH + 9;
  }

  return doc.output("blob");
}

export async function openReceptionActionBarcodesPdf(): Promise<void> {
  const { openPdfBlobInNewTabOrDownload } = await import("@/lib/pdf-from-html");
  const blob = await generateReceptionActionBarcodesPdfBlob();
  openPdfBlobInNewTabOrDownload(blob, "magacin-prijem-barkodovi.pdf");
}
