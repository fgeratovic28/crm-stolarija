import { useState, useEffect } from "react";
import { MapPin, Calendar as CalendarIcon, Upload, X, Loader2, Image as ImageIcon, Plus } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldReports } from "@/hooks/use-field-reports";
import { fieldReportFlowForWorkOrderType } from "@/lib/field-team-access";
import type { WorkOrderType } from "@/types";

interface NewFieldReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId?: string;
}

export function NewFieldReportModal({ open, onOpenChange, workOrderId }: NewFieldReportModalProps) {
  const missingItemOptions = ["sol", "daska", "komarnici", "drugi delovi"];
  const additionalNeedOptions = ["sol", "daska", "komarnici"];
  const [jobId, setJobId] = useState("");
  const [address, setAddress] = useState("");
  const [arrived, setArrived] = useState(true);
  const [arrivalDate, setArrivalDate] = useState<Date>(new Date());
  const [jobCompleted, setJobCompleted] = useState(false);
  const [everythingOk, setEverythingOk] = useState(true);
  const [siteCanceled, setSiteCanceled] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [needsAdditionalItems, setNeedsAdditionalItems] = useState(false);
  const [measurements, setMeasurements] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [missingItems, setMissingItems] = useState("");
  const [missingItemSelections, setMissingItemSelections] = useState<string[]>([]);
  const [missingItemsOther, setMissingItemsOther] = useState("");
  const [additionalNeedSelections, setAdditionalNeedSelections] = useState<string[]>([]);
  const [additionalNeedsOther, setAdditionalNeedsOther] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
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

  useEffect(() => {
    if (workOrderData) {
      setJobId(workOrderData.job_id);
      setAddress(workOrderData.job?.installation_address || "");
    }
  }, [workOrderData]);

  const resetForm = () => {
    setJobId(""); setAddress(""); setArrived(true); setArrivalDate(new Date());
    setJobCompleted(false); setEverythingOk(true); setSiteCanceled(false);
    setCancelReason(""); setIssueDescription(""); setMeasurements("");
    setGeneralNotes(""); setMissingItems(""); setImages([]);
    setNeedsAdditionalItems(false);
    setMissingItemSelections([]); setMissingItemsOther("");
    setAdditionalNeedSelections([]); setAdditionalNeedsOther("");
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `field-reports/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('field-photos')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('field-photos')
          .getPublicUrl(filePath);

        setImages(prev => [...prev, publicUrl]);
      }
      toast({ title: "Slike uspešno otpremljene" });
    } catch (err) {
      console.error("Upload error:", err);
      toast({ title: "Greška pri otpremanju slika", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!jobId || !address) {
      toast({ title: "Popunite obavezna polja", variant: "destructive" });
      return;
    }
    if (images.length === 0) {
      toast({ title: "Dodajte bar jednu sliku", description: "Slika je obavezna za završetak naloga.", variant: "destructive" });
      return;
    }
    if (siteCanceled && !cancelReason.trim()) {
      toast({ title: "Unesite razlog otkazivanja", variant: "destructive" });
      return;
    }
    if (!siteCanceled && reportVariant === "field" && !measurements.trim()) {
      toast({ title: "Upišite mere", description: "Mere su obavezne za završetak naloga.", variant: "destructive" });
      return;
    }
    if (!generalNotes.trim()) {
      toast({ title: "Napišite generalni izveštaj", variant: "destructive" });
      return;
    }

    try {
      const resolvedMissingItems = [
        ...missingItemSelections,
        ...missingItems.split(",").map((s) => s.trim()).filter((s) => s !== ""),
        ...(missingItemsOther.trim() ? [missingItemsOther.trim()] : []),
      ];
      const resolvedAdditionalNeeds = [
        ...additionalNeedSelections,
        ...(additionalNeedsOther.trim() ? [additionalNeedsOther.trim()] : []),
      ];
      if (!everythingOk) {
        if (!issueDescription.trim()) {
          toast({ title: "Upišite šta nije u redu", variant: "destructive" });
          return;
        }
        if (resolvedMissingItems.length === 0) {
          toast({ title: "Izaberite šta nedostaje", variant: "destructive" });
          return;
        }
      }
      if (needsAdditionalItems && resolvedAdditionalNeeds.length === 0) {
        toast({ title: "Izaberite šta još treba", variant: "destructive" });
        return;
      }

      await createReport.mutateAsync({
        workOrderId,
        jobId,
        address,
        arrived,
        arrivalDate: arrivalDate.toISOString(),
        jobCompleted,
        everythingOk,
        issueDescription,
        images,
        missingItems: resolvedMissingItems,
        measurements,
        generalNotes,
        siteCanceled,
        cancelReason,
        additionalNeeds: resolvedAdditionalNeeds,
      });

      resetForm();
      onOpenChange(false);
    } catch (err) {
      // Error handled in mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            {workOrderData
              ? reportVariant === "mounting"
                ? `Montažni izveštaj — ${workOrderData.job?.job_number}`
                : `Izveštaj za nalog ${workOrderData.job?.job_number}`
              : "Novi terenski izveštaj"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!workOrderId && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Posao *</Label>
              <Select value={jobId} onValueChange={(v) => {
                setJobId(v);
                const job = jobs?.find(j => j.id === v);
                if (job) setAddress(job.installation_address || "");
              }}>
                <SelectTrigger><SelectValue placeholder="Izaberite posao" /></SelectTrigger>
                <SelectContent>
                  {jobs?.map(j => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.job_number} — {Array.isArray(j.customer) ? j.customer[0]?.name : j.customer?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Adresa terena *</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Unesite adresu" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Datum i vreme dolaska</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !arrivalDate && "text-muted-foreground")}>
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {arrivalDate ? format(arrivalDate, "dd.MM.yyyy HH:mm") : "Izaberite datum"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={arrivalDate} onSelect={(d) => d && setArrivalDate(d)} initialFocus className="p-3" />
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
              <Label className="text-sm cursor-pointer" htmlFor="arrived">Stigao na teren</Label>
              <Switch id="arrived" checked={arrived} onCheckedChange={setArrived} />
            </div>
            <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
              <Label className="text-sm cursor-pointer" htmlFor="completed">Posao završen</Label>
              <Switch id="completed" checked={jobCompleted} onCheckedChange={setJobCompleted} />
            </div>
            <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
              <Label className="text-sm cursor-pointer" htmlFor="ok">Sve u redu</Label>
              <Switch id="ok" checked={everythingOk} onCheckedChange={setEverythingOk} />
            </div>
            {reportVariant === "field" && (
              <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3 sm:col-span-2">
                <Label className="text-sm cursor-pointer" htmlFor="canceled">Teren otkazan</Label>
                <Switch id="canceled" checked={siteCanceled} onCheckedChange={setSiteCanceled} />
              </div>
            )}
          </div>

          {reportVariant === "field" && siteCanceled && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Razlog otkazivanja</Label>
              <Input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Unesite razlog" />
            </div>
          )}

          {!everythingOk && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Opis problema</Label>
              <Textarea value={issueDescription} onChange={e => setIssueDescription(e.target.value)} placeholder="Opišite pronađene probleme..." rows={3} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {reportVariant === "mounting" ? "Slike i dokumentacija predaje" : "Slike sa terena"}
            </Label>
            <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden group">
                  <img src={img} alt="Teren" className="w-full h-full object-cover" />
                  <button 
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-border rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : <Plus className="w-5 h-5 text-muted-foreground" />}
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
            </div>
          </div>

          {reportVariant === "field" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Mere / Zapažanja</Label>
              <Input value={measurements} onChange={e => setMeasurements(e.target.value)} placeholder="npr. P1: 120x140, P2: 80x120" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Šta nije u redu / nedostaje</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {missingItemOptions.map((item) => (
                <label key={item} className="flex items-center gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2">
                  <Checkbox
                    checked={missingItemSelections.includes(item)}
                    onCheckedChange={(checked) => {
                      setMissingItemSelections((prev) =>
                        checked ? [...prev, item] : prev.filter((v) => v !== item)
                      );
                    }}
                  />
                  {item}
                </label>
              ))}
            </div>
            <Input value={missingItemsOther} onChange={e => setMissingItemsOther(e.target.value)} placeholder="Nešto drugo..." />
            <Input value={missingItems} onChange={e => setMissingItems(e.target.value)} placeholder="Dodatno (razdvojeno zarezom)" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Da li treba nešto još</Label>
            <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
              <Label className="text-sm cursor-pointer" htmlFor="additional-needs">Treba dodatnih delova</Label>
              <Switch id="additional-needs" checked={needsAdditionalItems} onCheckedChange={setNeedsAdditionalItems} />
            </div>
            {needsAdditionalItems && (
              <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {additionalNeedOptions.map((item) => (
                <label key={item} className="flex items-center gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2">
                  <Checkbox
                    checked={additionalNeedSelections.includes(item)}
                    onCheckedChange={(checked) => {
                      setAdditionalNeedSelections((prev) =>
                        checked ? [...prev, item] : prev.filter((v) => v !== item)
                      );
                    }}
                  />
                  {item}
                </label>
              ))}
            </div>
            <Input value={additionalNeedsOther} onChange={e => setAdditionalNeedsOther(e.target.value)} placeholder="Nešto drugo..." />
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Opšte napomene</Label>
            <Textarea value={generalNotes} onChange={e => setGeneralNotes(e.target.value)} placeholder="Dodatne napomene..." rows={3} />
          </div>
        </div>

        <div className="flex gap-2 pt-3">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={createReport.isPending || uploading}>
            {createReport.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Sačuvaj izveštaj
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
