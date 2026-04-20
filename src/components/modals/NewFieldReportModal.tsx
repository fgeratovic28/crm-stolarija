import { useState, useEffect } from "react";
import { MapPin, Factory, X, Loader2, Plus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { buildFieldReportPhotoKey, uploadFileToR2 } from "@/lib/r2-storage";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useFieldReports } from "@/hooks/use-field-reports";
import { fieldReportFlowForWorkOrderType } from "@/lib/field-team-access";
import type { FieldReportDetails, WorkOrderType } from "@/types";

interface NewFieldReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId?: string;
}

const MISSING_OPTIONS: { key: string; label: string }[] = [
  { key: "sol", label: "Sol" },
  { key: "daska", label: "Daska" },
  { key: "komarnici", label: "Komarnici" },
  { key: "drugi_delovi", label: "Drugi delovi" },
];

const ADDITIONAL_OPTIONS: { key: string; label: string }[] = [
  { key: "sol", label: "Sol" },
  { key: "daska", label: "Daska" },
  { key: "komarnici", label: "Komarnici" },
  { key: "nesto_drugo", label: "Nešto drugo" },
];

function formatRecordedShort(iso: string) {
  try {
    return format(parseISO(iso), "HH:mm");
  } catch {
    return iso;
  }
}

function RecordedHint({ iso }: { iso: string | null | undefined }) {
  if (!iso) return null;
  return (
    <p className="text-xs text-muted-foreground mt-1">
      Zabeleženo: <span className="font-medium text-foreground">{formatRecordedShort(iso)}</span> (
      {format(parseISO(iso), "dd.MM.yyyy")})
    </p>
  );
}

