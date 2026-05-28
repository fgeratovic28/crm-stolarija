import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MaterialOrderFormValues } from "@/lib/material-order-form-schema";
import {
  buildSmartItemsJsonFromSheetPick,
  enrichSmartItemsJsonSifraFromResolver,
  rememberableCodesFromSmartJson,
  removeColumnFromItemsJson,
  smartItemsJsonToNbLineFormValues,
  validateSmartItemsJson,
  type MaterialOrderItemsJsonV1,
} from "@/lib/material-order-items-json";
import {
  analyzeProcurementMatrix,
  delimiterTextToMatrix,
  detectBestProcurementSheet,
  loadWorkbookFromArrayBuffer,
  type SheetPickResult,
} from "@/lib/procurement-excel-import";

type ItemCodeLookupInput = { article?: string; position?: string; lengthMm?: number | null };

export type RememberItemCodePayload = {
  article?: string;
  article_code?: string;
  position?: string;
  lengthMm?: number | null;
};

interface MaterialOrderExcelImportSectionProps {
  form: UseFormReturn<MaterialOrderFormValues>;
  disabled?: boolean;
  resolveRememberedItemCode?: (input: ItemCodeLookupInput) => string | undefined;
  onRememberItemCodes?: (items: RememberItemCodePayload[]) => void | Promise<void>;
}

function stripFileSection(
  form: UseFormReturn<MaterialOrderFormValues>,
  setFileName: (s: string) => void,
  setLocalError: (s: string) => void,
  setEditingCell: (v: { row: number; key: string } | null) => void,
  setEditingHeader: (v: string | null) => void,
) {
  setFileName("");
  setLocalError("");
  setEditingCell(null);
  setEditingHeader(null);
  form.setValue("itemsJson", undefined, { shouldDirty: true });
  form.setValue(
    "nbLines",
    [{ description: "", quantity: 1, unit: "kom", lineNet: 0, materialType: undefined }],
    { shouldDirty: true, shouldValidate: true },
  );
}

/**
 * Smart Excel / CSV: bez mapiranja kolona — ista struktura kao u fajlu, sve ćelije se edituju, kolona Šifra se dodaje automatski.
 */
