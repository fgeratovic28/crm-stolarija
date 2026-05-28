import { jsPDF } from "jspdf";
import {
  formatIpsAmount,
  generateIpsQrDataUri,
  IpsValidationError,
  normalizeBankAccount,
  normalizeReferenceNumber,
} from "nbs-ips-qr";
import { formatMoneyInputDisplay } from "@/lib/money-input";
import { openPdfBlobInNewTabOrDownload } from "@/lib/pdf-from-html";

/** Širina klasičnog obrasca uplatnice (mm). */
export const QUOTE_PAYMENT_SLIP_FORM_WIDTH_MM = 210;
export const QUOTE_PAYMENT_SLIP_HEIGHT_MM = 99;
/** Rezervisano desno od obrasca za IPS QR + oznaku (mm). */
export const QUOTE_PAYMENT_SLIP_QR_STRIP_MM = 30;

const UPLATNICA_TEMPLATE_FILENAME = "uplatnica.png";

let uplatnicaTemplateDataUriPromise: Promise<string> | null = null;

function publicAssetUrl(filename: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return `${normalized}${filename.replace(/^\//, "")}`;
}

async function loadUplatnicaTemplatePngDataUri(): Promise<string> {
  const url = publicAssetUrl(UPLATNICA_TEMPLATE_FILENAME);
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(`Šablon uplatnice nije učitan (${res.status}). Proverite da postoji ${UPLATNICA_TEMPLATE_FILENAME} u public/.`);
  }
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("Čitanje šablona uplatnice nije uspelo."));
    r.readAsDataURL(blob);
  });
}

function getUplatnicaTemplatePngDataUri(): Promise<string> {
  if (!uplatnicaTemplateDataUriPromise) {
    uplatnicaTemplateDataUriPromise = loadUplatnicaTemplatePngDataUri();
  }
  return uplatnicaTemplateDataUriPromise;
}

export type QuotePaymentSlipInput = {
  payerName: string;
  payerAddress: string;
  recipientName: string;
  recipientAddress: string;
  recipientAccount: string;
  paymentCode?: "289" | "189";
  currency?: "RSD";
  amount?: number;
  quoteNumber: string;
  /** Model (npr. 97) — prazno = ne štampa se na obrascu. */
  referenceModel?: string;
  /** Poziv na broj (bez modela na obrascu). */
  referenceNumber: string;
  /** Svrha uplate (tekst na obrascu i u IPS QR). */
  paymentPurpose: string;
};

export type QuotePaymentSlipGenerateOptions = {
  /** Uključi IPS QR kod (NBS); iznos u QR-u samo ako je prosleđen u inputu. */
  includeIpsQr?: boolean;
};

function resolveIpsAmount(input: QuotePaymentSlipInput): string {
  const amount = input.amount;
  if (amount != null && Number.isFinite(amount) && amount > 0) {
    return formatIpsAmount(amount);
  }
  return "RSD0,00";
}

function resolveSlipAmountDisplay(input: QuotePaymentSlipInput): string {
  const amount = input.amount;
  if (amount != null && Number.isFinite(amount) && amount > 0) {
    return formatMoneyInputDisplay(amount);
  }
  return "";
}

/** Helvetica na štampi nema ćirilicu — dinamički tekst na obrascu latinica bez dijakritika. */
const BLACK: [number, number, number] = [0, 0, 0];

function pdfSafeDynamic(s: string): string {
  return s
    .replace(/š/g, "s")
    .replace(/Š/g, "S")
    .replace(/č/g, "c")
    .replace(/Č/g, "C")
    .replace(/ć/g, "c")
    .replace(/Ć/g, "C")
    .replace(/ž/g, "z")
    .replace(/Ž/g, "Z")
    .replace(/đ/g, "dj")
    .replace(/Đ/g, "Dj")
    .replace(/љ/g, "lj")
    .replace(/Љ/g, "Lj")
    .replace(/њ/g, "nj")
    .replace(/Њ/g, "Nj")
    .replace(/ћ/g, "c")
    .replace(/Ћ/g, "C")
    .replace(/ђ/g, "dj")
    .replace(/Ђ/g, "Dj");
}

/** Iscrtava više redova sa fiksnim razmakom (mm). Vraća Y ispod poslednjeg reda. */
function paintLines(
  doc: jsPDF,
  lines: string[],
  x: number,
  yStart: number,
  lineStepMm: number,
  align: "left" | "right" | "center" = "left",
): number {
  let y = yStart;
  for (const line of lines) {
    if (line.trim().length === 0) {
      y += lineStepMm * 0.35;
      continue;
    }
    doc.text(line, x, y, { align, baseline: "top" });
    y += lineStepMm;
  }
  return y;
}

