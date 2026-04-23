import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileUp, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobItems } from "@/hooks/use-job-items";
import { useMaterialOrders } from "@/hooks/use-material-orders";
import { useSuppliers } from "@/hooks/use-suppliers";
import { formatCurrencyBySettings } from "@/lib/app-settings";
import type { Supplier } from "@/types";
import { toast } from "sonner";
import Barcode from "react-barcode";

type ParsedImportRow = {
  profileCode: string;
  profileTitle: string;
  color: string;
  cutLength: number;
  quantity: number;
  barcode: string;
  metadata: Record<string, unknown>;
};

function cleanHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim();
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

function pickColumn(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const hit = Object.entries(row).find(([k]) => k.toLowerCase() === alias.toLowerCase());
    if (hit) return hit[1] ?? "";
  }
  return "";
}

function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseCutListText(text: string): ParsedImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "---");
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ";";
  const headers = parseDelimitedLine(lines[0], delimiter).map(cleanHeader);
  const rows: ParsedImportRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseDelimitedLine(lines[i], delimiter);
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = cells[idx] ?? "";
    });

    const profileCode = pickColumn(rowObj, ["Profile Code"]);
    const profileTitle = pickColumn(rowObj, ["Profile Title"]);
    const color = pickColumn(rowObj, ["Color"]);
    const cutLength = Number(pickColumn(rowObj, ["Cut Length"]));
    const quantity = Number(pickColumn(rowObj, ["Quantity"]));
    const barcode = pickColumn(rowObj, ["User Barcode"]);

    if (!barcode) continue;
    if (!profileTitle || !Number.isFinite(quantity) || quantity <= 0) continue;

    const metadata: Record<string, unknown> = {};
    Object.entries(rowObj).forEach(([key, value]) => {
      const normalized = key.toLowerCase();
      if (
        [
          "profile code",
          "profile title",
          "color",
          "cut length",
          "quantity",
          "user barcode",
        ].includes(normalized)
      ) {
        return;
      }
      metadata[key] = value;
    });

    rows.push({
      profileCode,
      profileTitle,
      color,
      cutLength: Number.isFinite(cutLength) ? cutLength : 0,
      quantity: Math.round(quantity),
      barcode,
      metadata,
    });
  }

  return rows;
}

type ProductionMaterialTabProps = {
  jobId: string;
  mode?: "import" | "production" | "all";
};

type OrderDraftRow = {
  code: string;
  title: string;
  color: string;
  unit: string;
  quantity: number;
  baseQuantity: number;
  totalLength: number;
  baseTotalLength: number;
  unitPrice: number;
  supplierId: string;
};

const CUTLIST_DRAFT_STORAGE_PREFIX = "crm-cutlist-draft-v1:";

function cutlistDraftStorageKey(jid: string) {
  return `${CUTLIST_DRAFT_STORAGE_PREFIX}${jid}`;
}

type CutlistDraftPref = { supplierId: string; unitPrice: number };

function readCutlistDraftPrefs(jid: string): Record<string, CutlistDraftPref> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(cutlistDraftStorageKey(jid));
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, CutlistDraftPref> = {};
    for (const [k, v] of Object.entries(o)) {
      if (!v || typeof v !== "object") continue;
      const obj = v as Record<string, unknown>;
      const supplierId = typeof obj.supplierId === "string" ? obj.supplierId : "";
      const up = obj.unitPrice;
      const unitPrice =
        typeof up === "number" && Number.isFinite(up) && up > 0 ? up : 0;
      out[k] = { supplierId, unitPrice };
    }
    return out;
  } catch {
    return {};
  }
}

