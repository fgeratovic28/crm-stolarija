import { useCallback, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useJobsListSimple } from "@/hooks/use-jobs";
import type { QuickMaterialOrderItemInput } from "@/hooks/use-material-orders";

type ImportColumnKey = "itemCode" | "itemName" | "quantity" | "unit" | "supplierName";
type MappingState = Record<ImportColumnKey, string>;

type ParsedRow = Record<string, unknown>;
type HeaderMatch = { raw: string; normalized: string };

type DraftRow = {
  id: string;
  supplierId: string;
  itemCode: string;
  itemName: string;
  quantity: string;
  unit: string;
  note: string;
};
type ImportedDraftRow = {
  supplierId: string;
  itemCode?: string;
  itemName: string;
  quantity: number;
  unit: string;
};

type MaterialSpecImportModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedJobId?: string;
  onCreateOrders: (payload: { jobId: string; items: QuickMaterialOrderItemInput[] }) => Promise<void>;
  isSubmitting?: boolean;
};

const emptyMapping: MappingState = {
  itemCode: "__none__",
  itemName: "__none__",
  quantity: "__none__",
  unit: "__none__",
  supplierName: "__none__",
};

const createManualRow = (id: string, supplierId = ""): DraftRow => ({
  id,
  supplierId,
  itemCode: "",
  itemName: "",
  quantity: "1",
  unit: "kom",
  note: "",
});

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase();
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out.map((s) => s.replace(/^"|"$/g, "").trim());
}

function parseTextRows(content: string): ParsedRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "---");

  if (lines.length === 0) return [];
  const headerLine = lines[0];
  const delimiter = headerLine.includes("\t") ? "\t" : ";";
  const headers = parseDelimitedLine(headerLine, delimiter).map((h) => h.replace(/^\uFEFF/, ""));
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseDelimitedLine(lines[i], delimiter);
    const row: ParsedRow = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