function drawTextInBoxCenter(
  doc: jsPDF,
  text: string,
  cellLeft: number,
  cellTop: number,
  cellW: number,
  cellH: number,
  fontSize: number,
  font: "courier" | "helvetica",
  style: "normal" | "bold" = "bold",
): void {
  doc.setFont(font, style);
  doc.setFontSize(fontSize);
  const cx = cellLeft + cellW / 2;
  const cy = cellTop + cellH / 2;
  doc.text(text, cx, cy, { align: "center", baseline: "middle" });
}

function truncateIpsName(name: string, address: string, maxLen: number): string {
  const combined = `${name.trim()}, ${address.trim()}`.trim();
  if (combined.length <= maxLen) return combined;
  return combined.slice(0, maxLen);
}

function buildIpsRo(modelRaw: string | undefined, referenceBody: string): string {
  const refBody = referenceBody.replace(/\|/g, "-").trim();
  const model = (modelRaw ?? "").trim().slice(0, 2);
  if (model.length > 0) {
    const ro = `${model.padStart(2, "0")}${refBody}`.slice(0, 35);
    return normalizeReferenceNumber(ro);
  }
  // Bez modela na obrascu: IPS mora imati model 00. Samo normalizeReferenceNumber(refBody)
  // pogrešno tumači npr. "22616" kao model 22 i pada validacija kontrolnog broja.
  const head = refBody.slice(0, 2);
  if (["97", "22", "11", "00"].includes(head) && refBody.length > 2) {
    return normalizeReferenceNumber(refBody.slice(0, 35));
  }
  return `00${refBody}`.slice(0, 35);
}

async function buildIpsQrPngDataUri(input: QuotePaymentSlipInput): Promise<string> {
  const r = normalizeBankAccount(input.recipientAccount.trim());
  const nRaw = truncateIpsName(input.recipientName.trim(), input.recipientAddress.trim(), 70);
  const sf = input.paymentCode ?? "289";
  const purposeRaw = input.paymentPurpose.trim() || `Uplata po ponudi br. ${input.quoteNumber.trim()}`;
  const s = purposeRaw.length > 35 ? purposeRaw.slice(0, 35) : purposeRaw;
  const ro = buildIpsRo(input.referenceModel, input.referenceNumber.trim());
  const ipsAmount = resolveIpsAmount(input);
  const qrOpts = { width: 360, errorCorrectionLevel: "M" as const, margin: 2 };
  try {
    return await generateIpsQrDataUri({ r, n: nRaw, i: ipsAmount, sf, s, ro }, qrOpts);
  } catch (e) {
    if (e instanceof IpsValidationError) {
      const n = pdfSafeDynamic(nRaw).slice(0, 70);
      return generateIpsQrDataUri({ r, n, i: ipsAmount, sf, s, ro }, qrOpts);
    }
    throw e;
  }
}

type DrawContext = {
  formWidthMm: number;
  templatePngDataUri: string;
  ipsQrPngDataUri?: string;
};

/** Dimenzije `public/uplatnica.png` (pikseli) — mapiranje px → mm na PDF 210×99. */
const UPLATNICA_TEMPLATE_PX = { w: 611, h: 305 } as const;

function templateLayoutMm(formWmm: number, Hmm: number) {
  const sx = formWmm / UPLATNICA_TEMPLATE_PX.w;
  const sy = Hmm / UPLATNICA_TEMPLATE_PX.h;
  return {
    x: (px: number) => px * sx,
    y: (py: number) => py * sy,
    sx,
    sy,
  };
}

function drawUplatnicaTemplateBackground(doc: jsPDF, formW: number, H: number, templatePngDataUri: string): void {
  doc.addImage(templatePngDataUri, "PNG", 0, 0, formW, H);
}

/**
 * Samo vrednosti polja + IPS QR; linije i natpisi su na PNG šablonu.
 * Pozicije (px → mm) ručno usklađene sa štampanim `public/uplatnica.png`.
 */
