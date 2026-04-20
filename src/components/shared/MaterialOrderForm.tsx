import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import type { Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useJobsListSimple } from "@/hooks/use-jobs";
import type { MaterialOrder, MaterialOrderLine, MaterialType } from "@/types";
import {
  orderSchema,
  type MaterialOrderFormValues,
  type NarudzbenicaFieldsValues,
  narudzbenicaDefaultsFromOrder,
  totalNetFromFormLines,
} from "@/lib/material-order-form-schema";
import { NarudzbenicaFields } from "@/components/shared/NarudzbenicaFields";
import { lineMaterialOptionsForSupplier } from "@/lib/material-type-options";

export type { MaterialOrderFormValues } from "@/lib/material-order-form-schema";

const EMPTY_NB_DEFAULTS = {
  nbLines: [{ description: "", quantity: 1, unit: "kom", lineNet: 0, materialType: undefined as string | undefined }],
  nbVatRatePercent: 20,
  nbBuyerBankAccount: "",
  nbShippingMethod: "",
  nbPaymentDueDate: "",
  nbPaymentNote: "",
  nbLegalReference: "",
  nbDeliveryAddressOverride: "",
};

const DELIVERY_STATUSES = [
  { value: "pending", label: "Na čekanju" },
  { value: "shipped", label: "Poslato" },
  { value: "delivered", label: "Isporučeno" },
  { value: "partial", label: "Delimično isporučeno" },
];