export function NewFieldReportModal({ open, onOpenChange, workOrderId }: NewFieldReportModalProps) {
  const [jobId, setJobId] = useState("");
  const [address, setAddress] = useState("");

  const [arrived, setArrived] = useState(false);
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);

  const [siteCanceled, setSiteCanceled] = useState(false);
  const [canceledAt, setCanceledAt] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [jobCompleted, setJobCompleted] = useState(false);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);

  const [everythingOk, setEverythingOk] = useState(true);
  const [issueReportedAt, setIssueReportedAt] = useState<string | null>(null);
  const [issueNote, setIssueNote] = useState("");
  const [missingItemSelections, setMissingItemSelections] = useState<string[]>([]);
  const [missingDrugiText, setMissingDrugiText] = useState("");

  const [needsAdditionalItems, setNeedsAdditionalItems] = useState(false);
  const [additionalReqAt, setAdditionalReqAt] = useState<string | null>(null);
  const [additionalNeedSelections, setAdditionalNeedSelections] = useState<string[]>([]);
  const [additionalNestoDrugoText, setAdditionalNestoDrugoText] = useState("");

  const [measurements, setMeasurements] = useState("");
  const [estimatedInstallationHours, setEstimatedInstallationHours] = useState<string>("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const { toast } = useToast();
  const { createReport } = useFieldReports();

  const { data: jobs } = useQuery({
    queryKey: ["jobs-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_number, installation_address, customer:customers(name)");
      if (error) throw error;
      return data;
    },
    enabled: open && !workOrderId,
  });

  const { data: workOrderData } = useQuery({
    queryKey: ["work-order", workOrderId],
    queryFn: async () => {
      if (!workOrderId) return null;
      const { data, error } = await supabase
        .from("work_orders")
        .select(`
          *,
          job:jobs (
            id,
            job_number,
            installation_address,
            customer:customers (name)
          )
        `)
        .eq("id", workOrderId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open && !!workOrderId,
  });

  const reportVariant = workOrderData?.type
    ? fieldReportFlowForWorkOrderType(workOrderData.type as WorkOrderType)
    : "field";

  const isMeasurementWorkOrder = workOrderData?.type === "measurement";
  const isProductionReport = reportVariant === "production";

  useEffect(() => {
    if (workOrderData) {
      setJobId(workOrderData.job_id);
      setAddress(workOrderData.job?.installation_address || "");
    }
  }, [workOrderData]);

  /** Proizvodnja ne koristi terenske prekidače — ne ostavljaj stare vrednosti pri promeni naloga. */
  useEffect(() => {
    if (!workOrderData?.type || workOrderData.type !== "production") return;
    setArrived(false);
    setArrivedAt(null);
    setSiteCanceled(false);
    setCanceledAt(null);
    setCancelReason("");
  }, [workOrderData?.id, workOrderData?.type]);

  const resetForm = () => {
    setJobId("");
    setAddress("");
    setArrived(false);
    setArrivedAt(null);
    setSiteCanceled(false);
    setCanceledAt(null);
    setCancelReason("");
    setJobCompleted(false);
    setFinishedAt(null);
    setEverythingOk(true);
    setIssueReportedAt(null);
    setIssueNote("");
    setMissingItemSelections([]);
    setMissingDrugiText("");
    setNeedsAdditionalItems(false);
    setAdditionalReqAt(null);
    setAdditionalNeedSelections([]);
    setAdditionalNestoDrugoText("");
    setMeasurements("");
    setEstimatedInstallationHours("");
    setGeneralNotes("");
    setImages([]);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const objectKey = buildFieldReportPhotoKey(fileName);
        const publicUrl = await uploadFileToR2(objectKey, file);
        setImages((prev) => [...prev, publicUrl]);
      }
      toast({ title: "Fajlovi uspešno otpremljeni" });
    } catch (err) {
      console.error("Upload error:", err);
      toast({ title: "Greška pri otpremanju", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const stampNow = () => new Date().toISOString();

  const toggleArrived = (v: boolean) => {
    setArrived(v);
    if (v) setArrivedAt(stampNow());
    else setArrivedAt(null);
  };

  const toggleCanceled = (v: boolean) => {
    setSiteCanceled(v);
    if (v) setCanceledAt(stampNow());
    else {
      setCanceledAt(null);
      setCancelReason("");
    }
  };

  const toggleFinished = (v: boolean) => {
    setJobCompleted(v);
    if (v) setFinishedAt(stampNow());
    else setFinishedAt(null);
  };

  const toggleEverythingOk = (v: boolean) => {
    setEverythingOk(v);
    if (!v) setIssueReportedAt(stampNow());
    else {
      setIssueReportedAt(null);
      setIssueNote("");
      setMissingItemSelections([]);
      setMissingDrugiText("");
    }
  };

  const toggleAdditional = (v: boolean) => {
    setNeedsAdditionalItems(v);
    if (v) setAdditionalReqAt(stampNow());
    else {
      setAdditionalReqAt(null);
      setAdditionalNeedSelections([]);
      setAdditionalNestoDrugoText("");
    }
  };

  const handleSubmit = async () => {
    const resolvedAddress = isProductionReport
      ? (address.trim() || workOrderData?.job?.installation_address || "").trim()
      : address.trim();

    if (!jobId || !resolvedAddress) {
      toast({
        title: "Popunite obavezna polja",
        description: isProductionReport
          ? "Nedostaje adresa ugradnje na poslu (proverite karticu posla)."
          : undefined,
        variant: "destructive",
      });
      return;
    }
    if (reportVariant === "mounting" && images.length === 0) {
      toast({
        title: "Dodajte bar jednu sliku",
        description: "Za montažni izveštaj je potrebna fotodokumentacija.",
        variant: "destructive",
      });
      return;
    }
    const effectiveSiteCanceled = isProductionReport ? false : siteCanceled;
    if (effectiveSiteCanceled && !cancelReason.trim()) {
      toast({ title: "Upišite razlog otkazivanja", variant: "destructive" });
      return;
    }
    if (!generalNotes.trim()) {
      toast({ title: "Napišite generalni izveštaj", variant: "destructive" });
      return;
    }

    const nowIso = stampNow();
    const resolvedMissing: string[] = [];
    for (const k of missingItemSelections) {
      if (k === "drugi_delovi") {
        const t = missingDrugiText.trim();
        if (!t) {
          toast({ title: "Upišite koji su drugi delovi", variant: "destructive" });
          return;
        }
        resolvedMissing.push(t);
      } else {
        resolvedMissing.push(k);
      }
    }

    const resolvedAdditional: string[] = [...additionalNeedSelections.filter((k) => k !== "nesto_drugo")];
    if (additionalNeedSelections.includes("nesto_drugo")) {
      const t = additionalNestoDrugoText.trim();
      if (!t) {
        toast({ title: "Upišite šta još treba (Nešto drugo)", variant: "destructive" });
        return;
      }
      resolvedAdditional.push(t);
    }

    if (!everythingOk) {
      const hasStd = missingItemSelections.some((k) => k !== "drugi_delovi");
      const hasDrugi = missingItemSelections.includes("drugi_delovi") && missingDrugiText.trim().length > 0;
      if (!hasStd && !hasDrugi) {
        toast({ title: "Izaberite šta nije u redu / nije isporučeno", variant: "destructive" });
        return;
      }
    }

    if (needsAdditionalItems && resolvedAdditional.length === 0) {
      toast({ title: "Izaberite šta još treba", variant: "destructive" });
      return;
    }

    if (isMeasurementWorkOrder && !effectiveSiteCanceled) {
      if (!measurements.trim()) {
        toast({ title: "Upišite mere", variant: "destructive" });
        return;
      }
      const hoursNum = Number(estimatedInstallationHours.replace(",", "."));
      if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
        toast({
          title: "Procenjeno vreme ugradnje",
          description: "Unesite broj sati veći od 0.",
          variant: "destructive",
        });
        return;
      }
    }

    const details: FieldReportDetails = {};
    if (!isProductionReport && arrived) details.arrivedAt = arrivedAt ?? nowIso;
    if (!isProductionReport && effectiveSiteCanceled) details.canceledAt = canceledAt ?? nowIso;
    if (jobCompleted) details.finishedAt = finishedAt ?? nowIso;
    if (!everythingOk) details.issueReportedAt = issueReportedAt ?? nowIso;
    if (needsAdditionalItems) details.additionalReqAt = additionalReqAt ?? nowIso;

    const missingLabelParts: string[] = missingItemSelections
      .filter((k) => k !== "drugi_delovi")
      .map((k) => MISSING_OPTIONS.find((o) => o.key === k)?.label ?? k);
    if (missingItemSelections.includes("drugi_delovi") && missingDrugiText.trim()) {
      missingLabelParts.push(`Drugi delovi: ${missingDrugiText.trim()}`);
    }
    const issuesParts: string[] = [];
    if (!everythingOk && missingLabelParts.length > 0) {
      issuesParts.push(`Šta nije u redu / nisu isporučeni elementi: ${missingLabelParts.join(", ")}`);
    }
    if (!everythingOk && issueNote.trim()) {
      issuesParts.push(issueNote.trim());
    }
    const issuesCombined = issuesParts.length > 0 ? issuesParts.join("\n\n") : undefined;

    try {
      await createReport.mutateAsync({
        workOrderId,
        jobId,
        address: resolvedAddress,
        arrived: isProductionReport ? false : arrived,
        arrivalDate: !isProductionReport && arrived ? details.arrivedAt ?? nowIso : undefined,
        siteCanceled: effectiveSiteCanceled,
        cancelReason: effectiveSiteCanceled ? cancelReason.trim() : undefined,
        jobCompleted,
        everythingOk,
        issueDescription: issuesCombined,
        images,
        missingItems: !everythingOk ? resolvedMissing : [],
        additionalNeeds: needsAdditionalItems ? resolvedAdditional : [],
        measurements: measurements.trim() || undefined,
        generalNotes: generalNotes.trim(),
        details,
        estimatedInstallationHours:
          isMeasurementWorkOrder && !effectiveSiteCanceled
            ? Number(estimatedInstallationHours.replace(",", "."))
            : undefined,
        workOrderType: workOrderData?.type as WorkOrderType | undefined,
      });

      resetForm();
      if (workOrderId) {
        setJobId(workOrderData?.job_id ?? "");
        setAddress(workOrderData?.job?.installation_address || "");
      }
      onOpenChange(false);
    } catch {
      /* toast u mutaciji */
    }
  };

  const toggleRowClass = "flex items-center justify-between gap-3 bg-muted/30 rounded-lg p-3";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reportVariant === "production" ? (
              <Factory className="w-5 h-5 text-primary shrink-0" />
            ) : (
              <MapPin className="w-5 h-5 text-primary shrink-0" />
            )}
            {workOrderData
              ? reportVariant === "mounting"
                ? `Montažni izveštaj — ${workOrderData.job?.job_number}`
                : reportVariant === "production"
                  ? `Izveštaj proizvodnje — ${workOrderData.job?.job_number}`
                  : `Terenski izveštaj — ${workOrderData.job?.job_number}`
              : "Novi terenski izveštaj"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!workOrderId && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Posao *</Label>
              <Select
                value={jobId}
                onValueChange={(v) => {
                  setJobId(v);
                  const job = jobs?.find((j) => j.id === v);
                  if (job) setAddress(job.installation_address || "");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite posao" />
                </SelectTrigger>
                <SelectContent>
                  {jobs?.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.job_number} — {Array.isArray(j.customer) ? j.customer[0]?.name : j.customer?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isProductionReport ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Posao / adresa ugradnje (referenca)</Label>
              <p className="text-sm rounded-md border border-border bg-muted/30 px-3 py-2">
                {workOrderData?.job?.installation_address?.trim() || address.trim() || "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Ovaj izveštaj je za rad u proizvodnji; adresa je veza ka poslu i ugradnji kod klijenta.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Adresa terena *</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Unesite adresu" />
            </div>
          )}

          {!isProductionReport && (
            <>
              <div className={cn(toggleRowClass, "flex-col items-stretch sm:flex-row sm:items-center")}>
                <div className="flex-1">
                  <Label className="text-sm cursor-pointer" htmlFor="arrived">
                    Da li si stigao na teren?
                  </Label>
                  <RecordedHint iso={arrivedAt} />
                </div>
                <Switch id="arrived" checked={arrived} onCheckedChange={(c) => toggleArrived(!!c)} />
              </div>

              <div className={cn(toggleRowClass, "flex-col items-stretch sm:flex-row sm:items-center")}>
                <div className="flex-1">
                  <Label className="text-sm cursor-pointer" htmlFor="canceled">
                    Da li je teren otkazan?
                  </Label>
                  <RecordedHint iso={canceledAt} />
                </div>
                <Switch id="canceled" checked={siteCanceled} onCheckedChange={(c) => toggleCanceled(!!c)} />
              </div>

              {siteCanceled && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Upiši razlog otkazivanja *</Label>
                  <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Razlog" />
                </div>
              )}
            </>
          )}

          <div className={cn(toggleRowClass, "flex-col items-stretch sm:flex-row sm:items-center")}>
            <div className="flex-1">
              <Label className="text-sm cursor-pointer" htmlFor="completed">
                {isProductionReport ? "Da li je posao u proizvodnji završen?" : "Da li si gotov?"}
              </Label>
              <RecordedHint iso={finishedAt} />
            </div>
            <Switch id="completed" checked={jobCompleted} onCheckedChange={(c) => toggleFinished(!!c)} />
          </div>

          <div className={cn(toggleRowClass, "flex-col items-stretch sm:flex-row sm:items-center")}>
            <div className="flex-1">
              <Label className="text-sm cursor-pointer" htmlFor="ok">
                Da li je sve bilo u redu?
              </Label>
              {!everythingOk ? <RecordedHint iso={issueReportedAt} /> : null}
            </div>
            <Switch id="ok" checked={everythingOk} onCheckedChange={(c) => toggleEverythingOk(!!c)} />
          </div>

          {!everythingOk && (
            <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/20">
              <p className="text-xs font-semibold text-foreground">Šta nije u redu / Nisu isporučeni elementi</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {MISSING_OPTIONS.map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2">
                    <Checkbox
                      checked={missingItemSelections.includes(item.key)}
                      onCheckedChange={(checked) => {
                        setMissingItemSelections((prev) =>
                          checked ? [...prev, item.key] : prev.filter((v) => v !== item.key),
                        );
                      }}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              {missingItemSelections.includes("drugi_delovi") && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Upiši koji *</Label>
                  <Input
                    value={missingDrugiText}
                    onChange={(e) => setMissingDrugiText(e.target.value)}
                    placeholder="Npr. okvir za roletnu…"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Dodatni opis (opciono)</Label>
                <Textarea value={issueNote} onChange={(e) => setIssueNote(e.target.value)} rows={2} />
              </div>
            </div>
          )}

          <div className={cn(toggleRowClass, "flex-col items-stretch sm:flex-row sm:items-center")}>
            <div className="flex-1">
              <Label className="text-sm cursor-pointer" htmlFor="additional-needs">
                Da li treba nešto još?
              </Label>
              {needsAdditionalItems ? <RecordedHint iso={additionalReqAt} /> : null}
            </div>
            <Switch id="additional-needs" checked={needsAdditionalItems} onCheckedChange={(c) => toggleAdditional(!!c)} />
          </div>

          {needsAdditionalItems && (
            <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/20">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ADDITIONAL_OPTIONS.map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2">
                    <Checkbox
                      checked={additionalNeedSelections.includes(item.key)}
                      onCheckedChange={(checked) => {
                        setAdditionalNeedSelections((prev) =>
                          checked ? [...prev, item.key] : prev.filter((v) => v !== item.key),
                        );
                      }}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              {additionalNeedSelections.includes("nesto_drugo") && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Upiši šta *</Label>
                  <Input
                    value={additionalNestoDrugoText}
                    onChange={(e) => setAdditionalNestoDrugoText(e.target.value)}
                    placeholder="Opis"
                  />
                </div>
              )}
            </div>
          )}

          {isMeasurementWorkOrder && (
            <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide">Merenje</p>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Upiši mere *</Label>
                <Textarea
                  value={measurements}
                  onChange={(e) => setMeasurements(e.target.value)}
                  placeholder="Mere, zapažanja…"
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Skica / fotografija (opciono)</Label>
                <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {images.map((img, i) => (
                    <div key={i} className="relative aspect-square rounded-md overflow-hidden group">
                      <img src={img} alt="Prilog" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-border rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                    {uploading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    ) : (
                      <Plus className="w-5 h-5 text-muted-foreground" />
                    )}
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={uploading}
                    />
                  </label>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Procenjeno vreme ugradnje (u satima) *
                </Label>
                <Input
                  type="number"
                  min={0.25}
                  step={0.25}
                  inputMode="decimal"
                  value={estimatedInstallationHours}
                  onChange={(e) => setEstimatedInstallationHours(e.target.value)}
                  placeholder="npr. 4"
                />
              </div>
            </div>
          )}

          {(!isMeasurementWorkOrder || reportVariant === "mounting") && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {reportVariant === "mounting"
                  ? "Slike i dokumentacija predaje *"
                  : reportVariant === "production"
                    ? "Fotografije / prilozi (opciono)"
                    : "Fotografije sa terena (opciono)"}
              </Label>
              <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((img, i) => (
                  <div key={i} className="relative aspect-square rounded-md overflow-hidden group">
                    <img
                      src={img}
                      alt={reportVariant === "production" ? "Prilog" : "Teren"}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-border rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                  {uploading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Plus className="w-5 h-5 text-muted-foreground" />
                  )}
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={uploading}
                  />
                </label>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {isProductionReport ? "Napiši izveštaj (proizvodnja) *" : "Napiši generalni izveštaj *"}
            </Label>
            <Textarea
              value={generalNotes}
              onChange={(e) => setGeneralNotes(e.target.value)}
              placeholder={
                isProductionReport
                  ? "Opis izvršenih radova, materijala, napomena za ugradnju…"
                  : "Kratak rezime poseta…"
              }
              rows={3}
            />
          </div>
        </div>

        <div className="flex gap-2 pt-3">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Otkaži
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={createReport.isPending || uploading}>
            {createReport.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Sačuvaj izveštaj
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