function drawPaymentSlipDataOverlay(doc: jsPDF, input: QuotePaymentSlipInput, ctx: DrawContext): void {
  const paymentCode = input.paymentCode ?? "289";
  const currency = input.currency ?? "RSD";
  const model = (input.referenceModel ?? "").trim();
  const purpose = pdfSafeDynamic(
    input.paymentPurpose.trim() || `Uplata po ponudi br. ${input.quoteNumber.trim()}`,
  );
  const poziv = pdfSafeDynamic(input.referenceNumber.trim() || input.quoteNumber.trim());
  const payerName = pdfSafeDynamic(input.payerName.trim()) || "—";
  const payerAddr = pdfSafeDynamic(input.payerAddress.trim()) || "—";
  const recName = pdfSafeDynamic(input.recipientName.trim()) || "—";
  const recAddr = pdfSafeDynamic(input.recipientAddress.trim()) || "—";
  const account = pdfSafeDynamic(input.recipientAccount.trim()) || "—";

  const formW = ctx.formWidthMm;
  const H = QUOTE_PAYMENT_SLIP_HEIGHT_MM;
  const L = templateLayoutMm(formW, H);
  const m = 2;
  const innerRight = formW - m;
  const contentPad = 2.8;

  /** Donja ivica glavnog polja pre futera (~y=266 px na šablonu). */
  const footTopMm = L.y(266);

  const dataFs = 10.5;
  const dataMonoFs = 10;
  const bodyLine = 3.75;

  const leftTextX = L.x(22);
  const leftTxtW = Math.max(14, L.x(274) - leftTextX);

  const paintLeft = (textStartPy: number, paragraphs: string[]) => {
    doc.setTextColor(BLACK[0], BLACK[1], BLACK[2]);
    doc.setFont("courier", "normal");
    doc.setFontSize(dataFs);
    let y = L.y(textStartPy);
    for (let i = 0; i < paragraphs.length; i += 1) {
      const lines = doc.splitTextToSize(paragraphs[i]!, leftTxtW);
      y = paintLines(doc, lines, leftTextX, y, bodyLine, "left");
      if (i < paragraphs.length - 1) y += 0.45;
    }
  };

  paintLeft(51, [payerName, payerAddr]);
  paintLeft(115, [purpose]);
  paintLeft(180,[recName, recAddr]);

  /* Desno: vertikala glavnog podela ~286 px; unutrašnje kolone ~287–329 | 330–456 | 457–601 px. */
  const rx = L.x(287);
  const wSif = L.x(329) - L.x(287);
  const wVal = L.x(456) - L.x(330);
  const wIzn = L.x(601) - L.x(457);
  const rightW = wSif + wVal + wIzn;

  /**
   * Desna kolona: šifra/RSD/iznos + model + poziv (pomeraji u px); račun primaoca fiksno ispod — ne pomerati.
   */
  const sifraCellLeft = rx + L.x(33);
  const sifraCellW = Math.max(L.x(3), wSif - L.x(35));
  const sifraCellTop = L.y(63);
  const sifraCellH = L.y(15);

  const valCellLeft = rx + wSif + L.x(0.8);
  const valCellW = Math.max(L.x(3), wVal - L.x(2.5));
  const valCellTop = L.y(60);
  const valCellH = L.y(11);

  const iznosCellLeft = rx + wSif + wVal + L.x(1);
  const iznosCellW = Math.max(L.x(3), wIzn - L.x(2));
  const iznosCellTop = L.y(60);
  const iznosCellH = L.y(15);

  const amountDisplay = pdfSafeDynamic(resolveSlipAmountDisplay(input));

  drawTextInBoxCenter(doc, paymentCode, sifraCellLeft, sifraCellTop, sifraCellW, sifraCellH, dataMonoFs, "courier", "bold");
  drawTextInBoxCenter(doc, currency, valCellLeft, valCellTop, valCellW, valCellH, dataMonoFs, "courier", "bold");
  drawTextInBoxCenter(
    doc,
    amountDisplay,
    iznosCellLeft,
    iznosCellTop,
    iznosCellW,
    iznosCellH,
    amountDisplay.length > 12 ? dataMonoFs - 2 : dataMonoFs - 1,
    "courier",
    "bold",
  );

  /* Račun primaoca — spušten u zonu gde je ranije bio poziv (~py 108–124). */
  doc.setTextColor(BLACK[0], BLACK[1], BLACK[2]);
  doc.setFont("courier", "normal");
  doc.setFontSize(dataMonoFs - 0.5);
  const racCellLeft = rx + L.x(5);
  const racCellW = Math.max(L.x(20), rightW - L.x(10));
  const racValueTop = L.y(110);
  const racValueH = Math.max(L.y(5), L.y(125) - L.y(110));
  const accOneLine = !account.includes("\n") && account.length <= 34;
  if (accOneLine) {
    drawTextInBoxCenter(doc, account, racCellLeft, racValueTop, racCellW, racValueH, dataMonoFs - 0.5, "courier", "normal");
  } else {
    const accLines = doc.splitTextToSize(account, racCellW - contentPad);
    paintLines(doc, accLines, racCellLeft + contentPad * 0.35, racValueTop + L.y(1.5), 3.35, "left");
  }

  /* Poziv na broj — fiksni py (ne menjati). Model (00) u istom vertikalnom redu, leva ćelija. */
  const pozValTop = L.y(159);
  const pozValH = Math.max(L.y(4), L.y(154) - L.y(149));

  const modelValTop = pozValTop;
  const modelValH = pozValH;
  const modelCellLeft = rx + L.x(25);
  const modelCellW = Math.max(L.x(3), wSif - L.x(14));

  if (model) {
    drawTextInBoxCenter(doc, model, modelCellLeft, modelValTop, modelCellW, modelValH, dataMonoFs, "courier", "bold");
  }

  doc.setTextColor(BLACK[0], BLACK[1], BLACK[2]);
  doc.setFont("courier", "normal");
  doc.setFontSize(dataFs);
  const pozCellLeft = rx + wSif + L.x(3.5);
  const pozCellW = Math.max(L.x(12), wVal + wIzn - L.x(8));
  const pozOneLine = !poziv.includes("\n") && poziv.length <= 44;
  if (pozOneLine) {
    drawTextInBoxCenter(doc, poziv, pozCellLeft, pozValTop, pozCellW, pozValH, dataFs, "courier", "normal");
  } else {
    const pozLines = doc.splitTextToSize(poziv, pozCellW - contentPad);
    paintLines(doc, pozLines, pozCellLeft + contentPad * 0.35, pozValTop + L.y(1.2), bodyLine, "left");
  }

  if (ctx.ipsQrPngDataUri) {
    const qrMm = 26;
    const qrPad = 1.2;
    const qrX = innerRight - qrMm - qrPad;
    const qrY = footTopMm - qrMm - 0.8;
    doc.addImage(ctx.ipsQrPngDataUri, "PNG", qrX, qrY, qrMm, qrMm);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(55, 55, 55);
    doc.text("IPS (NBS)", qrX + qrMm / 2, qrY - 1.2, { align: "center", baseline: "bottom" });
    doc.setTextColor(BLACK[0], BLACK[1], BLACK[2]);
  }
}

