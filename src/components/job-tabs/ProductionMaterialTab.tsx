import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ScanLine, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useJobItems } from "@/hooks/use-job-items";
import { useWorkOrders } from "@/hooks/use-work-orders";
import { parseCutListCsvText } from "@/lib/cut-list-csv";
import { toast } from "sonner";
import Barcode from "react-barcode";
import { CameraBarcodeScanner } from "@/components/shared/CameraBarcodeScanner";
import { JobReceptionLauncher } from "@/components/job-tabs/JobReceptionLauncher";
import { useRole } from "@/contexts/RoleContext";

function metadataPictureUrl(meta: Record<string, unknown>): string {
  const p = meta.picture ?? meta.Picture;
  return typeof p === "string" ? p.trim() : "";
}

type ProductionMaterialTabProps = {
  jobId: string;
  mode?: "import" | "production" | "all";
};

export function ProductionMaterialTab({ jobId, mode = "all" }: ProductionMaterialTabProps) {
  const { hasAccess } = useRole();
  const canReceiveMaterials = hasAccess("material-reception");
  const { items, isLoading, replaceItems, completeByBarcode } = useJobItems(jobId);
  const { workOrders, updateWorkOrder } = useWorkOrders(jobId);
  const productionOrder = workOrders?.find((w) => w.type === "production");
  const productionMustStart = productionOrder != null && productionOrder.status === "pending";
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profilesBarcodesOpen, setProfilesBarcodesOpen] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [isSubmittingScan, setIsSubmittingScan] = useState(false);
  const [lastScanStatus, setLastScanStatus] = useState<"idle" | "success" | "error">("idle");
  const [lastScanMessage, setLastScanMessage] = useState("");
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const showImport = mode === "import" || mode === "all";
  const showProduction = mode === "production" || mode === "all";

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

  const onStartProduction = () => {
    if (!productionOrder) return;
    updateWorkOrder.mutate({ ...productionOrder, status: "in_progress" });
  };

  const submitScanCode = async (rawCode: string) => {
    if (productionMustStart) return;
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
    const parsed = parseCutListCsvText(text);
    if (parsed.length === 0) {
      toast.error("Nema validnih redova (proverite CSV: bar kod, profil, količina; redovi „Ostatak“ se preskaču).");
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
                <td className="p-2 align-top">
                  <div className="inline-flex flex-col gap-1.5 rounded-lg border border-border/80 bg-muted/35 px-2.5 py-2 shadow-inner shadow-black/[0.03] dark:shadow-black/20">
                    <span className="font-mono text-[11px] leading-snug tracking-tight text-foreground">{item.barcode}</span>
                    <div className="overflow-hidden rounded-[2px] bg-white/[0.65] px-1 py-0.5 dark:bg-white/90">
                      <Barcode
                        value={item.barcode}
                        width={1.15}
                        height={32}
                        displayValue={false}
                        margin={0}
                        background="transparent"
                      />
                    </div>
                  </div>
                </td>
              </tr>
              {expandedId === item.id && (
                <tr className="border-t bg-muted/40">
                  <td className="p-2" colSpan={7}>
                    {(() => {
                      const pic = metadataPictureUrl(item.metadata);
                      return pic ? (
                        <div className="mb-3">
                          <p className="text-[10px] uppercase text-muted-foreground mb-1">Slika (opciono)</p>
                          <img
                            src={pic}
                            alt="Profil"
                            className="max-h-40 rounded-md border"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                      ) : null;
                    })()}
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
      {canReceiveMaterials ? <JobReceptionLauncher jobId={jobId} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        {showImport && (
          <div className="space-y-1 min-w-0 flex-1 sm:max-w-md">
            <Label htmlFor="cutlist-upload">Upload krojne liste (.csv)</Label>
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
        )}
      </div>
      {showImport && (
        <p className="text-xs text-muted-foreground -mt-2">
          Očekivani format: izvoz sa tačka-zarezom (npr. kolone profile_code, profile_title, color, cut_lenght, quantity,
          user_barcode). Redovi sa leftover_profile = 1 ili bar kodom „Ostatak“ se ne uvoze. Nabavku profila podesite u tabu
          „Materijal“.
        </p>
      )}

      {showProduction && (
        <Card className="overflow-hidden border-primary/15 shadow-md shadow-black/[0.04]">
          <CardHeader className="space-y-1 pb-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/25">
                <ScanLine className="h-[18px] w-[18px]" aria-hidden />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base leading-tight">Skeniranje profila</CardTitle>
                <CardDescription>
                  Barkod ili ručni unos — kamera opciono ako čitač ili telefon ima skener.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {productionMustStart ? (
              <div className="space-y-2 rounded-lg border border-amber-500/35 bg-amber-500/[0.12] px-3 py-3 text-sm text-amber-950 shadow-sm dark:text-amber-100/95">
                <p>
                  Pre skeniranja pomerite proizvodni nalog u tok rada (posao nije u proizvodnji dok to ne učinite ručno).
                </p>
                <Button type="button" size="sm" onClick={onStartProduction} disabled={updateWorkOrder.isPending}>
                  {updateWorkOrder.isPending ? "Čekanje…" : "Započni proizvodnju"}
                </Button>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Napredak proizvodnje</span>
                <span>
                  {scanProgress.completed}/{scanProgress.total}{" "}
                  <span className="tabular-nums">({scanProgress.percent}%)</span>
                </span>
              </div>
              <Progress value={scanProgress.percent} className="h-2 bg-muted/80" />
              {(mode === "production" || mode === "all") &&
              scanProgress.total > 0 &&
              scanProgress.completed >= scanProgress.total ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.09] px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200/90">
                  Sve stavke su skenirane, ali proizvodni nalog nije završen: zatvaranje je u proizvodnom izveštaju
                  (popunite opis i sačuvajte izveštaj).
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="production-barcode-input" className="text-xs font-medium text-muted-foreground">
                Unos barkoda
              </Label>
              <div className="relative flex gap-0 rounded-xl border border-input bg-background shadow-sm ring-offset-background transition-[box-shadow] focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-offset-2">
                <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="production-barcode-input"
                  ref={scannerInputRef}
                  value={scanValue}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setScanValue(raw);
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
                  autoFocus={!productionMustStart}
                  disabled={productionMustStart}
                  placeholder="Čitač dugmeta Enter ili ovde nalepite…"
                  className="h-11 flex-1 border-0 bg-transparent pr-24 pl-10 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="absolute right-1 top-1/2 h-9 min-w-[2.75rem] -translate-y-1/2 rounded-lg border border-border/60 px-2.5 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                  onClick={() => setIsCameraScannerOpen(true)}
                  disabled={productionMustStart}
                  title="Skeniraj kamerom"
                >
                  <Camera className="h-5 w-5" />
                  <span className="sr-only">Skeniraj kamerom</span>
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                USB čitač obično šalje Enter na kraju; ne morate kliknuti „Potvrdi“ osim ako unos radite ručno.
              </p>
            </div>
            {lastScanMessage ? (
              <p
                className={`rounded-md border px-2.5 py-2 text-xs ${
                  lastScanStatus === "error"
                    ? "border-destructive/30 bg-destructive/[0.07] text-destructive"
                    : "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-800 dark:text-emerald-200/90"
                }`}
              >
                {lastScanMessage}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                className="font-medium"
                onClick={() => void onScanEnter()}
                disabled={
                  productionMustStart || !scanValue.trim() || isSubmittingScan || completeByBarcode.isPending
                }
              >
                Potvrdi unos
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isCameraScannerOpen && (
        <CameraBarcodeScanner
          onScanSuccess={(code) => {
            setIsCameraScannerOpen(false);
            void submitScanCode(code);
          }}
          onScanError={(err) => {
            console.debug("Scanner error:", err);
          }}
          onClose={() => setIsCameraScannerOpen(false)}
        />
      )}

      <div className="border rounded-lg overflow-hidden">
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
