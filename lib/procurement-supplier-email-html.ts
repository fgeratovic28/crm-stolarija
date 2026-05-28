function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToHtml(text: string): string {
  return escapeHtml(text).replaceAll("\r\n", "\n").replaceAll("\n", "<br/>");
}

export type ProcurementSupplierEmailParts = {
  message: string;
  signature: string;
};

/** Profesionalan HTML mejl: telo poruke + stilizovan footer potpis. */
export function buildProcurementSupplierEmailHtml(parts: ProcurementSupplierEmailParts): string {
  const message = parts.message.trim();
  const signature = parts.signature.trim();

  const messageHtml = message
    ? `<div style="font-size:15px;line-height:1.6;color:#1e293b;">${plainTextToHtml(message)}</div>`
    : "";

  const signatureHtml = signature
    ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:14px;line-height:1.55;color:#475569;">
        ${plainTextToHtml(signature)}
      </div>`
    : "";

  return `<!doctype html>
<html lang="sr">
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;">
    ${messageHtml}
    ${signatureHtml}
  </body>
</html>`;
}
