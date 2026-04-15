import { useState, useEffect, useMemo } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Plus, UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useJobs, type CreateJobInput, type UpdateJobInput, sumQuoteLineAmounts, computeJobAmountsFromLineSum } from "@/hooks/use-jobs";
import { useCustomers } from "@/hooks/use-customers";
import { useTeams } from "@/hooks/use-teams";
import { formatCurrencyBySettings, readAppSettingsCache } from "@/lib/app-settings";
import { CustomerForm } from "@/components/shared/CustomerForm";
import type { Job } from "@/types";

function numOr(defaultVal: number, v: unknown): number {
  if (v === "" || v === null || v === undefined) return defaultVal;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultVal;
}

const lineSchema = z.object({
  description: z.string().trim().min(1, "Opis stavke je obavezan"),
  quantity: z.preprocess((v) => numOr(1, v), z.number().positive("Količina mora biti > 0")),
  unitPrice: z.preprocess((v) => numOr(0, v), z.number().min(0, "Cena mora biti ≥ 0")),
});

const newJobSchema = z
  .object({
    customerId: z.string().min(1, "Izaberite klijenta"),
    summary: z.string().trim().min(1, "Opis posla je obavezan").max(500, "Najviše 500 karaktera"),
    pricesIncludeVat: z.boolean(),
    lines: z.array(lineSchema).min(1, "Dodajte bar jednu stavku"),
    advancePayment: z.preprocess((v) => numOr(0, v), z.number().min(0, "Avans ne može biti negativan")),
    billingAddress: z.string().trim().min(1, "Adresa za fakturisanje je obavezna"),
    installationAddress: z.string().trim().min(1, "Adresa ugradnje je obavezna"),
    customerPhone: z.string().trim().min(1, "Telefon je obavezan"),
    assignedTeamId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const sum = sumQuoteLineAmounts(
      (data.lines as { quantity: number; unitPrice: number }[]).map((l) => ({
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
      })),
    );
    if (sum <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ukupan iznos stavki mora biti veći od 0 (unesite jedinične cene)",
        path: ["lines", 0, "unitPrice"],
      });
    }
  });

type NewJobValues = z.infer<typeof newJobSchema>;

interface NewJobModalProps {
  trigger?: React.ReactNode;
  job?: Job;
}

