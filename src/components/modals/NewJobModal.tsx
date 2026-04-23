import { useState, useEffect, useMemo, useRef } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Trash2, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { useJobs, type CreateJobInput, type UpdateJobInput, sumQuoteLineAmounts, computeJobAmountsFromLineSum } from "@/hooks/use-jobs";
import { useCustomers } from "@/hooks/use-customers";
import { useTeams } from "@/hooks/use-teams";
import { formatCurrencyBySettings, readAppSettingsCache } from "@/lib/app-settings";
import { getInstallationAddressForDisplay } from "@/lib/map-geocode";
import type { Customer, Job } from "@/types";
import { cn } from "@/lib/utils";

function numOr(defaultVal: number, v: unknown): number {
  if (v === "" || v === null || v === undefined) return defaultVal;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultVal;
}

/** Poklapanje imena: ceo string ili svaka reč (≥2 znaka) u imenu kupca. */
function customerNameMatchesTypedSearch(fullName: string, queryRaw: string): boolean {
  const name = fullName.toLowerCase().normalize("NFKC").trim();
  const q = queryRaw.toLowerCase().normalize("NFKC").trim();
  if (!q || !name) return false;
  if (name.includes(q)) return true;
  const words = q.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return name.includes(q);
  return words.every((w) => name.includes(w));
}

const lineSchema = z.object({
  description: z.string().trim().min(1, "Opis stavke je obavezan"),
  quantity: z.preprocess((v) => numOr(1, v), z.number().positive("Količina mora biti > 0")),
  unitPrice: z.preprocess((v) => numOr(0, v), z.number().min(0, "Cena mora biti ≥ 0")),
});

const newJobSchema = z
  .object({
    customerMode: z.enum(["new", "existing"]),
    customerId: z.string().optional(),
    newCustomerFullName: z.string().optional(),
    newCustomerContactPerson: z.string().optional(),
    newCustomerPhones: z.array(z.object({ value: z.string() })).optional(),
    newCustomerEmails: z.array(z.object({ value: z.string() })).optional(),
    newCustomerPib: z.string().optional(),
    newCustomerRegistrationNumber: z.string().optional(),
    summary: z.string().trim().min(1, "Opis posla je obavezan").max(500, "Najviše 500 karaktera"),
    pricesIncludeVat: z.boolean(),
    lines: z.array(lineSchema),
    advancePayment: z.preprocess((v) => numOr(0, v), z.number().min(0, "Avans ne može biti negativan")),
    billingAddress: z.string().optional(),
    installationAddress: z.string().optional(),
    customerPhone: z.string().optional(),
    assignedTeamId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.customerMode === "existing") {
      if (!data.customerId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Izaberite postojećeg kupca",
          path: ["customerId"],
        });
      }
    } else {
      if (!data.newCustomerFullName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ime i prezime kupca je obavezno",
          path: ["newCustomerFullName"],
        });
      }
      const phones = (data.newCustomerPhones ?? []).map((p) => p.value.trim()).filter(Boolean);
      const emails = (data.newCustomerEmails ?? []).map((e) => e.value.trim()).filter(Boolean);
      if (phones.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Telefon kupca je obavezan",
          path: ["newCustomerPhones", 0, "value"],
        });
      }
      if (emails.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Email kupca je obavezan",
          path: ["newCustomerEmails", 0, "value"],
        });
      }
      if (!data.billingAddress?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Adresa za fakturisanje je obavezna",
          path: ["billingAddress"],
        });
      }
      if (!data.installationAddress?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Adresa ugradnje je obavezna",
          path: ["installationAddress"],
        });
      }
      if (!data.customerPhone?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Telefon za posao je obavezan",
          path: ["customerPhone"],
        });
      }
    }

  });

type NewJobValues = z.infer<typeof newJobSchema>;

interface NewJobModalProps {
  trigger?: React.ReactNode;
  job?: Job;
}