function writeCutlistDraftPrefs(jid: string, rows: OrderDraftRow[]) {
  if (typeof window === "undefined") return;
  const prefs: Record<string, CutlistDraftPref> = {};
  for (const r of rows) {
    prefs[r.code] = { supplierId: r.supplierId, unitPrice: r.unitPrice };
  }
  try {
    localStorage.setItem(cutlistDraftStorageKey(jid), JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

/** Dok lista dobavljača nije učitana, zadrži sačuvan ID da Select posle učitavanja ispravno prikaže izbor. */
function resolvePrefSupplierId(prefId: string | undefined, suppliersList: Supplier[] | undefined): string {
  const trimmed = prefId?.trim() ?? "";
  if (!trimmed) return "";
  const list = suppliersList ?? [];
  if (list.length === 0) return trimmed;
  return list.some((s) => s.id === trimmed) ? trimmed : "";
}

function suppliersForCutlistRow(all: Supplier[] | undefined, selectedId: string): Supplier[] {
  const list = all ?? [];
  const active = list.filter((s) => s.active);
  if (!selectedId) return active;
  const selected = list.find((s) => s.id === selectedId);
  if (!selected || selected.active) return active;
  return [selected, ...active.filter((s) => s.id !== selected.id)];
}

export function ProductionMaterialTab({ jobId, mode = "all" }: ProductionMaterialTabProps) {
  const { items, isLoading, replaceItems, completeByBarcode } = useJobItems(jobId);
  const { createQuickOrders } = useMaterialOrders(jobId);
  const { suppliers } = useSuppliers();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profilesBarcodesOpen, setProfilesBarcodesOpen] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [isSubmittingScan, setIsSubmittingScan] = useState(false);
  const [lastScanStatus, setLastScanStatus] = useState<"idle" | "success" | "error">("idle");
  const [lastScanMessage, setLastScanMessage] = useState("");
  const [orderDraftRows, setOrderDraftRows] = useState<OrderDraftRow[]>([]);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(() => isoDateDaysFromNow(14));
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const showImport = mode === "import" || mode === "all";
  const showProduction = mode === "production" || mode === "all";

  const aggregated = useMemo(() => {
    const map = new Map<
      string,
      { profileTitle: string; color: string; quantity: number; profileCode: string; totalLength: number; colors: Set<string> }
    >();
    items.forEach((item) => {
      const key = item.profileCode?.trim() ? item.profileCode.trim() : `${item.profileTitle}||${item.color}`;
      if (!map.has(key)) {
        map.set(key, {
          profileTitle: item.profileTitle,
          color: item.color,
          quantity: 0,
          profileCode: item.profileCode?.trim() || key,
          totalLength: 0,
          colors: new Set<string>(),
        });
      }
      const row = map.get(key)!;
      row.quantity += item.quantity;
      if (item.color?.trim()) row.colors.add(item.color.trim());
      const cut = Number(item.cutLength);
      if (Number.isFinite(cut) && cut > 0) {
        row.totalLength += cut * item.quantity;
      }
    });
    return Array.from(map.values()).map((row) => ({
      ...row,
      color: row.colors.size > 1 ? "više boja" : row.color,
    }));
  }, [items]);

  useEffect(() => {
    setOrderDraftRows((prev) => {
      const prefs = readCutlistDraftPrefs(jobId);
      const prevMap = new Map(prev.map((row) => [row.code, row]));
      return aggregated.map((row) => {
        const existing = prevMap.get(row.profileCode);
        const pref = prefs[row.profileCode];
        const baseTotalLength = row.totalLength > 0 ? Math.round(row.totalLength * 100) / 100 : 0;
        const baseQuantity = row.quantity;
        if (!existing) {
          return {
            code: row.profileCode,
            title: row.profileTitle,
            color: row.color,
            unit: "kom",
            quantity: baseQuantity,
            baseQuantity,
            totalLength: baseTotalLength,
            baseTotalLength,
            supplierId: resolvePrefSupplierId(pref?.supplierId, suppliers),
            unitPrice: pref?.unitPrice && pref.unitPrice > 0 ? pref.unitPrice : 0,
          };
        }
        const ratio = baseQuantity > 0 ? existing.quantity / baseQuantity : 1;
        const nextLength = baseTotalLength > 0 ? Math.round(baseTotalLength * ratio * 100) / 100 : 0;
        const supplierId =
          existing.supplierId || resolvePrefSupplierId(pref?.supplierId, suppliers);
        const unitPrice =
          existing.unitPrice > 0
            ? existing.unitPrice
            : pref?.unitPrice && pref.unitPrice > 0
              ? pref.unitPrice
              : 0;
        return {
          ...existing,
          title: row.profileTitle,
          color: row.color,
          baseQuantity,
          baseTotalLength,
          totalLength: nextLength,
          supplierId,
          unitPrice,
        };
      });
    });
  }, [aggregated, jobId, suppliers]);

  useEffect(() => {
    if (!jobId || orderDraftRows.length === 0) return;
    writeCutlistDraftPrefs(jobId, orderDraftRows);
  }, [jobId, orderDraftRows]);

  const scanProgress = useMemo(() => {
    const total = items.length;
    const completed = items.filter((item) => item.isCompleted).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, percent };
  }, [items]);

  useEffect(() => {
    if (!showProduction) return;
    if (scanProgress.total > 0 && scanProgress.completed >= scanProgress.total) {
      scannerInputRef.current?.blur();
    }
  }, [showProduction, scanProgress.total, scanProgress.completed]);

  const playScanTone = (type: "success" | "error") => {
    if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return;
    try {
      const audioContext = new window.AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = type === "success" ? 880 : 220;
      gain.gain.value = 0.06;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + (type === "success" ? 0.08 : 0.14));
      void audioContext.close();
    } catch {
      // Sound feedback is optional.
    }
  };

  const submitScanCode = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || isSubmittingScan) return;
    setIsSubmittingScan(true);
    setLastScanStatus("idle");
    try {
      await completeByBarcode.mutateAsync({ jobId, barcode: code });
      setScanValue("");
      setLastScanStatus("success");
      setLastScanMessage(`Uspešno skenirano: ${code}`);
      playScanTone("success");
    } catch (error) {
      setLastScanStatus("error");
      setLastScanMessage(error instanceof Error ? error.message : "Skeniranje nije uspelo");
      playScanTone("error");
    } finally {
      setIsSubmittingScan(false);
      // Keep scanner flow uninterrupted only while there are pending items.
      if (scanProgress.completed < scanProgress.total) {
        requestAnimationFrame(() => {
          scannerInputRef.current?.focus();
        });
      } else {
        scannerInputRef.current?.blur();
      }
    }
  };

  const onFileUpload = async (file: File) => {
    const text = await file.text();
    const parsed = parseCutListText(text);
    if (parsed.length === 0) {
      toast.error("Nema validnih redova sa bar kodom.");
      return;
    }
    await replaceItems.mutateAsync({
      jobId,
      rows: parsed,
    });
  };

  const onScanEnter = async () => {
    await submitScanCode(scanValue);
  };

  const createOrdersFromDrafts = async () => {
    const validRows = orderDraftRows.filter((row) => row.quantity > 0);
    if (validRows.length === 0) {
      toast.error("Nema stavki sa količinom većom od nule.");
      return;
    }
    if (validRows.some((row) => !row.supplierId)) {
      toast.error("Za svaku stavku izaberite dobavljača.");
      return;
    }
    const jobItemGroupKey = (it: (typeof items)[number]) =>
      it.profileCode?.trim() ? it.profileCode.trim() : `${it.profileTitle}||${it.color}`;
    await createQuickOrders.mutateAsync({
      jobId,
      expectedDelivery: expectedDeliveryDate.trim() || undefined,
      items: validRows.map((row) => ({
        supplierId: row.supplierId,
        itemCode: row.code || undefined,
        itemName: `${row.title}${row.color ? ` (${row.color})` : ""}`,
        quantity: row.quantity,
        unit: row.unit.trim() || "kom",
        totalLength: row.totalLength > 0 ? row.totalLength : undefined,
        unitPrice: row.unitPrice > 0 ? row.unitPrice : undefined,
        sourceJobItemIds: items.filter((it) => jobItemGroupKey(it) === row.code).map((it) => it.id),
      })),
    });
  };

  const jobItemsTable = useMemo(
    () => (
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="text-left p-2 w-10"></th>
            <th className="text-left p-2">Šifra</th>
            <th className="text-left p-2">Profil</th>
            <th className="text-left p-2">Boja</th>
            <th className="text-left p-2">Dužina</th>
            <th className="text-left p-2">Količina</th>
            <th className="text-left p-2">Bar kod</th>
          </tr>
        </thead>
        <tbody>
          {!isLoading && items.length === 0 && (
            <tr>
              <td className="p-3 text-muted-foreground" colSpan={7}>
                Nema importovanih stavki.
              </td>
            </tr>
          )}
          {items.map((item) => (
            <Fragment key={item.id}>
              <tr
                className={`border-t ${item.isCompleted ? "bg-emerald-50 line-through text-muted-foreground" : ""}`}
              >
                <td className="p-2">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${expandedId === item.id ? "rotate-180" : ""}`} />
                  </button>
                </td>
                <td className="p-2">{item.profileCode || "—"}</td>
                <td className="p-2">{item.profileTitle || item.profileCode}</td>
                <td className="p-2">{item.color}</td>
                <td className="p-2">{item.cutLength}</td>
                <td className="p-2">{item.quantity}</td>
                <td className="p-2">
                  <div className="flex flex-col items-start gap-1">
                    <span className="font-mono text-xs">{item.barcode}</span>
                    <Barcode
                      value={item.barcode}
                      width={1}
                      height={24}
                      displayValue={false}
                      margin={0}
                      background="transparent"
                    />
                  </div>
                </td>
              </tr>
              {expandedId === item.id && (
                <tr className="border-t bg-muted/40">
                  <td className="p-2" colSpan={7}>
                    {typeof item.metadata.Picture === "string" && item.metadata.Picture.trim().length > 0 ? (
                      <div className="mb-3">
                        <p className="text-[10px] uppercase text-muted-foreground mb-1">Slika (opciono)</p>
                        <img
                          src={item.metadata.Picture}
                          alt="Profil"
                          className="max-h-40 rounded-md border"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                      {Object.entries(item.metadata).map(([key, value]) => (
                        <div key={key} className="rounded-md border bg-background p-2">
                          <p className="text-[10px] uppercase text-muted-foreground">{key}</p>
                          <p className="text-foreground break-words">{String(value ?? "")}</p>
                        </div>
                      ))}
                      {Object.keys(item.metadata).length === 0 && (
                        <p className="text-muted-foreground">Nema dodatnih detalja.</p>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    ),
    [isLoading, items, expandedId],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        {showImport && (
          <>
            <div className="space-y-1 min-w-0 flex-1 sm:max-w-md">
              <Label htmlFor="cutlist-upload">Upload krojne liste (.csv/.tsv)</Label>
              <Input
                id="cutlist-upload"
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await onFileUpload(file);
                  e.currentTarget.value = "";
                }}
                disabled={replaceItems.isPending}
              />
            </div>
            <div className="space-y-1 shrink-0">
              <Label htmlFor="cutlist-expected-delivery">Očekivani rok isporuke</Label>
              <Input
                id="cutlist-expected-delivery"
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                className="w-[11.5rem]"
              />
            </div>
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => void createOrdersFromDrafts()}
              disabled={items.length === 0 || createQuickOrders.isPending}
            >
              <FileUp className="w-4 h-4 mr-1" />
              Kreiraj porudžbine
            </Button>
          </>
        )}
      </div>
      {showImport && (
        <p className="text-xs text-muted-foreground -mt-2">
          Nabavku profila pripremite ovde; status porudžbina pratite u tabu „Materijal“.
        </p>
      )}

      {showProduction && (
        <div className="rounded-lg border p-3">
          <Label className="mb-2 block">Skeniraj bar kod...</Label>
          <div className="mb-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Napredak proizvodnje</span>
              <span>
                {scanProgress.completed}/{scanProgress.total} ({scanProgress.percent}%)
              </span>
            </div>
            <Progress value={scanProgress.percent} />
          </div>
          <div className="relative">
            <ScanLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={scannerInputRef}
              value={scanValue}
              onChange={(e) => {
                const raw = e.target.value;
                setScanValue(raw);
                // Some mobile scanner apps append newline but do not trigger keydown Enter reliably.
                if (raw.includes("\n") || raw.includes("\r")) {
                  const normalized = raw.replace(/[\r\n]+/g, "");
                  setScanValue(normalized);
                  void submitScanCode(normalized);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onScanEnter();
                }
              }}
              autoFocus
              placeholder="Skeniraj bar kod..."
              className="pl-9 h-11 text-base"
            />
          </div>
          {lastScanMessage ? (
            <p className={`mt-2 text-xs ${lastScanStatus === "error" ? "text-destructive" : "text-emerald-600"}`}>
              {lastScanMessage}
            </p>
          ) : null}
          <div className="mt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void onScanEnter()}
              disabled={!scanValue.trim() || isSubmittingScan || completeByBarcode.isPending}
            >
              Potvrdi skeniranje
            </Button>
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        {showImport && aggregated.length > 0 && (
          <div className="p-3 border-b bg-muted/30">
            <p className="text-sm font-semibold mb-2">Lista materijala za poručivanje</p>
            <div className="max-h-56 overflow-auto border rounded-md bg-background">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 text-left">Šifra</th>
                    <th className="p-2 text-left">Profil</th>
                    <th className="p-2 text-left">Boja</th>
                    <th className="p-2 text-left">JM</th>
                    <th className="p-2 text-left">Količina</th>
                    <th className="p-2 text-left">Ukupna dužina (mm)</th>
                    <th className="p-2 text-left">Cena</th>
                    <th className="p-2 text-left">Dobavljač</th>
                  </tr>
                </thead>
                <tbody>
                  {orderDraftRows.map((row) => (
                    <tr key={row.code} className="border-t">
                      <td className="p-2">{row.code || "—"}</td>
                      <td className="p-2">{row.title}</td>
                      <td className="p-2">{row.color || "—"}</td>
                      <td className="p-2 w-24">
                        <Input
                          value={row.unit}
                          onChange={(e) =>
                            setOrderDraftRows((prev) =>
                              prev.map((it) => (it.code === row.code ? { ...it, unit: e.target.value } : it)),
                            )
                          }
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="p-2 w-28">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={row.quantity}
                          onChange={(e) => {
                            const nextQty = Math.max(0, Math.round(Number(e.target.value) || 0));
                            setOrderDraftRows((prev) =>
                              prev.map((it) => {
                                if (it.code !== row.code) return it;
                                const ratio = it.baseQuantity > 0 ? nextQty / it.baseQuantity : 0;
                                const nextLength =
                                  it.baseTotalLength > 0 ? Math.round(it.baseTotalLength * ratio * 100) / 100 : 0;
                                return {
                                  ...it,
                                  quantity: nextQty,
                                  totalLength: nextLength,
                                };
                              }),
                            );
                          }}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="p-2 tabular-nums">
                        {row.totalLength > 0 ? `${row.totalLength.toFixed(2)} (mm)` : "—"}
                      </td>
                      <td className="p-2 w-36 align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.unitPrice}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setOrderDraftRows((prev) =>
                              prev.map((it) =>
                                it.code === row.code
                                  ? { ...it, unitPrice: Number.isFinite(next) && next > 0 ? next : 0 }
                                  : it,
                              ),
                            );
                          }}
                          className="h-7 text-xs"
                        />
                        {row.unitPrice > 0 ? (
                          <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                            {formatCurrencyBySettings(row.unitPrice)} / jed.
                          </p>
                        ) : null}
                      </td>
                      <td className="p-2 min-w-48">
                        <Select
                          value={row.supplierId || undefined}
                          onValueChange={(value) =>
                            setOrderDraftRows((prev) =>
                              prev.map((it) => (it.code === row.code ? { ...it, supplierId: value } : it)),
                            )
                          }
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Izaberi dobavljača" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliersForCutlistRow(suppliers, row.supplierId).map((supplier) => (
                              <SelectItem key={supplier.id} value={supplier.id}>
                                {supplier.name}
                                {!supplier.active ? " (neaktivan)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Stavke su spojene po šifri. Za svaku podesite količinu i dobavljača, zatim kliknite „Kreiraj porudžbine“.
            </p>
          </div>
        )}
        {showImport ? (
          <Collapsible open={profilesBarcodesOpen} onOpenChange={setProfilesBarcodesOpen}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 py-2 border-b bg-muted/30">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Profili i bar kodovi</p>
                {items.length > 0 && (
                  <p className="text-xs text-muted-foreground truncate">
                    {items.length} stavki
                    {scanProgress.total > 0 ? ` · ${scanProgress.completed}/${scanProgress.total} skenirano` : ""}
                  </p>
                )}
              </div>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="shrink-0 h-8 text-xs gap-1.5">
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${profilesBarcodesOpen ? "rotate-180" : ""}`}
                  />
                  {profilesBarcodesOpen ? "Skupi" : "Rasiri"}
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>{jobItemsTable}</CollapsibleContent>
          </Collapsible>
        ) : (
          jobItemsTable
        )}
      </div>

    </div>
  );
}