interface MaterialOrderFormProps {
  jobId?: string;
  initialData?: Partial<MaterialOrder>;
  /** Uključuje i izračunata polja (supplier, orderDate, …) nakon slanja. */
  onSubmit: (data: MaterialOrderFormValues & Record<string, unknown>) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function MaterialOrderForm({ jobId, initialData, onSubmit, onCancel, isLoading }: MaterialOrderFormProps) {
  const { suppliers } = useSuppliers();
  const { data: jobs } = useJobsListSimple();
  const activeSuppliers = suppliers?.filter(s => s.active) || [];
  const hasFixedJob = Boolean(jobId);

  const nbBlock =
    initialData?.id != null
      ? narudzbenicaDefaultsFromOrder(initialData as MaterialOrder)
      : EMPTY_NB_DEFAULTS;

  const initialMaterialTypeFromLines =
    (initialData as MaterialOrder | undefined)?.nbLines?.find((l) => l.materialType)?.materialType;
  const resolvedInitialMaterialType =
    (initialMaterialTypeFromLines as MaterialType | undefined) ||
    initialData?.materialType ||
    "other";

  const form = useForm<MaterialOrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      jobId: jobId || initialData?.jobId || "",
      materialType: resolvedInitialMaterialType,
      supplierId: initialData?.supplierId || "",
      requestDate: initialData?.requestDate || new Date().toISOString().split("T")[0],
      expectedDelivery: initialData?.expectedDelivery || "",
      deliveryDate: initialData?.deliveryDate || "",
      price:
        initialData?.id != null
          ? totalNetFromFormLines(nbBlock.nbLines)
          : (initialData?.price ?? 0),
      paid: initialData?.paid ?? false,
      deliveryVerified: initialData?.deliveryVerified ?? false,
      deliveryStatus: initialData?.deliveryStatus || "pending",
      notes: initialData?.notes || "",
      barcode: initialData?.barcode || "",
      allDelivered: initialData?.allDelivered ?? false,
      ...nbBlock,
    },
  });

  const selectedSupplierId = form.watch("supplierId");
  const selectedSupplier = suppliers?.find(s => s.id === selectedSupplierId);
  const nbLinesWatch = form.watch("nbLines");

  const lineMaterialTypeOptions = useMemo(
    () => lineMaterialOptionsForSupplier(selectedSupplier),
    [selectedSupplier],
  );

  useEffect(() => {
    const lines = nbLinesWatch ?? [];
    const t = totalNetFromFormLines(lines);
    form.setValue("price", t, { shouldValidate: true, shouldDirty: false });
  }, [nbLinesWatch, form]);

  useEffect(() => {
    const allowed = new Set(lineMaterialTypeOptions.map((o) => o.value));
    const lines = form.getValues("nbLines") ?? [];
    let changed = false;
    const next = lines.map((l) => {
      const mt = l.materialType as MaterialType | undefined;
      if (mt && !allowed.has(mt)) {
        changed = true;
        return { ...l, materialType: undefined };
      }
      return l;
    });
    if (changed) form.setValue("nbLines", next, { shouldValidate: true });
  }, [selectedSupplierId, lineMaterialTypeOptions, form]);

  useEffect(() => {
    const lines = nbLinesWatch ?? [];
    const fromLine = lines.find((l) => l.materialType)?.materialType as MaterialType | undefined;
    form.setValue("materialType", fromLine ?? "other", { shouldValidate: true, shouldDirty: false });
  }, [nbLinesWatch, form]);

  const handleInternalSubmit = (data: MaterialOrderFormValues) => {
    const total = totalNetFromFormLines(data.nbLines);
    const nbLinesOut: MaterialOrderLine[] = data.nbLines.map((l) => ({
      description: l.description.trim(),
      quantity: l.quantity,
      unit: l.unit.trim(),
      lineNet: Math.round(l.lineNet * 100) / 100,
      ...(l.materialType && String(l.materialType).length > 0
        ? { materialType: l.materialType as MaterialType }
        : {}),
    }));
    const primaryMaterial =
      (data.nbLines.find((l) => l.materialType)?.materialType as MaterialType | undefined) ?? "other";
    const submissionData = {
      ...data,
      materialType: primaryMaterial,
      price: total,
      supplier: selectedSupplier?.name || "",
      supplierContact: selectedSupplier?.contactPerson || selectedSupplier?.phone || "",
      orderDate: data.requestDate,
      supplierPrice: total,
      quantityVerified: data.deliveryVerified,
      nbLines: nbLinesOut,
    };
    onSubmit(submissionData);
  };

  const nbControl = form.control as unknown as Control<NarudzbenicaFieldsValues>;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleInternalSubmit)} className="space-y-8">
        <section className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Narudžbina (kartica u CRM-u)</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Dobavljač, posao, datumi i status isporuke vide se samo ovde — ne ulaze na štampanu porudžbenicu.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dobavljač</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Izaberite dobavljača" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeSuppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
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
              name="jobId"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Posao (opciono)</FormLabel>
                    {!hasFixedJob && field.value && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-2 py-1 text-xs"
                        onClick={() => field.onChange("")}
                      >
                        Bez povezanog posla
                      </Button>
                    )}
                  </div>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={hasFixedJob}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Izaberite posao" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(jobs || []).map((job) => (
                        <SelectItem key={job.id} value={job.id}>
                          {job.job_number}
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
              name="requestDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Datum narudžbine</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expectedDelivery"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Očekivana isporuka</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="deliveryStatus"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Status isporuke</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DELIVERY_STATUSES.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="paid"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="font-normal cursor-pointer">Plaćeno dobavljaču</FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="deliveryVerified"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="font-normal cursor-pointer">Isporuka verifikovana</FormLabel>
                </FormItem>
              )}
            />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-muted/20 p-4 sm:p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Porudžbenica (štampa i javni link)</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Stavke (materijal po šifarniku dobavljača), PDV, plaćanje i adrese idu na dokument. Ukupno se računa iz stavki.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="barcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Referenca / barkod (na štampi uz stavku ako je u opisu)</FormLabel>
                  <FormControl>
                    <Input placeholder="Opciono" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Napomena na porudžbenici</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Tekst u futeru štampanog dokumenta…" rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <NarudzbenicaFields control={nbControl} lineMaterialTypeOptions={lineMaterialTypeOptions} />
        </section>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end sm:gap-3 [&>button]:w-full sm:[&>button]:w-auto">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Otkaži
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Čuvanje..." : "Sačuvaj narudžbinu"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
