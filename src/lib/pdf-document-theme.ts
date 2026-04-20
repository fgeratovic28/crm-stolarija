/**
 * Zajednički izgled štampanih / PDF dokumenata (terenski izveštaj, radni nalog, narudžbina).
 */
export const PDF_DOCUMENT_STYLES = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 11.5px;
    color: #0f172a;
    line-height: 1.45;
    background: #fff;
  }
  .doc-wrap { max-width: 100%; }
  .doc-accent {
    height: 5px;
    border-radius: 0 0 4px 4px;
    background: linear-gradient(90deg, #0c1e2e 0%, #1e4d7a 45%, #2d6a9f 100%);
    margin: 0 0 0 0;
  }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    padding: 18px 0 14px;
    border-bottom: 1px solid #e2e8f0;
  }
  .doc-brand { flex: 1; min-width: 0; }
  .doc-brand-line {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 6px;
  }
  .doc-title {
    font-size: 20px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 6px 0;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .doc-lead { font-size: 12px; color: #475569; margin: 0 0 4px 0; }
  .doc-meta-right { text-align: right; flex-shrink: 0; font-size: 10px; color: #64748b; line-height: 1.5; }
  .doc-meta-right strong { color: #334155; font-weight: 600; }
  .doc-qr {
    flex-shrink: 0;
    text-align: center;
    padding: 4px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
  }
  .doc-qr img { width: 96px; height: 96px; display: block; border-radius: 4px; }
  .doc-qr-cap { font-size: 8px; color: #64748b; margin-top: 6px; max-width: 112px; line-height: 1.3; }

  .section { margin-top: 16px; }
  .section-title {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #94a3b8;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #f1f5f9;
  }
  .card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 22px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 16px; }
  .field-label {
    font-size: 8.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #94a3b8;
  }
  .field-value { font-size: 12px; color: #0f172a; margin-top: 2px; word-break: break-word; }
  .badge-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .badge {
    display: inline-block;
    padding: 4px 11px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
  }
  .badge-ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .badge-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .badge-bad { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .badge-neutral { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
  .alert {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .alert-title { font-weight: 700; color: #991b1b; margin-bottom: 4px; font-size: 11px; }
  .tag {
    display: inline-block;
    background: #fff1f2;
    color: #9f1239;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 500;
    margin: 2px 4px 2px 0;
    border: 1px solid #fecdd3;
  }
  .note-box {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    white-space: pre-wrap;
  }
  .sign-row {
    margin-top: 28px;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
  }
  .sign-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .sign-line { border-bottom: 1px solid #94a3b8; height: 36px; margin-top: 6px; }
  .footer {
    margin-top: 22px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 9px;
    color: #94a3b8;
    text-align: center;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #f1f5f9; }
  th { font-weight: 600; color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; }
  .photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .photo-grid img {
    max-width: 168px;
    max-height: 168px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }
`;