export function MaterialOrderExcelImportSection({
  form,
  disabled,
  resolveRememberedItemCode,
  onRememberItemCodes,
}: MaterialOrderExcelImportSectionProps) {
  const [fileName, setFileName] = useState("");
  const [localError, setLocalError] = useState("");
  const rememberTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; key: string } | null>(null);
  const [editingHeader, setEditingHeader] = useState<string | null>(null);

  const itemsJson = useWatch({ control: form.control, name: "itemsJson" }) as MaterialOrderItemsJsonV1 | undefined;

  const syncNbLines = useCallback(
    (json: MaterialOrderItemsJsonV1 | undefined) => {
      if (!json) return;
      const err = validateSmartItemsJson(json);
      if (err) return;
      form.setValue("nbLines", smartItemsJsonToNbLineFormValues(json), {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [form],
  );

  useEffect(() => {
    syncNbLines(itemsJson);
  }, [itemsJson, syncNbLines]);

  useEffect(() => {
    if (!itemsJson) {
      if (rememberTimer.current) clearTimeout(rememberTimer.current);
      return;
    }
    if (rememberTimer.current) clearTimeout(rememberTimer.current);
    rememberTimer.current = setTimeout(() => {
      const err = validateSmartItemsJson(itemsJson);
      if (err) return;
      void onRememberItemCodes?.(rememberableCodesFromSmartJson(itemsJson));
    }, 900);
    return () => {
      if (rememberTimer.current) clearTimeout(rememberTimer.current);
    };
  }, [itemsJson, onRememberItemCodes]);

  /** Kad se memorija šifri učita sa servera, ponovo popuni prazne šifre u već uvezenoj tabeli. */
  useEffect(() => {
    if (!resolveRememberedItemCode) return;
    const cur = form.getValues("itemsJson") as MaterialOrderItemsJsonV1 | undefined;
    if (!cur) return;
    const next = enrichSmartItemsJsonSifraFromResolver(cur, resolveRememberedItemCode);
    const sk = cur.sifraColumnKey;
    const same =
      cur.rows.length === next.rows.length &&
      cur.rows.every((r, i) => String(r[sk] ?? "").trim() === String(next.rows[i]?.[sk] ?? "").trim());
    if (same) return;
    form.setValue("itemsJson", next, { shouldDirty: true });
  }, [resolveRememberedItemCode, form]);

  const applyPick = useCallback(
    (pick: SheetPickResult, name: string) => {
      try {
        const json = buildSmartItemsJsonFromSheetPick(pick, resolveRememberedItemCode);
        setEditingCell(null);
        setEditingHeader(null);
        setFileName(name);
        setLocalError("");
        form.setValue("itemsJson", json, { shouldDirty: true, shouldValidate: true });
        syncNbLines(json);
        toast.success("Tabela je učitana. Možete menjati ćelije i kolone — pregled PDF-a se ažurira automatski.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Greška pri obradi tabele.";
        setLocalError(msg);
        stripFileSection(form, setFileName, setLocalError, setEditingCell, setEditingHeader);
        toast.error(msg);
      }
    },
    [form, resolveRememberedItemCode, syncNbLines],
  );

  const loadFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
        const text = await file.text();
        const matrix = delimiterTextToMatrix(text);
        const pick = analyzeProcurementMatrix(matrix);
        if (!pick) {
          setLocalError("Nije pronađena tabela u CSV fajlu.");
          stripFileSection(form, setFileName, setLocalError, setEditingCell, setEditingHeader);
          return;
        }
        applyPick(pick, file.name);
        return;
      }
      const buf = await file.arrayBuffer();
      const wb = loadWorkbookFromArrayBuffer(buf);
      const pick = detectBestProcurementSheet(wb);
      if (!pick) {
        setLocalError("Radna sveska nema prepoznatljiv list sa tabelom.");
        stripFileSection(form, setFileName, setLocalError, setEditingCell, setEditingHeader);
        return;
      }
      applyPick(pick, file.name);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Greška pri čitanju fajla.");
      stripFileSection(form, setFileName, setLocalError, setEditingCell, setEditingHeader);
    }
  };

  const validationMessage = useMemo(() => {
    if (!itemsJson) return null;
    return validateSmartItemsJson(itemsJson);
  }, [itemsJson]);

  const updateItemsJson = (next: MaterialOrderItemsJsonV1) => {
    form.setValue("itemsJson", next, { shouldDirty: true, shouldValidate: true });
  };

  const setCell = (rowIndex: number, key: string, value: string) => {
    if (!itemsJson) return;
    const rows = itemsJson.rows.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r));
    updateItemsJson({ ...itemsJson, rows });
  };

  const setColumnLabel = (key: string, label: string) => {
    if (!itemsJson) return;
    updateItemsJson({
      ...itemsJson,
      columns: itemsJson.columns.map((c) => (c.key === key ? { ...c, label } : c)),
    });
  };

  const deleteColumn = (key: string) => {
    if (!itemsJson) return;
    const { next, error } = removeColumnFromItemsJson(itemsJson, key);
    if (error) {
      toast.error(error);
      return;
    }
    updateItemsJson(next);
  };

  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 sm:p-4 space-y-4 relative z-0">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Smart uvoz (Excel / CSV)</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Bez mapiranja kolona — prikazuje se cela tabela iz fajla. Kolona „Šifra” se dodaje automatski (ne ide u štampu
          kao tekst, samo u barkod). Klik na ćeliju ili naslov kolone da bude izmena; ikona korpe briše kolonu iz prikaza.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex-1 min-w-0 space-y-1 relative z-0">
          <Label className="text-xs">Fajl (.xlsx, .csv)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              className="cursor-pointer"
              disabled={disabled}
              onChange={async (e) => {
                const f = e.currentTarget.files?.[0];
                if (!f) return;
                await loadFile(f);
                e.currentTarget.value = "";
              }}
            />
            <FileSpreadsheet className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
          </div>
          {fileName ? <p className="text-[11px] text-muted-foreground">{fileName}</p> : null}
        </div>
        {itemsJson ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => stripFileSection(form, setFileName, setLocalError, setEditingCell, setEditingHeader)}
          >
            Ukloni fajl
          </Button>
        ) : null}
      </div>

      {itemsJson ? (
        <div className="rounded-md border border-border bg-background overflow-hidden">
          <p className="text-xs font-medium px-2 py-1.5 border-b bg-muted/50">
            Tabela · {itemsJson.rows.length} redova · {itemsJson.columns.length} kolona
          </p>
          {validationMessage ? (
            <p className="text-xs text-amber-700 dark:text-amber-300 px-2 py-1 border-b">{validationMessage}</p>
          ) : null}
          <div className="max-h-[min(28rem,55vh)] overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="p-1.5 text-left w-8">#</th>
                  {itemsJson.columns.map((col) => {
                    const locked =
                      col.key === itemsJson.articleColumnKey ||
                      col.key === itemsJson.quantityColumnKey ||
                      col.key === itemsJson.sifraColumnKey;
                    return (
                      <th key={col.key} className="p-1.5 text-left align-bottom min-w-[5rem]">
                        <div className="flex items-end gap-1 min-w-0">
                          {editingHeader === col.key ? (
                            <Input
                              autoFocus
                              className="h-7 min-w-0 flex-1 text-[11px] font-medium"
                              value={col.label}
                              disabled={disabled}
                              onChange={(e) => setColumnLabel(col.key, e.target.value)}
                              onBlur={() => setEditingHeader(null)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") setEditingHeader(null);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={disabled}
                              className="h-7 min-w-0 flex-1 rounded border border-transparent px-2 text-left text-[11px] font-medium leading-tight hover:border-border hover:bg-muted/40"
                              title="Kliknite da promenite naslov kolone"
                              onClick={() => setEditingHeader(col.key)}
                            >
                              <span className="line-clamp-2">{col.label || "—"}</span>
                            </button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                            disabled={disabled || locked}
                            title={locked ? "Obavezna kolona" : "Ukloni kolonu"}
                            onClick={() => deleteColumn(col.key)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {itemsJson.rows.map((row, idx) => (
                  <tr key={idx} className="border-t border-border">
                    <td className="p-1.5 text-muted-foreground align-top">{idx + 1}</td>
                    {itemsJson.columns.map((col) => {
                      const raw = row[col.key] ?? "";
                      const isEditing = editingCell?.row === idx && editingCell?.key === col.key;
                      const isQty = col.key === itemsJson.quantityColumnKey;
                      return (
                        <td key={col.key} className="p-1 align-top">
                          {isEditing ? (
                            <Input
                              autoFocus
                              className={`h-7 text-[11px] min-w-[4rem] ${isQty ? "text-right" : ""}`}
                              disabled={disabled}
                              value={raw}
                              onChange={(e) => setCell(idx, col.key, e.target.value)}
                              onBlur={() => setEditingCell(null)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") setEditingCell(null);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={disabled}
                              className={`h-7 w-full min-w-[4rem] rounded border border-transparent px-2 text-left text-[11px] hover:border-border hover:bg-muted/40 ${
                                isQty ? "text-right tabular-nums" : ""
                              }`}
                              title="Kliknite da izmenite"
                              onClick={() => setEditingCell({ row: idx, key: col.key })}
                            >
                              {raw || "—"}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {localError ? <p className="text-sm text-destructive">{localError}</p> : null}
    </div>
  );
}
