import { labelMaterialType } from "@/lib/activity-labels";
import type { MaterialOrder, MaterialOrderLine } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
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
    if (!description && lineNet <= 0) continue;
    lines.push({
      description: description || "—",
      quantity,
      unit,
      lineNet,
      ...(materialType ? { materialType } : {}),
    });
  }
  return lines.length > 0 ? lines : undefined;
}

/**
 * Jedinstvena lista stavki za štampu: `nb_lines` ili stara jedna stavka iz kolona / cene.
 */
export function normalizeOrderLines(order: MaterialOrder): MaterialOrderLine[] {
  const parsed = order.nbLines && order.nbLines.length > 0 ? order.nbLines : undefined;
  if (parsed && parsed.length > 0) {
    return parsed.map((l) => ({
      description: (l.description ?? "").trim() || "—",
      quantity: Math.max(0.0001, Number(l.quantity) || 0.0001),
      unit: (l.unit ?? "kom").trim() || "kom",
      lineNet: roundMoney(Number(l.lineNet) || 0),
      ...(l.materialType ? { materialType: l.materialType } : {}),
    }));
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

export function sumOrderLinesNet(lines: MaterialOrderLine[]): number {
  return roundMoney(lines.reduce((s, l) => s + (Number(l.lineNet) || 0), 0));
}