function drawPaymentSlip(doc: jsPDF, input: QuotePaymentSlipInput, ctx: DrawContext): void {
  const formW = ctx.formWidthMm;
  const H = QUOTE_PAYMENT_SLIP_HEIGHT_MM;
  drawUplatnicaTemplateBackground(doc, formW, H, ctx.templatePngDataUri);
  drawPaymentSlipDataOverlay(doc, input, ctx);
}

export async function generateQuotePaymentSlipPdfBlob(
  input: QuotePaymentSlipInput,
  options?: QuotePaymentSlipGenerateOptions,
): Promise<Blob> {
  const includeQr = options?.includeIpsQr === true;

  const formW = QUOTE_PAYMENT_SLIP_FORM_WIDTH_MM;

  let ipsQrPngDataUri: string | undefined;
  if (includeQr) {
    try {
      ipsQrPngDataUri = await buildIpsQrPngDataUri(input);
    } catch (e) {
      const msg =
        e instanceof IpsValidationError
          ? e.message
          : e instanceof Error
            ? e.message
            : "IPS QR nije moguce generisati.";
      throw new Error(msg);
    }
  }

  const templatePngDataUri = await getUplatnicaTemplatePngDataUri();

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [QUOTE_PAYMENT_SLIP_FORM_WIDTH_MM, QUOTE_PAYMENT_SLIP_HEIGHT_MM],
    compress: true,
  });
  drawPaymentSlip(doc, input, { formWidthMm: formW, templatePngDataUri, ipsQrPngDataUri });
  return doc.output("blob");
}

export function quotePaymentSlipFilename(quoteNumber: string): string {
  const safe = quoteNumber.trim().replace(/[^\w\u0400-\u04FF-]+/g, "_") || "ponuda";
  return `Uplatnica_${safe}.pdf`;
}

export function openQuotePaymentSlipPdf(blob: Blob, quoteNumber: string, targetWindow?: Window | null): void {
  openPdfBlobInNewTabOrDownload(blob, quotePaymentSlipFilename(quoteNumber), targetWindow);
}

export function quotePaymentSlipBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("Čitanje PDF-a nije uspelo."));
    r.readAsDataURL(blob);
  });
}
