import type { MaterialOrderLineFormValues } from "@/lib/material-order-form-schema";
import { procurementMetaForNbLinesJson } from "@/lib/material-order-lines";
import type { MaterialOrderLine, MaterialType } from "@/types";

/** Mapuje stavke iz forme narudžbine u model za PDF / CRM (isti oblik kao pri čuvanju). */
export function materialOrderFormLinesToMaterialOrderLines(
  nbLines: MaterialOrderLineFormValues[],
  options: { zeroLineNet?: boolean } = {},
): MaterialOrderLine[] {
  const zeroLineNet = options.zeroLineNet ?? false;
  const rows = Array.isArray(nbLines) ? nbLines : [];
  return rows.map((l) => {
    const pm = l.procurementMeta;
    const desc = l.description.trim();
    const lineUnit = (l.unit ?? "").trim() || "kom";
    /** Ručne stavke bez nabavkih polja: naziv iz forme je autoritativan (izbegava zastareo meta.article posle izmene teksta). */
    /** Samo nabavna polja koja nisu na glavnom redu (naziv, količina, JM) — ne uključuje meta.article / meta.uom. */
    const structuredProcurement =
      Boolean(pm?.work_order?.trim()) ||
      Boolean(pm?.position?.trim()) ||
      Boolean(pm?.article_code?.trim()) ||
      Boolean(pm?.color?.trim()) ||
      (pm?.length_mm != null && Number.isFinite(pm.length_mm));
    const article = (
      structuredProcurement ? (pm?.article?.trim() || desc).trim() : desc || (pm?.article?.trim() ?? "")
    ).trim();

    /** Samo eksplicitni Excel uvoz (`manual_line === false`) koristi segmentni barkod; sve ostalo = M+cifre. */
    const fromExcelImport = pm?.manual_line === false;
    const manual_line: boolean = !fromExcelImport;

    const metaMerged =
      article.length > 0
        ? procurementMetaForNbLinesJson({
            ...(pm?.work_order?.trim() ? { work_order: pm.work_order.trim() } : {}),
            ...(pm?.position?.trim() ? { position: pm.position.trim() } : {}),
            ...(pm?.article_code?.trim() ? { article_code: pm.article_code.trim() } : {}),
            article,
            ...(pm?.color?.trim() ? { color: pm.color.trim() } : {}),
            ...(pm?.uom?.trim()
              ? { uom: pm.uom.trim() }
              : lineUnit !== "kom"
                ? { uom: lineUnit }
                : {}),
            length_mm:
              pm?.length_mm != null && Number.isFinite(pm.length_mm) ? Math.round(pm.length_mm) : null,
            manual_line,
          })
        : undefined;

    return {
      description: desc || "—",
      quantity: l.quantity,
      unit: lineUnit,
      lineNet: zeroLineNet ? 0 : Math.round((l.lineNet ?? 0) * 100) / 100,
      ...(l.materialType && String(l.materialType).length > 0
        ? { materialType: l.materialType as MaterialType }
        : {}),
      ...(metaMerged ? { procurementMeta: metaMerged } : {}),
    };
  });
}
