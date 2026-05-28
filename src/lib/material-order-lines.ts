import { labelMaterialType } from "@/lib/activity-labels";
import { parseMaterialOrderItemsJson } from "@/lib/material-order-items-json";
import type { MaterialOrder, MaterialOrderLine, MaterialType } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseProcurementMetaFromLineJson(o: Record<string, unknown>): MaterialOrderLine["procurementMeta"] | undefined {
  const metaRaw = o.procurementMeta;
  if (!metaRaw || typeof metaRaw !== "object" || Array.isArray(metaRaw)) return undefined;
  const m = metaRaw as Record<string, unknown>;
  const article = String(m.article ?? "").trim();
  const str = (k: string) => (m[k] != null ? String(m[k]).trim() : "");
  const wo = str("work_order");
  const pos = str("position");
  const ac = str("article_code");
  const col = str("color");
  const uom = str("uom");
  if (!article && !ac && !wo && !pos && !col && !uom) return undefined;
  const lenRaw = m.length_mm;
  let length_mm: number | null = null;
  if (lenRaw !== undefined && lenRaw !== null && String(lenRaw).trim() !== "") {
    const n = Number(lenRaw);
    length_mm = Number.isFinite(n) ? Math.round(n) : null;
  }
  const mlRaw = m.manual_line;
  let manual_line: boolean | undefined;
  if (mlRaw === true || mlRaw === "true" || mlRaw === 1) manual_line = true;
  else if (mlRaw === false || mlRaw === "false" || mlRaw === 0) manual_line = false;
  return {
    ...(wo ? { work_order: wo } : {}),
    ...(pos ? { position: pos } : {}),
    ...(ac ? { article_code: ac } : {}),
    article: article || "—",
    ...(col ? { color: col } : {}),
    ...(uom ? { uom: uom } : {}),
    length_mm,
    ...(manual_line !== undefined ? { manual_line } : {}),
  };
}

/** Shapes `procurementMeta` for JSON persistence on `nb_lines`. */
export function procurementMetaForNbLinesJson(
  meta: NonNullable<MaterialOrderLine["procurementMeta"]>,
): NonNullable<MaterialOrderLine["procurementMeta"]> {
  const article = String(meta.article ?? "").trim() || "—";
  return {
    ...(meta.work_order?.trim() ? { work_order: meta.work_order.trim() } : {}),
    ...(meta.position?.trim() ? { position: meta.position.trim() } : {}),
    ...(meta.article_code?.trim() ? { article_code: meta.article_code.trim() } : {}),
    article,
    ...(meta.color?.trim() ? { color: meta.color.trim() } : {}),
    ...(meta.uom?.trim() ? { uom: meta.uom.trim() } : {}),
    length_mm:
      meta.length_mm != null && Number.isFinite(meta.length_mm) ? meta.length_mm : null,
    ...(meta.manual_line === true || meta.manual_line === false ? { manual_line: meta.manual_line } : {}),
  };
}


/** Parsiranje JSON kolone `nb_lines` iz Supabase-a. */
export function parseNbLinesJson(raw: unknown): MaterialOrderLine[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;
  const lines: MaterialOrderLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const description = String(o.description ?? "").trim();
    const quantity = Math.max(0.0001, Number(o.quantity) || 0.0001);
    const unit = String(o.unit ?? "kom").trim() || "kom";
    const lineNet = roundMoney(Number(o.lineNet ?? o.line_net ?? 0));
    const materialType = o.materialType as MaterialOrderLine["materialType"] | undefined;
    const rawSourceIds = o.sourceJobItemIds;
    const sourceJobItemIds = Array.isArray(rawSourceIds)
      ? rawSourceIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : undefined;
    const orderedQtyRaw = o.orderedQuantity;
    const orderedQuantity =
      orderedQtyRaw != null && Number.isFinite(Number(orderedQtyRaw)) ? Number(orderedQtyRaw) : undefined;
    const procurementMeta = parseProcurementMetaFromLineJson(o);
    const shortageSource = parseShortageSourceFromLineJson(o);
    if (!description && lineNet <= 0) continue;
    lines.push({
      description: description || "—",
      quantity,
      unit,
      lineNet,
      ...(procurementMeta ? { procurementMeta } : {}),
      ...(materialType ? { materialType } : {}),
      ...(sourceJobItemIds && sourceJobItemIds.length > 0 ? { sourceJobItemIds } : {}),
      ...(orderedQuantity != null ? { orderedQuantity } : {}),
      ...(shortageSource ? { shortageSource } : {}),
    });
  }
  return lines.length > 0 ? lines : undefined;
}

/** Čita `shortage_source` (snake_case) ili `shortageSource` (camelCase) iz `nb_lines` JSON-a. */
function parseShortageSourceFromLineJson(
  o: Record<string, unknown>,
): MaterialOrderLine["shortageSource"] | undefined {
  const raw = (o.shortage_source ?? o.shortageSource) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const parentOrderId = String(raw.parent_order_id ?? raw.parentOrderId ?? "").trim();
  if (!parentOrderId) return undefined;
  const parentLineIndexRaw = Number(raw.parent_line_index ?? raw.parentLineIndex ?? -1);
  if (!Number.isFinite(parentLineIndexRaw) || parentLineIndexRaw < 0) return undefined;
  const missingQty = Number(raw.missing_qty ?? raw.missingQty ?? 0) || 0;
  const damagedQty = Number(raw.damaged_qty ?? raw.damagedQty ?? 0) || 0;
  const complaintId = String(raw.complaint_id ?? raw.complaintId ?? "").trim();
  return {
    parentOrderId,
    parentLineIndex: Math.round(parentLineIndexRaw),
    missingQty,
    damagedQty,
    ...(complaintId ? { complaintId } : {}),
  };
}

