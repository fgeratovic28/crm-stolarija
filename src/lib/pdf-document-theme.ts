/**
 * Zajednički izgled štampanih / PDF dokumenata iz CRM-a (terenski izveštaj, radni nalog, ponuda, finansije).
 * Narudžbenica / porudžbenica koristi poseban `NARUDZBENICA_CSS` u `narudzbenica-html.ts` — ovde se ne menja.
 */
export const PDF_DOCUMENT_STYLES = `
  @page { size: A4; margin: 12mm 14mm 14mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    padding: 0;
    font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    font-size: 11px;
    color: #0f172a;
    line-height: 1.5;
    background: #fff;
  }
  .doc-wrap {
    max-width: 100%;
    padding: 0 2px;
  }
  .doc-sheet {
    max-width: 178mm;
    margin: 0 auto;
  }
  .doc-memorandum {
    margin: 0 0 14px 0;
    padding: 0 0 10px 0;
    border-bottom: 1px solid #e2e8f0;
    line-height: 0;
    text-align: center;
  }
  .doc-memorandum img {
    display: block;
    width: auto;
    max-width: min(168mm, 100%);
    max-height: 36mm;
    height: auto;
    margin: 0 auto;
    object-fit: contain;
    object-position: center center;
  }
  .doc-accent {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(90deg, #0c1e2e 0%, #1e4d7a 42%, #3b82f6 100%);
    margin: 0 0 2px 0;
  }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    padding: 14px 0 16px;
    border-bottom: 1px solid #e2e8f0;
  }
  .doc-brand { flex: 1; min-width: 0; }
  .doc-brand-line {
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 8px;
  }
  .doc-title {
    font-size: 22px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 8px 0;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }
  .doc-lead { font-size: 12.5px; color: #475569; margin: 0 0 5px 0; line-height: 1.45; }
  .doc-meta-right {
    text-align: right;
    flex-shrink: 0;
    font-size: 10px;
    color: #64748b;
    line-height: 1.55;
    padding: 4px 0 0 12px;
    border-left: 1px solid #f1f5f9;
    min-width: 118px;
  }
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

  .section { margin-top: 18px; page-break-inside: avoid; }
  .section-title {
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #94a3b8;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 2px solid #f1f5f9;
  }
  .card {
    background: linear-gradient(180deg, #fafbfc 0%, #f8fafc 100%);
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px 16px;
    box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 28px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 16px; }
  .field-label {
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #94a3b8;
  }
  .field-value { font-size: 12px; color: #0f172a; margin-top: 4px; word-break: break-word; }
  .badge-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .badge {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .badge-ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .badge-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .badge-bad { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .badge-neutral { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
  .badge-info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
  .alert {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 12px;
    border-left: 4px solid #ef4444;
  }
  .alert-title { font-weight: 700; color: #991b1b; margin-bottom: 6px; font-size: 11px; }
  .tag {
    display: inline-block;
    background: #fff1f2;
    color: #9f1239;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 500;
    margin: 3px 6px 3px 0;
    border: 1px solid #fecdd3;
  }
  .note-box {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
  }
  .doc-list {
    margin: 0;
    padding-left: 20px;
    color: #334155;
    font-size: 12px;
    line-height: 1.55;
  }
  .doc-list li { margin: 4px 0; padding-left: 2px; }
  .sign-row {
    margin-top: 32px;
    padding-top: 18px;
    border-top: 1px solid #e2e8f0;
    page-break-inside: avoid;
  }
  .sign-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  .sign-line { border-bottom: 1px solid #64748b; height: 40px; margin-top: 8px; }
  .footer {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    font-size: 9px;
    color: #94a3b8;
    text-align: center;
    letter-spacing: 0.02em;
  }
  .photo-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .photo-grid img {
    max-width: 172px;
    max-height: 172px;
    object-fit: cover;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  }

  /* Tabele (ponuda) — ne utiče na narudžbenicu */
  .doc-table-wrap {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    background: #fff;
  }
  table.doc-data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }
  table.doc-data-table thead {
    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  }
  table.doc-data-table th {
    text-align: left;
    padding: 10px 12px;
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
  }
  table.doc-data-table th.num,
  table.doc-data-table td.num {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  table.doc-data-table tbody tr:nth-child(even) { background: #fafbfc; }
  table.doc-data-table td {
    padding: 10px 12px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
    color: #0f172a;
  }
  table.doc-data-table tbody tr:last-child td { border-bottom: none; }
  table.doc-data-table .doc-empty-row td {
    text-align: center;
    color: #94a3b8;
    font-style: italic;
    padding: 20px;
  }
  .doc-total-panel {
    margin-top: 14px;
    display: flex;
    justify-content: flex-end;
  }
  .doc-total-box {
    min-width: 220px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 16px;
    background: #f8fafc;
    text-align: right;
  }
  .doc-total-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; }
  .doc-total-value { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 4px; letter-spacing: -0.02em; }
  .doc-total-currency { font-size: 11px; font-weight: 600; color: #64748b; margin-left: 4px; }

  /* Ponuda: izdavalac / kupac */
  .doc-parties-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 4px;
  }
  .doc-party-label {
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #94a3b8;
    margin: 0 0 8px 0;
  }
  .doc-party-body p { margin: 3px 0; font-size: 11px; line-height: 1.5; color: #475569; }
  .doc-party-body strong { color: #0f172a; font-weight: 600; }
  .doc-party-hint { font-size: 10px; color: #94a3b8; font-style: italic; margin: 0; }

  /* Finansijski pregled (landscape) */
  table.fin-data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  table.fin-data-table thead {
    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  }
  table.fin-data-table th {
    text-align: left;
    padding: 9px 11px;
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
  }
  table.fin-data-table th.fin-num { text-align: right; }
  table.fin-data-table tbody tr:nth-child(even) { background: #fafbfc; }
  table.fin-data-table td {
    padding: 9px 11px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
    color: #0f172a;
  }
  table.fin-data-table td.fin-num { text-align: right; font-variant-numeric: tabular-nums; }
  table.fin-data-table td.fin-ok { color: #047857; font-weight: 600; }
  table.fin-data-table td.fin-warn { color: #b91c1c; font-weight: 600; }
`;
