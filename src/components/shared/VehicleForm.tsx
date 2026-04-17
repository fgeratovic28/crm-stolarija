import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Loader2, Plus, Upload, X } from "lucide-react";
import type { Vehicle, VehicleStatus } from "@/types";

const vehicleSchema = z.object({
  vehicleName: z.string().trim().min(2, "Naziv/oznaka je obavezna"),
  registrationNumber: z.string().trim().optional(),
  brandModel: z.string().trim().optional(),
  status: z.enum(["active", "in_service", "archived"]).default("active"),
  registrationDate: z.string().trim().optional(),
  expirationDate: z.string().trim().optional(),
  serviceNotes: z.string().trim().optional(),
  serviceKilometers: z.coerce.number().int().min(0, "Kilometraža ne može biti negativna").optional(),
  assignedWorkerId: z.string().trim().optional(),
  generalNotes: z.string().trim().optional(),
  lastServiceDate: z.string().trim().optional(),
  trafficPermitImageUrl: z.string().trim().optional().or(z.literal("")),
  insuranceImageUrl: z.string().trim().optional().or(z.literal("")),
  serviceRecordImageUrl: z.string().trim().optional().or(z.literal("")),
  additionalImageUrls: z.array(z.string()).optional(),
});

export type VehicleFormValues = z.infer<typeof vehicleSchema>;

export interface VehicleFormWorkerOption {
  id: string;
  name: string;
}

interface VehicleFormProps {
  initialData?: Partial<Vehicle>;
  workers: VehicleFormWorkerOption[];
  onSubmit: (data: VehicleFormValues) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const STATUS_OPTIONS: { value: VehicleStatus; label: string }[] = [
  { value: "active", label: "Aktivno" },
  { value: "in_service", label: "U servisu" },
  { value: "archived", label: "Arhivirano" },
];
const UNASSIGNED_WORKER_VALUE = "__unassigned__";

function addOneYear(dateValue: string): string {
  const [yearRaw, monthRaw, dayRaw] = dateValue.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!year || !month || !day) return "";

  const targetYear = year + 1;
  const lastDayOfTargetMonth = new Date(targetYear, month, 0).getDate();
  const safeDay = Math.min(day, lastDayOfTargetMonth);

