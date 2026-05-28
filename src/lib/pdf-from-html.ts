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

  const scale = options?.scale ?? 1.35;
  const jpegQuality = options?.jpegQuality ?? 0.82;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-12000px",
    top: "0",
    width: "900px",
    border: "none",
    background: "#fff",
  });
  document.body.appendChild(iframe);
  const w = iframe.contentWindow!;
  const d = w.document;
  d.open();
  d.write(html);
  d.close();

  const settleDocument = async () => {
    const imgs = Array.from(d.images);
    await Promise.all(
      imgs.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }),
      ),
    );
    try {
      await d.fonts?.ready;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
  };
  await settleDocument();

  const body = d.body;
  const canvas = await html2canvas(body, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    windowWidth: Math.max(body.scrollWidth, 880),
    windowHeight: body.scrollHeight,
    onclone: (clonedDoc) => {
      const root = clonedDoc.body;
      if (!root) return;
      root.style.overflow = "visible";
      root.style.height = "auto";
      root.querySelectorAll("table.nb-t").forEach((node) => {
        const t = node as HTMLTableElement;
        t.style.tableLayout = "fixed";
        t.style.width = "100%";
        t.style.borderCollapse = "collapse";
      });
    },
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

export type HtmlToFixedSizePdfOptions = {
  /** Širina stranice u mm (npr. 99 za standardnu uplatnicu). */
  widthMm: number;
  /** Visina stranice u mm (npr. 210). */
  heightMm: number;
  /** html2canvas scale. Podrazumevano 2 (čitljivije sitno slovo). */
  scale?: number;
  jpegQuality?: number;
  /** Širina iframe-a u px; držati blizu renderovane širine sadržaja. */
  iframeWidthPx?: number;
};

/**
 * Jedna PDF stranica tačnog formata (npr. uplatnica 99×210 mm) iz HTML-a.
 * Koristi isti iframe + html2canvas pristup kao `htmlDocumentToPdfBlob`.
 */
export async function htmlToFixedSizePdfBlob(
  html: string,
  options: HtmlToFixedSizePdfOptions,
): Promise<Blob> {
  const [{ default: html2canvas }, jspdfMod] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const { jsPDF } = jspdfMod;

  const widthMm = options.widthMm;
  const heightMm = options.heightMm;
  const scale = options.scale ?? 2;
  const jpegQuality = options.jpegQuality ?? 0.88;
  const iframeWidthPx = options.iframeWidthPx ?? 420;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-12000px",
    top: "0",
    width: `${iframeWidthPx}px`,
    border: "none",
    background: "#fff",
  });
  document.body.appendChild(iframe);
  const w = iframe.contentWindow!;
  const d = w.document;
  d.open();
  d.write(html);
  d.close();

  const settleDocument = async () => {
    const imgs = Array.from(d.images);
    await Promise.all(
      imgs.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }),
      ),
    );
    try {
      await d.fonts?.ready;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 350));
  };
  await settleDocument();

  const body = d.body;
  const canvas = await html2canvas(body, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    windowWidth: Math.max(body.scrollWidth, 120),
    windowHeight: Math.max(body.scrollHeight, 120),
    onclone: (clonedDoc) => {
      const root = clonedDoc.body;
      if (!root) return;
      root.style.margin = "0";
      root.style.padding = "0";
      root.style.overflow = "hidden";
      root.querySelectorAll("table.nb-t").forEach((node) => {
        const t = node as HTMLTableElement;
        t.style.tableLayout = "fixed";
        t.style.width = "100%";
        t.style.borderCollapse = "collapse";
      });
    },
  });

  document.body.removeChild(iframe);

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [widthMm, heightMm],
    compress: true,
  });
  const imgData = canvas.toDataURL("image/jpeg", jpegQuality);
  pdf.addImage(imgData, "JPEG", 0, 0, widthMm, heightMm, undefined, "FAST");
  return pdf.output("blob");
}

/**
 * Otvara PDF u novom tabu (viewer) ili u istom tabu ako je popup blokiran.
 * Ako prosledite već otvoren `Window` (rezervisan na user-click), izbegava blank tab.
 */
export function openPdfBlobInNewTabOrDownload(blob: Blob, filename: string, targetWindow?: Window | null): void {
  const blobUrl = URL.createObjectURL(blob);
  const safeName = filename.replace(/"/g, "&quot;");
  const viewerHtml = `<!doctype html>
<html lang="sr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeName}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #111827; color: #f9fafb; font-family: system-ui, sans-serif; }
      .bar { height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px; background: #1f2937; border-bottom: 1px solid #374151; }
      .title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .btn { appearance: none; border: 1px solid #6b7280; background: #111827; color: #f9fafb; border-radius: 8px; padding: 6px 10px; font-size: 12px; text-decoration: none; }
      .frame { width: 100%; height: calc(100% - 52px); border: 0; background: #fff; }
      .fallback { display: none; height: calc(100% - 52px); padding: 16px; background: #0f172a; color: #e5e7eb; }
      .fallback p { margin: 0 0 12px; font-size: 14px; line-height: 1.4; }
    </style>
  </head>
  <body>
    <div class="bar">
      <div class="title">${safeName}</div>
      <a class="btn" href="${blobUrl}" download="${safeName}">Preuzmi PDF</a>
    </div>
    <iframe id="pdf-frame" class="frame" src="${blobUrl}" title="${safeName}"></iframe>
    <div id="pdf-fallback" class="fallback">
      <p>Pregled PDF-a nije dostupan u ovom browseru. Možete ga otvoriti ili preuzeti ručno.</p>
      <a class="btn" href="${blobUrl}" target="_blank" rel="noopener">Otvori PDF</a>
    </div>
    <script>
      (function () {
        var frame = document.getElementById("pdf-frame");
        var fallback = document.getElementById("pdf-fallback");
        if (!frame || !fallback) return;
        var shown = false;
        var showFallback = function () {
          if (shown) return;
          shown = true;
          frame.style.display = "none";
          fallback.style.display = "block";
        };
        frame.addEventListener("error", showFallback);
        setTimeout(function () {
          try {
            var ok = frame && frame.contentWindow;
            if (!ok) showFallback();
          } catch (_e) {
            showFallback();
          }
        }, 4000);
      })();
    </script>
  </body>
</html>`;
  const viewerBlob = new Blob([viewerHtml], { type: "text/html" });
  const viewerUrl = URL.createObjectURL(viewerBlob);

  let w = targetWindow ?? null;
  try {
    if (w && !w.closed) {
      w.location.href = viewerUrl;
    } else {
      w = window.open(viewerUrl, "_blank");
    }
  } catch {
    w = window.open(viewerUrl, "_blank");
  }
  if (!w) {
    window.location.href = viewerUrl;
  }
  window.setTimeout(() => URL.revokeObjectURL(viewerUrl), 120_000);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
}