/**
 * Jedinstvena lista stavki za štampu: `nb_lines` ili stara jedna stavka iz kolona / cene.
 */
export function normalizeOrderLines(order: MaterialOrder): MaterialOrderLine[] {
  const nb = order.nbLines;
  const parsed = Array.isArray(nb) && nb.length > 0 ? nb : undefined;
  if (parsed && parsed.length > 0) {
    /** Backfill `article_code` iz sačuvanog smart Excel JSON-a kad `nb_lines` meta nema šifru —
     *  npr. starije porudžbine sačuvane pre nego što su šifre upisane u tabelu, a sad postoje u `items_json`. */
    const smart = parseMaterialOrderItemsJson(order.itemsJson);
    return parsed.map((l, index) => {
      const meta = l.procurementMeta;
      const codeFromMeta = meta?.article_code?.trim() ?? "";
      const smartRow = smart?.rows?.[index];
      const codeFromSmart =
        codeFromMeta.length === 0 && smartRow && smart?.sifraColumnKey
          ? String(smartRow[smart.sifraColumnKey] ?? "").trim()
          : "";
      const effectiveMeta =
        codeFromMeta.length === 0 && codeFromSmart.length > 0
          ? {
              ...(meta ?? { article: l.description?.trim() || "—", length_mm: null }),
              article: meta?.article?.trim() || l.description?.trim() || "—",
              article_code: codeFromSmart,
            }
          : meta;
      return {
        description: (l.description ?? "").trim() || "—",
        quantity: Math.max(0.0001, Number(l.quantity) || 0.0001),
        unit: (l.unit ?? "kom").trim() || "kom",
        lineNet: roundMoney(Number(l.lineNet) || 0),
        /** Uvek zadrži meta iz `nb_lines` (RN/šifra/manual_line); inače se barkod pri prijemu razlikuje od PDF-a. */
        ...(effectiveMeta ? { procurementMeta: effectiveMeta } : {}),
        ...(l.materialType ? { materialType: l.materialType } : {}),
        ...(l.sourceJobItemIds && l.sourceJobItemIds.length > 0 ? { sourceJobItemIds: l.sourceJobItemIds } : {}),
        ...(l.orderedQuantity != null && Number.isFinite(l.orderedQuantity)
          ? { orderedQuantity: l.orderedQuantity }
          : {}),
        ...(l.shortageSource ? { shortageSource: l.shortageSource } : {}),
      };
    });
  }

  const net = roundMoney(Number(order.price ?? order.supplierPrice ?? 0));
  const qty = Math.max(0.0001, Number(order.nbQuantity ?? 1));
  const desc =
    order.nbLineDescription?.trim() ||
    `${labelMaterialType(order.materialType)}${order.barcode ? ` (ref. ${order.barcode})` : ""}`;

  if (net === 0 && !order.nbLineDescription?.trim()) {
    return [];
  }

  return [
    {
      description: desc,
      quantity: qty,
      unit: order.nbUnit?.trim() || "kom",
      lineNet: net,
      materialType: order.materialType,
    },
  ];
}

/**
 * Stavke iz RPC `get_public_narudzbenica` (isti JSON kao `nb_lines` u bazi).
 */
export function linesFromPublicRpcRow(row: Record<string, unknown>): MaterialOrderLine[] {
  const raw = row.nbLines ?? row.nb_lines;
  const orderMt = (row.materialType ?? row.material_type) as MaterialType | undefined;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((item) => {
      const o = item as Record<string, unknown>;
      const lineMt = (o.materialType as MaterialType | undefined) ?? orderMt;
      const procurementMeta = parseProcurementMetaFromLineJson(o);
      return {
        description: String(o.description ?? "").trim() || "—",
        quantity: Math.max(0.0001, Number(o.quantity) || 1),
        unit: String(o.unit ?? "kom"),
        lineNet: roundMoney(Number(o.lineNet ?? o.line_net ?? 0)),
        ...(procurementMeta ? { procurementMeta } : {}),
        ...(lineMt ? { materialType: lineMt } : {}),
      };
    });
  }
  const price = Number(row.price ?? 0);
  const qty = Math.max(0.0001, Number(row.nbQuantity ?? 1));
  const materialLabel = labelMaterialType(String(row.materialType ?? "other"));
  const itemName =
    (row.nbLineDescription && String(row.nbLineDescription).trim()) ||
    materialLabel + (row.barcode ? ` (ref. ${String(row.barcode)})` : "");
  return [
    {
      description: itemName,
      quantity: qty,
      unit: row.nbUnit ? String(row.nbUnit) : "kom",
      lineNet: roundMoney(price),
      ...(orderMt ? { materialType: orderMt } : {}),
    },
  ];
}

export function sumOrderLinesNet(lines: MaterialOrderLine[]): number {
  if (!Array.isArray(lines)) return 0;
  return roundMoney(lines.reduce((s, l) => s + (Number(l.lineNet) || 0), 0));
}
