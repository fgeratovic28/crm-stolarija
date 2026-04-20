/**
 * PDF iz HTML-a — jspdf i html2canvas se učitavaju dinamički da Vite ne pravi
 * problem sa kešem („Outdated Optimize Dep” / 504 na deps).
 *
 * Podrazumevano: umerena rezolucija + JPEG umesto PNG da PDF bude znatno manji.
 */
export type HtmlToPdfOptions = {
  /** html2canvas scale (1 = manji fajl, 2 = oštrije). Podrazumevano 1.15. */
  scale?: number;
  /** Kvalitet JPEG 0–1. Podrazumevano 0.82. */
  jpegQuality?: number;
};

export async function htmlDocumentToPdfBlob(html: string, options?: HtmlToPdfOptions): Promise<Blob> {
  const [{ default: html2canvas }, jspdfMod] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const { jsPDF } = jspdfMod;

  const scale = options?.scale ?? 1.15;
  const jpegQuality = options?.jpegQuality ?? 0.82;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-12000px",
    top: "0",
    width: "820px",
    border: "none",
    background: "#fff",
  });
  document.body.appendChild(iframe);
  const w = iframe.contentWindow!;
  const d = w.document;
  d.open();
  d.write(html);
  d.close();

  await new Promise((r) => setTimeout(r, 500));

  const body = d.body;
  const canvas = await html2canvas(body, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    windowWidth: body.scrollWidth,
    windowHeight: body.scrollHeight,
  });

  document.body.removeChild(iframe);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgData = canvas.toDataURL("image/jpeg", jpegQuality);
  const imgWidth = pdfWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight, undefined, "MEDIUM");
  heightLeft -= pdfHeight;

  while (heightLeft > 1) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight, undefined, "MEDIUM");
    heightLeft -= pdfHeight;
  }

  return pdf.output("blob");
}