export function MaterialSpecImportModal({
  open,
  onOpenChange,
  fixedJobId,
  onCreateOrders,
  isSubmitting = false,
}: MaterialSpecImportModalProps) {
  const { suppliers } = useSuppliers();
  const { data: jobs } = useJobsListSimple();
  const activeSuppliers = useMemo(() => (suppliers ?? []).filter((s) => s.active), [suppliers]);
  const [selectedJobId, setSelectedJobId] = useState(fixedJobId ?? "");
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<MappingState>(emptyMapping);
  const [fallbackSupplierId, setFallbackSupplierId] = useState("");
  const [manualRows, setManualRows] = useState<DraftRow[]>([]);
  const [error, setError] = useState("");

  const resolveSupplierId = useCallback(
    (supplierCell: unknown): string => {
      if (mapping.supplierName === "__none__") return fallbackSupplierId;
      const raw = String(supplierCell ?? "").trim().toLowerCase();
      if (!raw) return fallbackSupplierId;
      const byName = activeSuppliers.find((s) => s.name.trim().toLowerCase() === raw);
      if (byName) return byName.id;
      return fallbackSupplierId;
    },
    [activeSuppliers, fallbackSupplierId, mapping.supplierName],
  );

  const importedDraftRows: ImportedDraftRow[] = useMemo(() => {
    if (rawRows.length === 0) return [];
    return rawRows
      .map((row) => {
        const code = mapping.itemCode !== "__none__" ? String(row[mapping.itemCode] ?? "").trim() : "";
        const name = mapping.itemName !== "__none__" ? String(row[mapping.itemName] ?? "").trim() : "";
        const qtyRaw = mapping.quantity !== "__none__" ? Number(row[mapping.quantity]) : NaN;
        const unit = mapping.unit !== "__none__" ? String(row[mapping.unit] ?? "").trim() : "kom";
        const supplierId =
          mapping.supplierName !== "__none__"
            ? resolveSupplierId(row[mapping.supplierName])
            : fallbackSupplierId;

        if (!name || !Number.isFinite(qtyRaw) || qtyRaw <= 0 || !unit) return null;
        return {
          supplierId,
          itemCode: code || undefined,
          itemName: name,
          quantity: qtyRaw,
          unit,
        };
      })
      .filter((row): row is ImportedDraftRow => row !== null);
  }, [rawRows, mapping, resolveSupplierId]);

  const importedRows: QuickMaterialOrderItemInput[] = useMemo(
    () => importedDraftRows.filter((row) => !!row.supplierId).map((row) => ({ ...row })),
    [importedDraftRows],
  );
  const unresolvedSupplierCount = useMemo(
    () => importedDraftRows.filter((row) => !row.supplierId).length,
    [importedDraftRows],
  );
  const shouldShowFallbackSupplier = mapping.supplierName === "__none__" || unresolvedSupplierCount > 0;

  const allRowsForSubmit = useMemo(() => {
    const manualMapped = manualRows
      .map((row) => {
        const qty = Number(row.quantity);
        if (!row.supplierId || !row.itemName.trim() || !row.unit.trim() || !Number.isFinite(qty) || qty <= 0) {
          return null;
        }
        return {
          supplierId: row.supplierId,
          itemCode: row.itemCode.trim() || undefined,
          itemName: row.itemName.trim(),
          quantity: qty,
          unit: row.unit.trim(),
          note: row.note.trim() || undefined,
        } as QuickMaterialOrderItemInput;
      })
      .filter((row): row is QuickMaterialOrderItemInput => row !== null);
    return [...importedRows, ...manualMapped];
  }, [importedRows, manualRows]);

  const loadFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    let rows: ParsedRow[] = [];

    if (lowerName.endsWith(".csv") || lowerName.endsWith(".tsv") || lowerName.endsWith(".txt")) {
      const text = await file.text();
      rows = parseTextRows(text);
    } else {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      const ws = workbook.Sheets[firstSheet];
      rows = XLSX.utils.sheet_to_json<ParsedRow>(ws, { defval: "" });
    }

    const headerRowRaw = rows.length > 0 ? Object.keys(rows[0]) : [];
    const normalizedHeaders: HeaderMatch[] = headerRowRaw.map((raw) => ({
      raw,
      normalized: normalizeHeader(raw),
    }));
    const headerRow = normalizedHeaders.map((h) => h.raw);

    setFileName(file.name);
    setRawRows(rows);
    setHeaders(headerRow);

    const pick = (candidates: string[]) => {
      const normalizedCandidates = candidates.map((c) => normalizeHeader(c));
      const found = normalizedHeaders.find((h) => normalizedCandidates.includes(h.normalized));
      return found?.raw ?? "__none__";
    };

    setMapping({
      itemCode: pick([
        "sifra",
        "šifra",
        "code",
        "artikl_sifra",
        "profile code",
        "profilecode",
      ]),
      itemName: pick([
        "naziv",
        "artikel",
        "artikl",
        "item",
        "naziv artikla",
        "profile title",
        "profiletitle",
      ]),
      quantity: pick(["kolicina", "količina", "qty", "quantity"]),
      unit: pick(["jm", "jedinica", "unit", "unit measure"]),
      supplierName: pick(["dobavljac", "dobavljač", "supplier", "dealer name", "vendor"]),
    });
  };

  const reset = () => {
    setSelectedJobId(fixedJobId ?? "");
    setFileName("");
    setRawRows([]);
    setHeaders([]);
    setMapping(emptyMapping);
    setFallbackSupplierId("");
    setManualRows([]);
    setError("");
  };

  const addManualRow = () => {
    const inheritedSupplier = manualRows[manualRows.length - 1]?.supplierId || fallbackSupplierId;
    setManualRows((prev) => [...prev, createManualRow(String(Date.now()), inheritedSupplier)]);
  };

  const submit = async () => {
    const jobId = fixedJobId || selectedJobId;
    if (!jobId) {
      setError("Izaberite posao.");
      return;
    }
    if (shouldShowFallbackSupplier && !fallbackSupplierId) {
      setError("Izaberite podrazumevanog dobavljača za stavke bez prepoznatog dobavljača.");
      return;
    }
    if (unresolvedSupplierCount > 0 && fallbackSupplierId) {
      // Popunjavamo dobavljača za sve nerešene stavke iz fajla.
      const filled = importedDraftRows.map((row) =>
        row.supplierId ? row : { ...row, supplierId: fallbackSupplierId },
      );
      const mergedWithManual = [
        ...filled.map((row) => ({ ...row } as QuickMaterialOrderItemInput)),
        ...manualRows
          .map((row) => {
            const qty = Number(row.quantity);
            if (!row.supplierId || !row.itemName.trim() || !row.unit.trim() || !Number.isFinite(qty) || qty <= 0) {
              return null;
            }
            return {
              supplierId: row.supplierId,
              itemCode: row.itemCode.trim() || undefined,
              itemName: row.itemName.trim(),
              quantity: qty,
              unit: row.unit.trim(),
              note: row.note.trim() || undefined,
            } as QuickMaterialOrderItemInput;
          })
          .filter((row): row is QuickMaterialOrderItemInput => row !== null),
      ];
      if (mergedWithManual.length === 0) {
        setError("Nema validnih stavki za kreiranje porudžbina.");
        return;
      }
      setError("");
      await onCreateOrders({ jobId, items: mergedWithManual });
      reset();
      onOpenChange(false);
      return;
    }
    if (importedDraftRows.length > 0 && importedRows.length === 0) {
      setError("Nema validnih stavki sa dobavljačem. Izaberite podrazumevanog dobavljača.");
      return;
    }
    if (allRowsForSubmit.length === 0) {
      setError("Nema validnih stavki za kreiranje porudžbina.");
      return;
    }
    setError("");
    await onCreateOrders({ jobId, items: allRowsForSubmit });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="w-full sm:max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import materijala</DialogTitle>
          <DialogDescription>
            Uvezite .xlsx/.csv, mapirajte kolone, proverite preview i kreirajte porudžbine po dobavljaču.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!fixedJobId && (
            <div className="space-y-1">
              <Label>Posao *</Label>
              <Select value={selectedJobId} onValueChange={setSelectedJobId} disabled={isSubmitting}>
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite posao" />
                </SelectTrigger>
                <SelectContent>
                  {(jobs ?? []).map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.job_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-lg border p-3">
            <Label className="mb-2 block">Fajl (.xlsx / .csv)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await loadFile(file);
                }}
                disabled={isSubmitting}
              />
              <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
            </div>
            {fileName && <p className="text-xs text-muted-foreground mt-2">Učitano: {fileName}</p>}
          </div>

          {headers.length > 0 && (
            <div className="rounded-lg border p-3 space-y-3">
              <h4 className="text-sm font-semibold">Mapiranje kolona</h4>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                {([
                  ["itemCode", "Šifra"] as const,
                  ["itemName", "Naziv"] as const,
                  ["quantity", "Količina"] as const,
                  ["unit", "JM"] as const,
                  ["supplierName", "Dobavljač"] as const,
                ]).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label>{label}</Label>
                    <Select
                      value={mapping[key]}
                      onValueChange={(value) => setMapping((prev) => ({ ...prev, [key]: value }))}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Nije mapirano" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Nije mapirano</SelectItem>
                        {headers.map((header) => (
                          <SelectItem key={header} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {shouldShowFallbackSupplier && (
                <div className="space-y-1">
                  <Label>Podrazumevani dobavljač za neprepoznate stavke *</Label>
                  <Select value={fallbackSupplierId} onValueChange={setFallbackSupplierId} disabled={isSubmitting}>
                    <SelectTrigger>
                      <SelectValue placeholder="Izaberite dobavljača" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeSuppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {unresolvedSupplierCount > 0 && (
                    <p className="text-xs text-amber-600">
                      {unresolvedSupplierCount} stavki nema prepoznatog dobavljača iz fajla; biće dodeljen izabrani podrazumevani.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {rawRows.length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="text-sm font-semibold">Preview (importovane stavke)</h4>
              <div className="max-h-56 overflow-auto border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Dobavljač</th>
                      <th className="p-2 text-left">Šifra</th>
                      <th className="p-2 text-left">Naziv</th>
                      <th className="p-2 text-left">Količina</th>
                      <th className="p-2 text-left">JM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importedDraftRows.slice(0, 50).map((row, idx) => {
                      const supplierName = activeSuppliers.find((s) => s.id === row.supplierId)?.name ?? "—";
                      return (
                        <tr key={`${row.itemName}-${idx}`} className="border-t">
                          <td className="p-2">{supplierName}</td>
                          <td className="p-2">{row.itemCode ?? ""}</td>
                          <td className="p-2">{row.itemName}</td>
                          <td className="p-2">{row.quantity}</td>
                          <td className="p-2">{row.unit}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Validnih stavki: {importedRows.length} / ukupno parsirano: {importedDraftRows.length}
              </p>
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Ručni redovi</h4>
              <Button type="button" variant="outline" size="sm" onClick={addManualRow} disabled={isSubmitting}>
                <Plus className="w-4 h-4 mr-1" />
                Dodaj ručni red
              </Button>
            </div>
            {manualRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nema ručnih redova.</p>
            ) : (
              <div className="space-y-2">
                {manualRows.map((row) => (
                  <div key={row.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 border rounded-md p-2">
                    <div className="md:col-span-3">
                      <Select
                        value={row.supplierId}
                        onValueChange={(value) =>
                          setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, supplierId: value } : r)))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Dobavljač" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeSuppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      className="md:col-span-2"
                      placeholder="Šifra"
                      value={row.itemCode}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, itemCode: e.target.value } : r)))
                      }
                    />
                    <Input
                      className="md:col-span-3"
                      placeholder="Naziv artikla"
                      value={row.itemName}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, itemName: e.target.value } : r)))
                      }
                    />
                    <Input
                      className="md:col-span-1"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Kol."
                      value={row.quantity}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, quantity: e.target.value } : r)))
                      }
                    />
                    <Input
                      className="md:col-span-1"
                      placeholder="JM"
                      value={row.unit}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, unit: e.target.value } : r)))
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="md:col-span-1"
                      onClick={() => setManualRows((prev) => prev.filter((r) => r.id !== row.id))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Textarea
                      className="md:col-span-12"
                      rows={2}
                      placeholder="Napomena (opciono)"
                      value={row.note}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, note: e.target.value } : r)))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Otkaži
          </Button>
          <Button onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? "Kreiranje..." : "Kreiraj porudžbine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
