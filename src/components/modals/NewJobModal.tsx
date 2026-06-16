import { useState, useEffect, useMemo, useRef } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Trash2, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { useJobs, type CreateJobInput, type UpdateJobInput } from "@/hooks/use-jobs";
import { useCustomers } from "@/hooks/use-customers";
import { resolveJobInstallationLocationParts } from "@/lib/job-installation-location";
import { AddressMiniMap } from "@/components/shared/AddressMiniMap";
import type { Customer, Job } from "@/types";
import { cn } from "@/lib/utils";

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
    billingAddress: z.string().optional(),
    installationAddress: z.string().optional(),
    installationApartment: z.string().optional(),
    installationFloor: z.string().optional(),
    customerPhone: z.string().optional(),
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
      if (phones.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Telefon kupca je obavezan",
          path: ["newCustomerPhones", 0, "value"],
        });
      }
      const emailCheck = z.string().email();
      for (let i = 0; i < (data.newCustomerEmails ?? []).length; i++) {
        const v = (data.newCustomerEmails ?? [])[i]?.value?.trim() ?? "";
        if (v && !emailCheck.safeParse(v).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Nevažeća email adresa",
            path: ["newCustomerEmails", i, "value"],
          });
        }
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

const emptyNewJobFormValues = (): NewJobValues => ({
  customerMode: "new",
  customerId: "",
  newCustomerFullName: "",
  newCustomerContactPerson: "",
  newCustomerPhones: [{ value: "" }],
  newCustomerEmails: [{ value: "" }],
  newCustomerPib: "",
  newCustomerRegistrationNumber: "",
  summary: "",
  billingAddress: "",
  installationAddress: "",
  installationApartment: "",
  installationFloor: "",
  customerPhone: "",
});

interface NewJobModalProps {
  trigger?: React.ReactNode;
  job?: Job;
}

export function NewJobModal({ trigger, job }: NewJobModalProps) {
  const [open, setOpen] = useState(false);
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const { customers = [], createCustomer } = useCustomers();
  const { createJob, updateJob } = useJobs();

  const form = useForm<NewJobValues>({
    resolver: zodResolver(newJobSchema),
    defaultValues: emptyNewJobFormValues(),
  });

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
  const installationAddressWatch = useWatch({ control: form.control, name: "installationAddress" });

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
    lastPrefilledCustomerIdRef.current = c.id;
    form.setValue("customerMode", "existing");
    form.setValue("customerId", c.id);
    form.setValue("billingAddress", c.billingAddress);
    form.setValue("installationAddress", c.installationAddress);
    form.setValue("installationApartment", c.installationApartment || "");
    form.setValue("installationFloor", c.installationFloor || "");
    form.setValue("customerPhone", c.phones[0] || "");
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
    form.setValue("installationApartment", customer.installationApartment || "");
    form.setValue("installationFloor", customer.installationFloor || "");
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
          installationApartment: data.installationApartment?.trim() || undefined,
          installationFloor: data.installationFloor?.trim() || undefined,
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
        billingAddress: data.billingAddress?.trim() || undefined,
        installationAddress: data.installationAddress?.trim() || undefined,
        installationApartment: data.installationApartment?.trim() || undefined,
        installationFloor: data.installationFloor?.trim() || undefined,
        customerPhone: data.customerPhone?.trim() || undefined,
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
      form.reset(emptyNewJobFormValues());
      setOpen(false);
    } catch {
      // Toast poruke se prikazuju iz mutacija.
    }
  };

  useEffect(() => {
    if (!open || !job) return;

    const location = resolveJobInstallationLocationParts(job);

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
      billingAddress: job.jobBillingAddress || job.customer.billingAddress || "",
      installationAddress: location.installationAddress || "",
      installationApartment: job.jobInstallationApartment || job.customer.installationApartment || "",
      installationFloor: job.jobInstallationFloor || job.customer.installationFloor || "",
      customerPhone: job.customerPhone || job.customer.phones?.[0] || "",
    });
  }, [open, job, form]);

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
                description: "Popunite sva obavezna polja i validan klijent.",
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
                      <div className="grid grid-cols-2 rounded-md bg-muted/40 p-1 dark:bg-muted/30">
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
                                    <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:border-white/[0.1]">
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
                        {selectedCustomer.customerNumber} · {selectedCustomer.phones[0] || "Bez telefona"} ·{" "}
                        {selectedCustomer.installationAddress || selectedCustomer.billingAddress}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {!job && customerMode === "new" && (
              <div className="space-y-4 overflow-visible rounded-lg bg-muted/25 p-3 dark:bg-muted/20">
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
                            className="mt-1.5 w-full overflow-hidden rounded-md border border-border/55 bg-muted/30 text-foreground shadow-sm dark:border-white/[0.06]"
                            role="listbox"
                            aria-label="Poklapanja u bazi kupaca"
                          >
                            <p className="border-b border-border/55 bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground dark:border-white/[0.06]">
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
                        <FormControl>
                          <Input placeholder="Ako je firma, unesite kontakt osobu" {...field} />
                        </FormControl>
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
                            <FormControl>
                              <Input placeholder="+381 6..." {...f} />
                            </FormControl>
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
                    <FormLabel>Email adrese (opciono)</FormLabel>
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
                            <FormControl>
                              <Input placeholder="adresa@email.com" {...f} />
                            </FormControl>
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
                        <FormControl>
                          <Input placeholder="Poreski broj" {...field} />
                        </FormControl>
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
                        <FormControl>
                          <Input placeholder="Matični broj firme" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 border-t border-border/55 pt-4 dark:border-white/[0.06]">
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
            </div>

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
                      <Input placeholder="Npr. Bulevar kralja Aleksandra 73, Beograd" {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground leading-snug">
                      Za mapu unesite što precizniju adresu: ulica i broj, naselje, grad/opština. Možete i koordinate (npr.{" "}
                      <span className="font-mono text-[11px]">44.7866, 20.4489</span>) — mapa ih prepoznaje odmah.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {(job || customerMode === "new") && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="installationFloor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sprat (opciono)</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. 3" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="installationApartment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stan (opciono)</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. 12" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {(job || customerMode === "new") && (
              <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
                <p className="text-xs font-medium text-muted-foreground">Pregled adrese ugradnje na mapi</p>
                {installationAddressWatch?.trim() ? (
                  <AddressMiniMap
                    address={installationAddressWatch}
                    className="mt-0 h-36 sm:h-40 rounded-lg border border-border/80 bg-background shadow-sm [&_.leaflet-container]:rounded-lg"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground py-6 text-center">
                    Unesite adresu ili koordinate iznad da proverite lokaciju na mapi.
                  </p>
                )}
              </div>
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
