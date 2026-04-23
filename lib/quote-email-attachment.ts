export type QuoteAttachmentInput = {
  quoteNumber: string;
  pdfBase64?: string;
  pdfUrl?: string;
  attachmentUrl?: string;
};

export type QuoteAttachmentOutput = {
  filename: string;
  content: string;
};

function normalizeBase64(value: string): string {
  const trimmed = value.trim();
  const marker = "base64,";
  const markerIndex = trimmed.indexOf(marker);
  if (markerIndex >= 0) {
    return trimmed.slice(markerIndex + marker.length).trim();
  }
  return trimmed;
}

async function fetchPdfAsBase64(fileUrl: string): Promise<string> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`PDF nije dostupan na URL-u (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes).toString("base64");
}

export async function buildQuotePdfAttachment(
  input: QuoteAttachmentInput,
): Promise<QuoteAttachmentOutput> {
  const sourceUrl = input.pdfUrl?.trim() || input.attachmentUrl?.trim() || "";
  let content = input.pdfBase64?.trim() || "";

  if (content.length === 0) {
    if (!sourceUrl) {
      throw new Error("Nedostaje PDF sadržaj: prosledite pdfBase64 ili pdfUrl.");
    }
    content = await fetchPdfAsBase64(sourceUrl);
  } else {
    content = normalizeBase64(content);
  }

  if (!content) {
    throw new Error("PDF prilog nije validan.");
  }

  return {
    filename: `Ponuda-${input.quoteNumber}.pdf`,
    content,
  };
}