  const yyyy = String(targetYear);
  const mm = String(month).padStart(2, "0");
  const dd = String(safeDay).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function VehicleForm({ initialData, workers, onSubmit, onCancel, isLoading }: VehicleFormProps) {
  const [autoExpiration, setAutoExpiration] = useState(true);
  const [uploading, setUploading] = useState(false);

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      vehicleName: initialData?.vehicleName ?? "",
      registrationNumber: initialData?.registrationNumber ?? "",
      brandModel: initialData?.brandModel ?? "",
      status: initialData?.status ?? "active",
      registrationDate: initialData?.registrationDate ?? "",
      expirationDate: initialData?.expirationDate ?? "",
      serviceNotes: initialData?.serviceNotes ?? "",
      serviceKilometers: initialData?.serviceKilometers ?? undefined,
      assignedWorkerId: initialData?.assignedWorkerId ?? "",
      generalNotes: initialData?.generalNotes ?? "",
      lastServiceDate: initialData?.lastServiceDate ?? "",
      trafficPermitImageUrl: initialData?.trafficPermitImageUrl ?? "",
      insuranceImageUrl: initialData?.insuranceImageUrl ?? "",
      serviceRecordImageUrl: initialData?.serviceRecordImageUrl ?? "",
      additionalImageUrls: initialData?.additionalImageUrls ?? [],
    },
  });

  const registrationDate = form.watch("registrationDate");

  useEffect(() => {
    if (!initialData?.id) {
      setAutoExpiration(true);
      return;
    }

    if (initialData.registrationDate && initialData.expirationDate) {
      setAutoExpiration(addOneYear(initialData.registrationDate) === initialData.expirationDate);
      return;
    }

    setAutoExpiration(false);
  }, [initialData]);

  useEffect(() => {
    if (!autoExpiration || !registrationDate) return;
    const computedExpiration = addOneYear(registrationDate);
    if (!computedExpiration) return;
    form.setValue("expirationDate", computedExpiration, { shouldDirty: true, shouldValidate: true });
  }, [registrationDate, form, autoExpiration]);

  const trafficPermitImageUrl = form.watch("trafficPermitImageUrl");
  const insuranceImageUrl = form.watch("insuranceImageUrl");
  const serviceRecordImageUrl = form.watch("serviceRecordImageUrl");
  const additionalImageUrls = form.watch("additionalImageUrls") ?? [];

  const uploadToStorage = async (file: File) => {
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `vehicles/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("field-photos").upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from("field-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSingleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    fieldName: "trafficPermitImageUrl" | "insuranceImageUrl" | "serviceRecordImageUrl",
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToStorage(file);
      form.setValue(fieldName, url, { shouldDirty: true, shouldValidate: true });
      toast.success("Slika uspešno dodata");
    } catch (err) {
      toast.error("Greška pri otpremanju slike");
    } finally {
      setUploading(false);
    }
  };

  const handleSingleImageReplace = async (
    e: React.ChangeEvent<HTMLInputElement>,
    fieldName: "trafficPermitImageUrl" | "insuranceImageUrl" | "serviceRecordImageUrl",
  ) => {
    await handleSingleImageUpload(e, fieldName);
  };

  const handleAdditionalImagesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map((f) => uploadToStorage(f)));
      form.setValue("additionalImageUrls", [...additionalImageUrls, ...uploaded], {
        shouldDirty: true,
        shouldValidate: true,
      });
      toast.success("Dodatne slike uspešno dodate");
    } catch {
      toast.error("Greška pri otpremanju dodatnih slika");
    } finally {
      setUploading(false);
    }
  };

  const handleAdditionalImageReplace = async (e: React.ChangeEvent<HTMLInputElement>, replaceIndex: number) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const uploadedUrl = await uploadToStorage(file);
      const next = [...additionalImageUrls];
      next[replaceIndex] = uploadedUrl;
      form.setValue("additionalImageUrls", next, { shouldDirty: true, shouldValidate: true });
      toast.success("Slika uspešno zamenjena");
    } catch {
      toast.error("Greška pri zameni slike");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="vehicleName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Naziv / oznaka vozila</FormLabel>
                <FormControl>
                  <Input placeholder="npr. Putničko kombi 1" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="registrationNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registracija</FormLabel>
                <FormControl>
                  <Input placeholder="npr. BG-123-AA" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="brandModel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Marka / model</FormLabel>
                <FormControl>
                  <Input placeholder="npr. VW T5" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={(v: VehicleStatus) => field.onChange(v)} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Izaberite status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="registrationDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Datum registracije</FormLabel>
                <FormControl>
                  <Input type="date" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="expirationDate"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-2">
                  <FormLabel>Isteka registracije</FormLabel>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={autoExpiration}
                      onCheckedChange={(checked) => {
                        const next = !!checked;
                        setAutoExpiration(next);
                        if (next && registrationDate) {
                          const computedExpiration = addOneYear(registrationDate);
                          if (computedExpiration) {
                            form.setValue("expirationDate", computedExpiration, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }
                        }
                      }}
                    />
                    <span className="text-xs text-muted-foreground">Auto (+1 godina)</span>
                  </div>
                </div>
                <FormControl>
                  <Input type="date" {...field} value={field.value ?? ""} disabled={autoExpiration} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="assignedWorkerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Zaduženi radnik / vozač</FormLabel>
                <Select
                  onValueChange={(value) => field.onChange(value === UNASSIGNED_WORKER_VALUE ? "" : value)}
                  value={field.value && field.value.length > 0 ? field.value : UNASSIGNED_WORKER_VALUE}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Nije dodeljeno" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED_WORKER_VALUE}>Nije dodeljeno</SelectItem>
                    {workers.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lastServiceDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Datum zadnjeg servisa</FormLabel>
                <FormControl>
                  <Input type="date" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="serviceKilometers"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Servis rađen na (km)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                    placeholder="npr. 125000"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="serviceNotes"
            render={({ field }) => (
              <FormItem className="md:col-span-1">
                <FormLabel>Servis napomena</FormLabel>
                <FormControl>
                  <Textarea placeholder="Kratke napomene o servisu..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="generalNotes"
            render={({ field }) => (
              <FormItem className="md:col-span-1">
                <FormLabel>Opšta napomena</FormLabel>
                <FormControl>
                  <Textarea placeholder="Dodatne napomene o vozilu..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormItem>
            <FormLabel>Saobraćajna</FormLabel>
            <div className="space-y-2">
              <label className="flex items-center justify-center gap-2 h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span className="text-sm">Dodaj sliku</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleSingleImageUpload(e, "trafficPermitImageUrl")} />
              </label>
              {trafficPermitImageUrl && (
                <div className="relative w-24 h-24 rounded-md overflow-hidden border">
                  <label className="absolute inset-0 cursor-pointer">
                    <img src={trafficPermitImageUrl} alt="Saobraćajna" className="w-full h-full object-cover" />
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => void handleSingleImageReplace(e, "trafficPermitImageUrl")}
                    />
                  </label>
                  <button type="button" onClick={() => form.setValue("trafficPermitImageUrl", "")} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </FormItem>

          <FormItem>
            <FormLabel>Osiguranje</FormLabel>
            <div className="space-y-2">
              <label className="flex items-center justify-center gap-2 h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span className="text-sm">Dodaj sliku</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleSingleImageUpload(e, "insuranceImageUrl")} />
              </label>
              {insuranceImageUrl && (
                <div className="relative w-24 h-24 rounded-md overflow-hidden border">
                  <label className="absolute inset-0 cursor-pointer">
                    <img src={insuranceImageUrl} alt="Osiguranje" className="w-full h-full object-cover" />
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => void handleSingleImageReplace(e, "insuranceImageUrl")}
                    />
                  </label>
                  <button type="button" onClick={() => form.setValue("insuranceImageUrl", "")} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </FormItem>

          <FormItem className="md:col-span-2">
            <FormLabel>Servisna evidencija</FormLabel>
            <div className="space-y-2">
              <label className="flex items-center justify-center gap-2 h-24 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span className="text-sm">Dodaj sliku</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleSingleImageUpload(e, "serviceRecordImageUrl")} />
              </label>
              {serviceRecordImageUrl && (
                <div className="relative w-24 h-24 rounded-md overflow-hidden border">
                  <label className="absolute inset-0 cursor-pointer">
                    <img src={serviceRecordImageUrl} alt="Servisna evidencija" className="w-full h-full object-cover" />
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => void handleSingleImageReplace(e, "serviceRecordImageUrl")}
                    />
                  </label>
                  <button type="button" onClick={() => form.setValue("serviceRecordImageUrl", "")} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </FormItem>

          <FormItem className="md:col-span-2">
            <FormLabel>Dodatne slike</FormLabel>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {additionalImageUrls.map((url, idx) => (
                <div key={url + idx} className="relative aspect-square rounded-md overflow-hidden border">
                  <label className="absolute inset-0 cursor-pointer">
                    <img src={url} alt={`Dodatna ${idx + 1}`} className="w-full h-full object-cover" />
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => void handleAdditionalImageReplace(e, idx)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => form.setValue("additionalImageUrls", additionalImageUrls.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-border rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : <Plus className="w-5 h-5 text-muted-foreground" />}
                <input type="file" multiple accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleAdditionalImagesUpload(e)} />
              </label>
            </div>
          </FormItem>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end sm:gap-3 [&>button]:w-full sm:[&>button]:w-auto">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Otkaži
          </Button>
          <Button type="submit" disabled={isLoading}>
            {initialData?.id ? "Sačuvaj izmene" : "Kreiraj vozilo"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

