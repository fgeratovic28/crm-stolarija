import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Trash2, MapPin } from "lucide-react";
import { toast } from "sonner";
import type { Customer } from "@/types";

const customerSchema = z
  .object({
    fullName: z.string().trim().min(1, "Ime klijenta je obavezno"),
    contactPerson: z.string().trim().min(1, "Kontakt osoba je obavezna"),
    billingAddress: z.string().trim().min(1, "Adresa za fakturisanje je obavezna"),
    installationAddress: z.string().trim().min(1, "Adresa ugradnje je obavezna"),
    phones: z.array(z.object({ value: z.string() })).min(1, "Bar jedan red za telefon"),
    emails: z.array(z.object({ value: z.string() })).min(1, "Bar jedan red za email"),
    pib: z.string().trim().optional(),
    registrationNumber: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    const phonesOk = data.phones.some((p) => p.value.trim().length > 0);
    if (!phonesOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bar jedan telefon je obavezan",
        path: ["phones", 0, "value"],
      });
    }
    const nonEmptyEmails = data.emails.map((e) => e.value.trim()).filter(Boolean);
    if (nonEmptyEmails.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bar jedan email je obavezan",
        path: ["emails", 0, "value"],
      });
      return;
    }
    const emailCheck = z.string().email();
    for (let i = 0; i < data.emails.length; i++) {
      const v = data.emails[i].value.trim();
      if (v && !emailCheck.safeParse(v).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Nevažeća email adresa",
          path: ["emails", i, "value"],
        });
      }
    }
  });

type CustomerValues = z.infer<typeof customerSchema>;

interface CustomerFormProps {
  initialData?: Partial<Customer>;
  onSubmit: (data: CustomerValues) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function CustomerForm({ initialData, onSubmit, onCancel, isLoading }: CustomerFormProps) {
  const form = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      fullName: initialData?.fullName || "",
      contactPerson: initialData?.contactPerson || "",
      billingAddress: initialData?.billingAddress || "",
      installationAddress: initialData?.installationAddress || "",
      phones: initialData?.phones?.length ? initialData.phones.map(p => ({ value: p })) : [{ value: "" }],
      emails: initialData?.emails?.length ? initialData.emails.map(e => ({ value: e })) : [{ value: "" }],
      pib: initialData?.pib || "",
      registrationNumber: initialData?.registrationNumber || "",
    },
  });

  const { fields: phoneFields, append: appendPhone, remove: removePhone } = useFieldArray({
    control: form.control,
    name: "phones",
  });

  const { fields: emailFields, append: appendEmail, remove: removeEmail } = useFieldArray({
    control: form.control,
    name: "emails",
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, () => {
          toast.error("Proverite formular", {
            description: "Ime, kontakt, adrese, bar jedan ispravan telefon i bar jedan ispravan email su obavezni.",
          });
        })}
        className="space-y-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField control={form.control} name="fullName" render={({ field }) => (
            <FormItem>
              <FormLabel>Kupac / Firma</FormLabel>
              <FormControl><Input placeholder="npr. Marko Petrović d.o.o." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="contactPerson" render={({ field }) => (
            <FormItem>
              <FormLabel>Kontakt osoba</FormLabel>
              <FormControl><Input placeholder="Ime i prezime" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <FormLabel>Brojevi telefona</FormLabel>
            <Button type="button" variant="outline" size="sm" className="w-full shrink-0 sm:w-auto" onClick={() => appendPhone({ value: "" })}>
              <Plus className="w-3 h-3 mr-1" /> Dodaj telefon
            </Button>
          </div>
          <div className="space-y-2">
            {phoneFields.map((field, index) => (
              <div key={field.id} className="flex gap-2">
                <FormField control={form.control} name={`phones.${index}.value`} render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl><Input placeholder="+381 6..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {phoneFields.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => removePhone(index)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <FormLabel>Email adrese</FormLabel>
            <Button type="button" variant="outline" size="sm" className="w-full shrink-0 sm:w-auto" onClick={() => appendEmail({ value: "" })}>
              <Plus className="w-3 h-3 mr-1" /> Dodaj email
            </Button>
          </div>
          <div className="space-y-2">
            {emailFields.map((field, index) => (
              <div key={field.id} className="flex gap-2">
                <FormField control={form.control} name={`emails.${index}.value`} render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl><Input placeholder="adresa@email.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {emailFields.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeEmail(index)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <FormField control={form.control} name="billingAddress" render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                Adresa za fakturisanje
                <span className="text-[10px] text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Map placeholder</span>
              </FormLabel>
              <FormControl><Input placeholder="Ulica, Broj, Grad" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="installationAddress" render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                Adresa ugradnje
                <span className="text-[10px] text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Map placeholder</span>
              </FormLabel>
              <FormControl><Input placeholder="Ulica, Broj, Grad" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField control={form.control} name="pib" render={({ field }) => (
            <FormItem>
              <FormLabel>PIB (opciono)</FormLabel>
              <FormControl><Input placeholder="Poreski broj" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="registrationNumber" render={({ field }) => (
            <FormItem>
              <FormLabel>Matični broj (opciono)</FormLabel>
              <FormControl><Input placeholder="Matični broj firme" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
          <Button type="button" variant="outline" onClick={onCancel}>Otkaži</Button>
          <Button type="submit" disabled={isLoading}>{initialData?.id ? "Sačuvaj izmene" : "Kreiraj klijenta"}</Button>
        </div>
      </form>
    </Form>
  );
}
