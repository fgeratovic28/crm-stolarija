import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useJobsListSimple } from "@/hooks/use-jobs";
import type { MaterialOrder, MaterialOrderLine, MaterialType } from "@/types";
import {
  orderSchema,
  type MaterialOrderFormValues,
  type NarudzbenicaFieldsValues,
  narudzbenicaDefaultsFromOrder,
  narudzbenicaDefaultsFromSupplier,
  totalNetFromFormLines,
} from "@/lib/material-order-form-schema";
import { buildDraftMaterialOrderProcurementPdfBlob } from "@/lib/export-documents";
import { parseMaterialOrderItemsJson } from "@/lib/material-order-items-json";
import { materialOrderFormLinesToMaterialOrderLines } from "@/lib/material-order-form-lines-mapper";
import { readAppSettingsCache } from "@/lib/app-settings";
import { supabase } from "@/lib/supabase";
import {
  canonicalizeStoredMemoryLookupKey,
  lookupItemCodeInMemoryMap,
  normalizeArticleLookupKey,
  normalizeItemCodeLookupKey,
  spreadsheetCellToPlainString,
  type ItemCodeLookupInput,
} from "@/lib/material-item-code-memory-keys";
import {
  collectRememberableCodesFromMaterialOrderForm,
  mergeItemsIntoMemoryMap,
  mergeRememberableItemCodes,
  type RememberableItemCode,
  upsertMaterialItemCodeMemory,
} from "@/lib/material-item-code-memory-persist";
import { NarudzbenicaFields } from "@/components/shared/NarudzbenicaFields";
import { MaterialOrderExcelImportSection } from "@/components/shared/MaterialOrderExcelImportSection";
import { MaterialOrderImportedLinesCollapsible } from "@/components/shared/MaterialOrderImportedLinesCollapsible";
import { cn } from "@/lib/utils";
import { materialOrderDeliveryStatusEditOptions } from "@/lib/material-order-delivery-status";

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

function extractItemCodesFromNbLinesRows(rows: Array<{ nb_lines: unknown }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!Array.isArray(row.nb_lines)) continue;
    for (const item of row.nb_lines) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const pmRaw = o.procurementMeta;
      const pm = pmRaw && typeof pmRaw === "object" ? (pmRaw as Record<string, unknown>) : null;
      const code = String(pm?.article_code ?? "").trim();
      if (!code) continue;
      const articleName = spreadsheetCellToPlainString(pm?.article ?? o.description ?? "");
      if (!articleName) continue;
      const pos = spreadsheetCellToPlainString(pm?.position ?? "");
      const lenRaw = pm?.length_mm;
      const len =
        lenRaw != null && Number.isFinite(Number(lenRaw))
          ? Math.round(Number(lenRaw))
          : null;
      const k = normalizeItemCodeLookupKey({
        article: articleName,
        position: pos,
        lengthMm: len,
      });
      if (!k || out[k]) continue;
      out[k] = code;
    }
  }
  return out;
}

function mapSupplierCategoryToMaterialType(
  category?: string | null,
): MaterialType {
  const c = String(category ?? "").trim();
  if (!c) return "other";
  switch (c) {
    case "Profili":
      return "profile";
    case "Staklo":
      return "glass";
    case "Okov":
      return "hardware";
    case "Roletne/Kupovno":
    case "Ostalo":
      return "other";
    default:
      break;
  }
  switch (c.toLowerCase()) {
    case "profile":
      return "profile";
    case "glass":
      return "glass";
    case "hardware":
      return "hardware";
    case "shutters":
      return "shutters";
    case "mosquito_net":
      return "mosquito_net";
    case "sills":
      return "sills";
    case "boards":
      return "boards";
    case "sealant":
      return "sealant";
    case "other":
      return "other";
    default:
      return "other";
  }
}

interface MaterialOrderFormProps {
  jobId?: string;
  initialData?: Partial<MaterialOrder>;
  /** Uključuje i izračunata polja (supplier, orderDate, …) nakon slanja. */
  onSubmit: (data: MaterialOrderFormValues & Record<string, unknown>) => void;
  onCancel: () => void;
  isLoading?: boolean;
  /** Prepis teksta na dugmetu za slanje (npr. Porudžbina po nedostatku). */
  submitButtonLabel?: string;
}