export function NewJobModal({ trigger, job }: NewJobModalProps) {
  const [open, setOpen] = useState(false);
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const { customers = [], createCustomer } = useCustomers();
  const { teams = [] } = useTeams();
  const { createJob, updateJob } = useJobs();

  const form = useForm<NewJobValues>({
    resolver: zodResolver(newJobSchema),
    defaultValues: {
      customerMode: "new",
      customerId: "",
      newCustomerFullName: "",
      newCustomerContactPerson: "",
      newCustomerPhones: [{ value: "" }],
      newCustomerEmails: [{ value: "" }],
      newCustomerPib: "",
      newCustomerRegistrationNumber: "",
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
  const { fields: customerPhoneFields, append: appendCustomerPhone, remove: removeCustomerPhone } = useFieldArray({
    control: form.control,
    name: "newCustomerPhones",
  });
  const { fields: customerEmailFields, append: appendCustomerEmail, remove: removeCustomerEmail } = useFieldArray({
    control: form.control,
    name: "newCustomerEmails",
  });

  const customerMode = useWatch({ control: form.control, name: "customerMode" });
  const selectedCustomerId = useWatch({ control: form.control, name: "customerId" });
  const newCustomerFullNameWatched = useWatch({ control: form.control, name: "newCustomerFullName" });
  const newCustomerPhones = useWatch({ control: form.control, name: "newCustomerPhones" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const watchedVat = useWatch({ control: form.control, name: "pricesIncludeVat" });

  /** Samo pri promeni izabranog klijenta (ne pri svakom refetch-u liste) — da korisnik može drugačiju adresu za posao. */
  const lastPrefilledCustomerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      lastPrefilledCustomerIdRef.current = null;
      setCustomerSearch("");
      setCustomerSelectOpen(false);
      return;
    }
    if (job?.customer?.id) {
      lastPrefilledCustomerIdRef.current = job.customer.id;
    } else {
      lastPrefilledCustomerIdRef.current = null;
    }
  }, [open, job?.id, job?.customer?.id]);

  const pricingPreview = useMemo(() => {
    const sum = sumQuoteLineAmounts(
      (watchedLines || []).map((l) => ({
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
      })),
    );
    return computeJobAmountsFromLineSum(sum, watchedVat !== false);
  }, [watchedLines, watchedVat]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId],
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const phones = c.phones.join(" ").toLowerCase();
      const haystack = `${c.fullName} ${c.billingAddress} ${c.installationAddress} ${phones}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [customers, customerSearch]);

  /** Predlog postojećih kupaca dok se u režimu „Novi kupac“ kuca ime. */
  const newCustomerNameSuggestions = useMemo(() => {
    const q = (newCustomerFullNameWatched ?? "").trim();
    if (q.length < 2) return [];
    const matches = customers.filter((c) => customerNameMatchesTypedSearch(c.fullName, q));
    const norm = (s: string) => s.toLowerCase().normalize("NFKC").trim();
    const qn = norm(q);
    return matches
      .map((c) => {
        const n = norm(c.fullName);
        let rank = 2;
        if (n === qn) rank = 0;
        else if (n.startsWith(qn)) rank = 1;
        return { c, rank };
      })
      .sort((a, b) => a.rank - b.rank || a.c.fullName.localeCompare(b.c.fullName, "sr"))
      .map(({ c }) => c)
      .slice(0, 8);
  }, [customers, newCustomerFullNameWatched]);

  const applyCustomerFromNameSuggestion = (c: Customer) => {
    lastPrefilledCustomerIdRef.current = null;
    form.setValue("customerMode", "existing");
    form.setValue("customerId", c.id);
    form.setValue("newCustomerFullName", "");
    form.setValue("newCustomerContactPerson", "");
    form.setValue("newCustomerPhones", [{ value: "" }]);
    form.setValue("newCustomerEmails", [{ value: "" }]);
    form.setValue("newCustomerPib", "");
    form.setValue("newCustomerRegistrationNumber", "");
    setCustomerSearch("");
    setCustomerSelectOpen(false);
    toast.success("Izabran postojeći kupac", {
      description: "Prebačeno na „Postojeći kupac“ — učitani su adresa i telefon sa kartice kupca.",
    });
  };

  useEffect(() => {
    if (!selectedCustomerId) return;
    if (lastPrefilledCustomerIdRef.current === selectedCustomerId) return;

    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (!customer) return;

    form.setValue("billingAddress", customer.billingAddress);
    form.setValue("installationAddress", customer.installationAddress);
    form.setValue("customerPhone", customer.phones[0] || "");
    lastPrefilledCustomerIdRef.current = selectedCustomerId;
  }, [selectedCustomerId, customers, form]);

  useEffect(() => {
    if (customerMode !== "new") return;
    const firstPhone = (newCustomerPhones ?? []).map((p) => p.value.trim()).find(Boolean) ?? "";
    form.setValue("customerPhone", firstPhone);
  }, [customerMode, newCustomerPhones, form]);

  const onSubmit = async (data: NewJobValues) => {
    try {
      let customerId = data.customerId ?? "";

      if (!job && data.customerMode === "new") {
        const created = await createCustomer.mutateAsync({
          fullName: data.newCustomerFullName?.trim() || "",
          contactPerson: data.newCustomerContactPerson?.trim() || data.newCustomerFullName?.trim() || "",
          billingAddress: data.billingAddress?.trim() || "",
          installationAddress: data.installationAddress?.trim() || "",
          phones: (data.newCustomerPhones ?? []).map((p) => p.value.trim()).filter(Boolean),
          emails: (data.newCustomerEmails ?? []).map((e) => e.value.trim()).filter(Boolean),
          pib: data.newCustomerPib?.trim() || "",
          registrationNumber: data.newCustomerRegistrationNumber?.trim() || "",
        });
        customerId = created.id;
      }

      const payloadBase: CreateJobInput = {
        customerId,
        summary: data.summary,
        pricesIncludeVat: data.pricesIncludeVat,
        quoteLines: data.lines.map((l, i) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          sortOrder: i,
        })),
        advancePayment: data.advancePayment,
        billingAddress: data.billingAddress?.trim() || undefined,
        installationAddress: data.installationAddress?.trim() || undefined,
        customerPhone: data.customerPhone?.trim() || undefined,
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

      await createJob.mutateAsync(payloadBase);
      form.reset({
        customerMode: "new",
        customerId: "",
        newCustomerFullName: "",
        newCustomerContactPerson: "",
        newCustomerPhones: [{ value: "" }],
        newCustomerEmails: [{ value: "" }],
        newCustomerPib: "",
        newCustomerRegistrationNumber: "",
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
    } catch {
      // Toast poruke se prikazuju iz mutacija.
    }
  };

  useEffect(() => {
    if (!open || !job) return;

    form.reset({
      customerMode: "existing",
      customerId: job.customer.id || "",
      newCustomerFullName: "",
      newCustomerContactPerson: "",
      newCustomerPhones: [{ value: "" }],
      newCustomerEmails: [{ value: "" }],
      newCustomerPib: "",
      newCustomerRegistrationNumber: "",
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
      installationAddress: getInstallationAddressForDisplay(job) || "",
      customerPhone: job.customerPhone || job.customer.phones?.[0] || "",
      assignedTeamId: "",
    });
  }, [open, job, form]);

  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const appSettings = readAppSettingsCache();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" /> Novi posao
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-full sm:max-w-2xl">
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
            {!job && (
              <FormField
                control={form.control}
                name="customerMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tip kupca</FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-2 rounded-md border p-1">
                        <Button
                          type="button"
                          variant={field.value === "existing" ? "secondary" : "ghost"}
                          className="h-8"
                          onClick={() => field.onChange("existing")}
                        >
                          Postojeći kupac
                        </Button>
                        <Button
                          type="button"
                          variant={field.value === "new" ? "secondary" : "ghost"}
                          className="h-8"
                          onClick={() => field.onChange("new")}
                        >
                          Novi kupac
                        </Button>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            {(job || customerMode === "existing") && (
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Kupac (pretraga po imenu, telefonu ili adresi)</FormLabel>
                    <Popover open={customerSelectOpen} onOpenChange={setCustomerSelectOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" role="combobox" className="w-full justify-between">
                            <span className="truncate text-left">
                              {selectedCustomer
                                ? `${selectedCustomer.fullName} (${selectedCustomer.customerNumber})`
                                : "Izaberite kupca"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
                        <Command>
                          <CommandInput
                            placeholder="Pretraži ime, telefon ili adresu..."
                            value={customerSearch}
                            onValueChange={setCustomerSearch}
                          />
                          <CommandList>
                            <CommandEmpty>Nema rezultata.</CommandEmpty>
                            <CommandGroup>
                              {filteredCustomers.map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={`${c.fullName} ${c.phones.join(" ")} ${c.billingAddress} ${c.installationAddress}`}
                                  onSelect={() => {
                                    field.onChange(c.id);
                                    setCustomerSelectOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", field.value === c.id ? "opacity-100" : "opacity-0")} />
                                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1 flex-col">
                                      <span className="truncate">{c.fullName}</span>
                                      <span className="truncate text-xs text-muted-foreground">
                                        {c.phones[0] || "bez telefona"} · {c.installationAddress || c.billingAddress}
                                      </span>
                                    </div>
                                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                      {c.customerNumber}
                                    </span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedCustomer && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {selectedCustomer.customerNumber} · {selectedCustomer.phones[0] || "Bez telefona"} · {selectedCustomer.installationAddress || selectedCustomer.billingAddress}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {!job && customerMode === "new" && (
              <div className="space-y-4 overflow-visible border rounded-lg p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="newCustomerFullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ime i prezime kupca</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. Marko Petrović" autoComplete="off" {...field} />
                      </FormControl>
                      {newCustomerNameSuggestions.length > 0 && (
                        <div
                          className="mt-1.5 w-full overflow-hidden rounded-md border border-border bg-muted/30 text-foreground shadow-sm"
                          role="listbox"
                          aria-label="Poklapanja u bazi kupaca"
                        >
                          <p className="border-b border-border bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                            Postojeći kupci sa sličnim imenom — klik učitava podatke (prelazak na „Postojeći kupac“)
                          </p>
                          <ul className="max-h-48 overflow-y-auto py-1">
                            {newCustomerNameSuggestions.map((c) => (
                              <li key={c.id} role="option">
                                <button
                                  type="button"
                                  className="flex w-full items-start gap-2 px-2 py-2 text-left text-sm hover:bg-background/90"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => applyCustomerFromNameSuggestion(c)}
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium text-foreground">{c.fullName}</span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {c.phones[0] || "bez telefona"} · {c.customerNumber}
                                    </span>
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="newCustomerContactPerson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kontakt osoba (opciono)</FormLabel>
                      <FormControl><Input placeholder="Ako je firma, unesite kontakt osobu" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Brojevi telefona</FormLabel>
                    <Button type="button" size="sm" variant="outline" onClick={() => appendCustomerPhone({ value: "" })}>
                      <Plus className="w-3 h-3 mr-1" /> Dodaj telefon
                    </Button>
                  </div>
                  {customerPhoneFields.map((field, index) => (
                    <div key={field.id} className="flex gap-2">
                      <FormField
                        control={form.control}
                        name={`newCustomerPhones.${index}.value`}
                        render={({ field: f }) => (
                          <FormItem className="flex-1">
                            <FormControl><Input placeholder="+381 6..." {...f} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {customerPhoneFields.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeCustomerPhone(index)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Email adrese</FormLabel>
                    <Button type="button" size="sm" variant="outline" onClick={() => appendCustomerEmail({ value: "" })}>
                      <Plus className="w-3 h-3 mr-1" /> Dodaj email
                    </Button>
                  </div>
                  {customerEmailFields.map((field, index) => (
                    <div key={field.id} className="flex gap-2">
                      <FormField
                        control={form.control}
                        name={`newCustomerEmails.${index}.value`}
                        render={({ field: f }) => (
                          <FormItem className="flex-1">
                            <FormControl><Input placeholder="adresa@email.com" {...f} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {customerEmailFields.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeCustomerEmail(index)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="newCustomerPib"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>PIB (opciono)</FormLabel>
                        <FormControl><Input placeholder="Poreski broj" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="newCustomerRegistrationNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Matični broj (opciono)</FormLabel>
                        <FormControl><Input placeholder="Matični broj firme" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border pt-4">
              {(job || customerMode === "new") && (
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
              )}
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
                              <Input type="number" min={0} step="0.01" {...f} />
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
                        Ukupna procenjena cena:{" "}
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
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 space-y-1">
                      <FormLabel htmlFor="prices-include-vat" className="cursor-pointer">
                        Dodaj PDV 20% na stavke
                      </FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Ako je uključeno, PDV 20% se dodaje na zbir stavki.
                      </p>
                    </div>
                    <FormControl className="shrink-0 sm:pt-0.5">
                      <Switch
                        id="prices-include-vat"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label="Uključi ili isključi PDV"
                      />
                    </FormControl>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground leading-relaxed">
                    Osnovica {formatCurrency(pricingPreview.priceWithoutVat)} · PDV 20% {formatCurrency(pricingPreview.vatAmount)} ·{" "}
                    <span className="text-foreground font-semibold">za naplatu {formatCurrency(pricingPreview.totalPrice)}</span>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {(job || customerMode === "new") && (
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
            )}

            {(job || customerMode === "new") && (
              <FormField
                control={form.control}
                name="installationAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Adresa ugradnje (za ovaj posao)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Npr. Bulevar kralja Aleksandra 73, Beograd"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground leading-snug">
                      Za mapu unesite što precizniju adresu: ulica i broj, naselje, grad/opština (izbegavajte skraćenice ako
                      može).
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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


            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-2 [&>button]:w-full sm:[&>button]:w-auto">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Otkaži
              </Button>
              <Button type="submit" disabled={createJob.isPending || updateJob.isPending || createCustomer.isPending}>
                {job ? "Sačuvaj izmene" : "Kreiraj posao"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