export function NewJobModal({ trigger, job }: NewJobModalProps) {
  const [open, setOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const { customers = [], createCustomer } = useCustomers();
  const { teams = [] } = useTeams();
  const { createJob, updateJob } = useJobs();

  const form = useForm<NewJobValues>({
    resolver: zodResolver(newJobSchema),
    defaultValues: {
      customerId: "",
      summary: "",
      pricesIncludeVat: true,
      lines: [{ description: "", quantity: 1, unitPrice: 0 }],
      advancePayment: 0,
      billingAddress: "",
      installationAddress: "",
      customerPhone: "",
      assignedTeamId: "",
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  const selectedCustomerId = form.watch("customerId");
  const watchedLines = form.watch("lines");
  const watchedVat = form.watch("pricesIncludeVat");

  const pricingPreview = useMemo(() => {
    const sum = sumQuoteLineAmounts(
      (watchedLines || []).map((l) => ({
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
      })),
    );
    return computeJobAmountsFromLineSum(sum, watchedVat !== false);
  }, [watchedLines, watchedVat]);

  useEffect(() => {
    if (selectedCustomerId) {
      const customer = customers.find((c) => c.id === selectedCustomerId);
      if (customer) {
        form.setValue("billingAddress", customer.billingAddress);
        form.setValue("installationAddress", customer.installationAddress);
        form.setValue("customerPhone", customer.phones[0] || "");
      }
    }
  }, [selectedCustomerId, customers, form]);

  const onSubmit = (data: NewJobValues) => {
    const payloadBase: CreateJobInput = {
      customerId: data.customerId,
      summary: data.summary,
      pricesIncludeVat: data.pricesIncludeVat,
      quoteLines: data.lines.map((l, i) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        sortOrder: i,
      })),
      advancePayment: data.advancePayment,
      billingAddress: data.billingAddress,
      installationAddress: data.installationAddress,
      customerPhone: data.customerPhone,
      assignedTeamId: data.assignedTeamId || undefined,
    };

    if (job) {
      const payload: UpdateJobInput = {
        id: job.id,
        ...payloadBase,
      };
      updateJob.mutate(payload, {
        onSuccess: () => {
          setOpen(false);
        },
      });
      return;
    }

    createJob.mutate(payloadBase, {
      onSuccess: () => {
        form.reset({
          customerId: "",
          summary: "",
          pricesIncludeVat: true,
          lines: [{ description: "", quantity: 1, unitPrice: 0 }],
          advancePayment: 0,
          billingAddress: "",
          installationAddress: "",
          customerPhone: "",
          assignedTeamId: "",
        });
        setOpen(false);
      },
    });
  };

  useEffect(() => {
    if (!open || !job) return;

    form.reset({
      customerId: job.customer.id || "",
      summary: job.summary || "",
      pricesIncludeVat: job.pricesIncludeVat !== false,
      lines: job.quoteLines.length > 0
        ? job.quoteLines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          }))
        : [{ description: "", quantity: 1, unitPrice: 0 }],
      advancePayment: Number(job.advancePayment) || 0,
      billingAddress: job.jobBillingAddress || job.customer.billingAddress || "",
      installationAddress: job.jobInstallationAddress || job.customer.installationAddress || "",
      customerPhone: job.customerPhone || job.customer.phones?.[0] || "",
      assignedTeamId: "",
    });
  }, [open, job, form]);

  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const appSettings = readAppSettingsCache();
  const isCreatingCustomer = createCustomer.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" /> Novi posao
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{job ? `Izmena posla ${job.jobNumber}` : "Kreiranje novog posla"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, () => {
              toast.error("Proverite formular", {
                description: "Popunite sva obavezna polja, bar jednu stavku ponude sa cenom > 0 i validan klijent.",
              });
            })}
            className="space-y-4"
          >
            <div className="flex gap-2 items-end">
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Kupac (klijent)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Izaberite postojećeg klijenta" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.fullName} ({c.customerNumber})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="button" variant="outline" className="mb-0.5" onClick={() => setCustomerModalOpen(true)}>
                <UserPlus className="w-4 h-4 mr-1.5" /> Novi klijent
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border pt-4">
              <FormField
                control={form.control}
                name="customerPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefon za ovaj posao</FormLabel>
                    <FormControl>
                      <Input placeholder="+381 6..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="assignedTeamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Odgovorni tim (opciono)</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v === "none" ? "" : v)} value={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Izaberite tim" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Bez dodele</SelectItem>
                        {teams.length === 0 ? (
                          <SelectItem value="no-teams" disabled>
                            Nema timova u bazi
                          </SelectItem>
                        ) : (
                          teams.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                              {!t.active ? " (neaktivan)" : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="border border-border rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <FormLabel className="text-base">Stavke ponude</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ description: "", quantity: 1, unitPrice: 0 })}
                >
                  <Plus className="w-4 h-4 mr-1" /> Dodaj stavku
                </Button>
              </div>
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start border-b border-border/60 pb-3 last:border-0 last:pb-0">
                    <div className="sm:col-span-6">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.description`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-muted-foreground">Opis</FormLabel>
                            <FormControl>
                              <Input placeholder="npr. PVC prozor 120×140" {...f} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.quantity`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-muted-foreground">Kol.</FormLabel>
                            <FormControl>
                              <Input type="number" min={0.01} step="0.01" {...f} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.unitPrice`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-muted-foreground">{`Jed. cena (${appSettings.currency})`}</FormLabel>
                            <FormControl>
                              <Input type="number" min={0} step="1" {...f} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="sm:col-span-1 flex sm:items-end pt-2 sm:pt-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground shrink-0"
                        disabled={fields.length <= 1}
                        onClick={() => remove(index)}
                        aria-label="Ukloni stavku"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="sm:col-span-12 flex justify-end">
                      <p className="text-xs text-muted-foreground">
                        Ukupno:{" "}
                        <span className="text-foreground font-medium">
                          {formatCurrency((Number(watchedLines?.[index]?.quantity) || 0) * (Number(watchedLines?.[index]?.unitPrice) || 0))}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <FormField
              control={form.control}
              name="pricesIncludeVat"
              render={({ field }) => (
                <FormItem className="border border-border rounded-lg p-3 bg-muted/20">
                  <div className="flex items-start gap-2">
                    <FormControl>
                      <Checkbox id="prices-include-vat" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                    </FormControl>
                    <div className="space-y-1">
                      <Label htmlFor="prices-include-vat" className="cursor-pointer">
                        Dodaj PDV 20% na stavke
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Ako je čekirano, PDV 20% se dodaje na zbir stavki.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground leading-relaxed">
                    Osnovica {formatCurrency(pricingPreview.priceWithoutVat)} · PDV 20% {formatCurrency(pricingPreview.vatAmount)} ·{" "}
                    <span className="text-foreground font-semibold">za naplatu {formatCurrency(pricingPreview.totalPrice)}</span>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="billingAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresa za fakturisanje (za ovaj posao)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ulica, Grad, Poštanski broj" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="installationAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresa ugradnje (za ovaj posao)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ulica, Grad, Poštanski broj" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="summary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opis posla</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Opišite radove koji treba da se izvrše..." rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="advancePayment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{`Avansna uplata (${appSettings.currency})`}</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} placeholder="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />


            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Otkaži
              </Button>
              <Button type="submit" disabled={createJob.isPending || updateJob.isPending}>
                {job ? "Sačuvaj izmene" : "Kreiraj posao"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>

      <Dialog open={customerModalOpen} onOpenChange={setCustomerModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novi klijent</DialogTitle>
          </DialogHeader>
          <CustomerForm
            onSubmit={(data) => {
              const transformedData = {
                ...data,
                phones: data.phones.map((p) => p.value.trim()).filter(Boolean),
                emails: data.emails.map((e) => e.value.trim()).filter(Boolean),
              };
              createCustomer.mutate(transformedData, {
                onSuccess: (created) => {
                  form.setValue("customerId", created.id, { shouldValidate: true, shouldDirty: true });
                  setCustomerModalOpen(false);
                },
              });
            }}
            onCancel={() => setCustomerModalOpen(false)}
            isLoading={isCreatingCustomer}
          />
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