export function MaterialOrderForm({
  jobId,
  initialData,
  onSubmit,
  onCancel,
  isLoading,
  submitButtonLabel,
}: MaterialOrderFormProps) {
  const { suppliers } = useSuppliers();
  const { data: jobs } = useJobsListSimple();
  const activeSuppliers = suppliers?.filter(s => s.active) || [];
  const hasFixedJob = Boolean(jobId);
  const isEditOrder = Boolean(initialData?.id);
  const deliveryStatusOptions = useMemo(
    () =>
      isEditOrder ? materialOrderDeliveryStatusEditOptions(initialData?.deliveryStatus) : [],
    [isEditOrder, initialData?.deliveryStatus],
  );

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
      requiredForProductionStart: initialData?.requiredForProductionStart ?? false,
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
      itemsJson:
        initialData?.id != null ? undefined : (parseMaterialOrderItemsJson(initialData?.itemsJson) ?? undefined),
      ...nbBlock,
    },
  });

  const supplierIdWatch = useWatch({ control: form.control, name: "supplierId" });
  const requestDateWatch = useWatch({ control: form.control, name: "requestDate" });
  const nbLinesWatch = useWatch({ control: form.control, name: "nbLines" });
  const jobIdWatch = useWatch({ control: form.control, name: "jobId" });
  const notesWatch = useWatch({ control: form.control, name: "notes" });
  const itemsJsonWatch = useWatch({ control: form.control, name: "itemsJson" });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewObjectUrlRef = useRef<string | null>(null);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [itemCodeMemory, setItemCodeMemory] = useState<Record<string, string>>({});

  const resolveRememberedItemCode = useMemo(
    () => (lookup: ItemCodeLookupInput): string | undefined =>
      lookupItemCodeInMemoryMap(itemCodeMemory, lookup),
    [itemCodeMemory],
  );

  const rememberItemCodes = useCallback(async (items: RememberableItemCode[]) => {
    if (items.length === 0) return;
    const result = await upsertMaterialItemCodeMemory(supabase, items);
    if (!result.ok) {
      toast.error(`Šifra artikla nije sačuvana u bazu: ${result.error}`);
      return;
    }
    const merged = mergeRememberableItemCodes(items);
    setItemCodeMemory((prev) => mergeItemsIntoMemoryMap(prev, merged));
  }, []);

  const jobNumberLabel = useMemo(() => {
    const id = jobIdWatch?.trim();
    if (!id) return "—";
    const j = jobs?.find((x) => x.id === id);
    return (j?.job_number ?? "").trim() || "—";
  }, [jobIdWatch, jobs]);

  const jobsGroupedByCustomer = useMemo(() => {
    const source = jobs ?? [];
    const map = new Map<string, { customerName: string; jobs: typeof source }>();
    for (const j of source) {
      const customerName = j.customer?.fullName?.trim() || "Bez kupca";
      const key = j.customer?.id || `no-customer:${customerName}`;
      const prev = map.get(key);
      if (prev) {
        prev.jobs.push(j);
      } else {
        map.set(key, { customerName, jobs: [j] });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.customerName.localeCompare(b.customerName, "sr"));
  }, [jobs]);

  const selectedJob = useMemo(
    () => (jobs ?? []).find((j) => j.id === jobIdWatch),
    [jobs, jobIdWatch],
  );

  useEffect(() => {
    if (isEditOrder) {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    const tick = window.setTimeout(() => {
      void (async () => {
        setPreviewBusy(true);
        try {
          const ij = parseMaterialOrderItemsJson(form.getValues("itemsJson"));
          const blob = await buildDraftMaterialOrderProcurementPdfBlob({
            itemsJson: ij ?? undefined,
            nbLines: form.getValues("nbLines") ?? [],
            jobId: form.getValues("jobId")?.trim() || undefined,
            jobNumberLabel,
            notes: notesWatch ?? "",
          });
          if (cancelled) return;
          if (!blob) {
            if (previewObjectUrlRef.current) {
              URL.revokeObjectURL(previewObjectUrlRef.current);
              previewObjectUrlRef.current = null;
            }
            setPreviewUrl(null);
            return;
          }
          const url = URL.createObjectURL(blob);
          if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
          previewObjectUrlRef.current = url;
          setPreviewUrl(url);
        } catch {
          if (!cancelled) setPreviewUrl(null);
        } finally {
          if (!cancelled) setPreviewBusy(false);
        }
      })();
    }, 480);
    return () => {
      cancelled = true;
      window.clearTimeout(tick);
    };
  }, [isEditOrder, itemsJsonWatch, nbLinesWatch, jobIdWatch, notesWatch, jobNumberLabel]);

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isEditOrder || !supplierIdWatch) return;
    const sup = suppliers?.find((s) => s.id === supplierIdWatch);
    if (!sup) return;
    const req = requestDateWatch || new Date().toISOString().split("T")[0];
    const d = narudzbenicaDefaultsFromSupplier(sup, req);
    form.setValue("nbShippingMethod", d.nbShippingMethod, { shouldDirty: true });
    form.setValue("nbPaymentDueDate", d.nbPaymentDueDate, { shouldDirty: true });
    form.setValue("nbPaymentNote", d.nbPaymentNote, { shouldDirty: true });
    form.setValue("nbLegalReference", d.nbLegalReference, { shouldDirty: true });
    form.setValue("nbDeliveryAddressOverride", d.nbDeliveryAddressOverride, { shouldDirty: true });
    form.setValue("materialType", mapSupplierCategoryToMaterialType(sup.category), { shouldDirty: true });
  }, [isEditOrder, supplierIdWatch, requestDateWatch, suppliers, form]);

  useEffect(() => {
    let cancelled = false;
    const loadItemCodeMemory = async () => {
      const { data: memoryRows, error: memoryError } = await supabase
        .from("material_item_code_memory")
        .select("normalized_lookup_key, article_name, article_code")
        .not("article_code", "is", null)
        .limit(5000);
      if (!cancelled && !memoryError && memoryRows && memoryRows.length > 0) {
        const direct: Record<string, string> = {};
        for (const row of memoryRows as Array<{ normalized_lookup_key?: string | null; article_name: string | null; article_code: string | null }>) {
          const articleName = spreadsheetCellToPlainString(row.article_name ?? "");
          const code = String(row.article_code ?? "").trim();
          if (!articleName || !code) continue;
          const full = String(row.normalized_lookup_key ?? "").trim();
          if (full) {
            direct[full] = code;
            const canon = canonicalizeStoredMemoryLookupKey(full);
            if (canon !== full) direct[canon] = code;
          }
          direct[normalizeArticleLookupKey(articleName)] = code;
        }
        setItemCodeMemory(direct);
        return;
      }

      const { data, error } = await supabase
        .from("material_orders")
        .select("nb_lines, created_at")
        .not("nb_lines", "is", null)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (cancelled || error || !data) return;
      if (!cancelled) setItemCodeMemory(extractItemCodesFromNbLinesRows(data as Array<{ nb_lines: unknown }>));
    };

    void loadItemCodeMemory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!nbLinesWatch?.length) return;
    for (let i = 0; i < nbLinesWatch.length; i += 1) {
      const line = nbLinesWatch[i];
      const currentCode = String(line.procurementMeta?.article_code ?? "").trim();
      if (currentCode) continue;
      const articleName = spreadsheetCellToPlainString(
        line.procurementMeta?.article ?? line.description ?? "",
      );
      if (!articleName) continue;
      const rememberedCode = resolveRememberedItemCode({
        article: articleName,
        position: line.procurementMeta?.position,
        lengthMm: line.procurementMeta?.length_mm ?? null,
      });
      if (!rememberedCode) continue;
      form.setValue(`nbLines.${i}.procurementMeta.article_code`, rememberedCode, {
        shouldDirty: true,
        shouldValidate: false,
      });
    }
  }, [nbLinesWatch, resolveRememberedItemCode, form]);

  const handleInternalSubmit = async (data: MaterialOrderFormValues) => {
    const selectedSupplier = suppliers?.find((s) => s.id === data.supplierId);
    const isNewOrder = !initialData?.id;
    const total = isNewOrder ? 0 : totalNetFromFormLines(data.nbLines);
    const nbLinesOut: MaterialOrderLine[] = materialOrderFormLinesToMaterialOrderLines(data.nbLines, {
      zeroLineNet: isNewOrder,
    });
    const supplierMaterial = mapSupplierCategoryToMaterialType(selectedSupplier?.category);
    const primaryMaterial = isNewOrder
      ? supplierMaterial
      : ((data.materialType as MaterialType) || supplierMaterial);
    const companyBank = readAppSettingsCache().companyBankAccount?.trim();
    const submissionData = {
      ...data,
      materialType: primaryMaterial,
      price: total,
      supplier: selectedSupplier?.name || "",
      supplierContact: selectedSupplier?.contactPerson || selectedSupplier?.phone || "",
      supplierAddress: selectedSupplier?.address || undefined,
      orderDate: data.requestDate,
      supplierPrice: total,
      quantityVerified: data.deliveryVerified,
      nbLines: nbLinesOut,
      nbBuyerBankAccount: companyBank || data.nbBuyerBankAccount?.trim() || undefined,
    };

    const toRemember = collectRememberableCodesFromMaterialOrderForm(data);
    if (toRemember.length > 0) {
      const mem = await upsertMaterialItemCodeMemory(supabase, toRemember);
      if (!mem.ok) {
        toast.error(`Šifre artikala nisu sačuvane u memoriju baze: ${mem.error}`);
      } else {
        setItemCodeMemory((prev) => mergeItemsIntoMemoryMap(prev, toRemember));
      }
    }

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
              Dobavljač, posao, datum narudžbine i status isporuke vide se samo ovde — ne ulaze na štampanu porudžbenicu.
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
                  <FormLabel>Kupac / posao *</FormLabel>
                  <Popover open={jobPickerOpen} onOpenChange={setJobPickerOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          disabled={hasFixedJob}
                          className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}
                        >
                          {selectedJob
                            ? `${selectedJob.customer?.fullName ?? "Bez kupca"} · ${selectedJob.job_number}`
                            : "Pretražite kupca ili posao..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Pretraga kupca ili broja posla..." />
                        <CommandList>
                          <CommandEmpty>Nema rezultata.</CommandEmpty>
                          {jobsGroupedByCustomer.map((group) => (
                            <CommandGroup key={group.customerName} heading={group.customerName}>
                              {group.jobs.map((job) => (
                                <CommandItem
                                  key={job.id}
                                  value={`${group.customerName} ${job.job_number} ${job.summary ?? ""}`}
                                  onSelect={() => {
                                    field.onChange(job.id);
                                    setJobPickerOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      field.value === job.id ? "opacity-100" : "opacity-0",
                                    )}
                                  />
                                  <span className="font-medium">{job.job_number}</span>
                                  {job.summary?.trim() ? (
                                    <span className="ml-2 line-clamp-1 text-xs text-muted-foreground">{job.summary}</span>
                                  ) : null}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
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

            {isEditOrder ? (
              <FormField
                control={form.control}
                name="deliveryStatus"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Status isporuke</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {deliveryStatusOptions.map((status) => (
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
            ) : null}

            <FormField
              control={form.control}
              name="requiredForProductionStart"
              render={({ field }) => (
                <FormItem className="md:col-span-2 flex flex-row items-start space-x-3 space-y-0 rounded-md border border-border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Ovaj materijal je potreban za početak proizvodnje</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Kada je označeno, po prijemu ove narudžbine posao može preći u status „Delimično u proizvodnji“
                      (iako ostale porudžbine još nisu primljene).
                    </p>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="barcode"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Referenca</FormLabel>
                  <FormControl>
                    <Input placeholder="Opciono — interna referenca na kartici" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-muted/20 p-4 sm:p-5 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Porudžbenica (štampa)</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {isEditOrder
                ? "Stavke i PDV možete menjati ispod. PDF porudžbine štampajte sa kartice narudžbine (ikonica štampača) posle čuvanja."
                : "Možete uveziti Excel ili CSV, ili ručno dodati stavke ispod — štampa PDF prijemnog barkoda funkcionišu kad ima naziv stavke (opciono širenje RN/pozicije)."}
            </p>
          </div>

          {!isEditOrder ? (
            <MaterialOrderExcelImportSection
              form={form}
              disabled={isLoading}
              resolveRememberedItemCode={resolveRememberedItemCode}
              onRememberItemCodes={(items) => {
                void rememberItemCodes(items);
              }}
            />
          ) : null}
          {!isEditOrder && !itemsJsonWatch ? (
            <MaterialOrderImportedLinesCollapsible control={form.control} setValue={form.setValue} />
          ) : null}

          <NarudzbenicaFields control={nbControl} />

          <div className="space-y-2 border-t border-border pt-4">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Napomena u futeru PDF porudžbine</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Opciono — prikazuje se na dnu štampanog dokumenta…"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!isEditOrder ? (
              <p className="text-xs text-muted-foreground max-w-xl">
                Generisani PDF ne snima narudžbinu u CRM. Posle provere kliknite „Kreiraj narudžbinu“ da ostane zapis i
                javni link.
              </p>
            ) : null}

            {!isEditOrder ? (
              <div className="space-y-2 rounded-md border border-border bg-background p-3">
                <h4 className="text-sm font-semibold text-foreground">Pregled porudžbenice</h4>
                <p className="text-[11px] text-muted-foreground">
                  PDF se osvežava automatski posle izmena u tabeli ili stavkama (kratak zastoj posle kucanja).
                </p>
                {previewBusy && !previewUrl ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">Generišem pregled…</p>
                ) : previewUrl ? (
                  <iframe
                    title="Pregled PDF porudžbenice"
                    src={`${previewUrl}#toolbar=0`}
                    className="w-full min-h-[28rem] rounded border border-border bg-muted/30"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground py-6 text-center">
                    Uvezite tabelu ili unesite stavke da se prikaže pregled.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end sm:gap-3 [&>button]:w-full sm:[&>button]:w-auto">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Otkaži
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading
              ? "Čuvanje..."
              : submitButtonLabel?.trim()
                ? submitButtonLabel.trim()
                : isEditOrder
                  ? "Sačuvaj izmene"
                  : "Kreiraj narudžbinu"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
