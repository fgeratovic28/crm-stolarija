import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
import type { Supplier } from "@/types";

const supplierCategories = [
  "Profili",
  "Staklo",
  "Okov",
  "Roletne/Kupovno",
  "Ostalo",
] as const;

const supplierSchema = z.object({
  name: z.string().min(2, "Naziv mora imati barem 2 karaktera"),
  contactPerson: z.string().min(2, "Kontakt osoba mora imati barem 2 karaktera"),
  phone: z.string().min(5, "Telefon je obavezan"),
  email: z.string().trim().min(1, "Email je obavezan").email("Neispravan email"),
  address: z.string().min(5, "Adresa je obavezna"),
  active: z.boolean().default(true),
  category: z.string().min(1, "Kategorija je obavezna").default("Ostalo"),
  bankAccount: z.string().optional().default(""),
  pib: z.string().optional().default(""),
});

export type SupplierFormValues = z.infer<typeof supplierSchema>;

interface SupplierFormProps {
  initialData?: Partial<Supplier>;
  categorySuggestions?: string[];
  onSubmit: (data: SupplierFormValues) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function SupplierForm({ initialData, categorySuggestions, onSubmit, onCancel, isLoading }: SupplierFormProps) {
  const categoryOptions = Array.from(
    new Set([...supplierCategories, ...(categorySuggestions ?? []).map((v) => v.trim()).filter(Boolean)]),
  );
  const form = useForm<z.infer<typeof supplierSchema>>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: initialData?.name || "",
      contactPerson: initialData?.contactPerson || "",
      phone: initialData?.phone || "",
      email: initialData?.email || "",
      address: initialData?.address || "",
      active: initialData?.active ?? true,
      category: initialData?.category || "Ostalo",
      bankAccount: initialData?.bankAccount ?? "",
      pib: initialData?.pib ?? "",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Naziv dobavljača</FormLabel>
                <FormControl>
                  <Input placeholder="npr. GlassPro d.o.o." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contactPerson"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Kontakt osoba</FormLabel>
                <FormControl>
                  <Input placeholder="Ime i prezime" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefon</FormLabel>
                <FormControl>
                  <Input placeholder="+381..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="email@primer.rs" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="md:col-span-2">
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresa</FormLabel>
                  <FormControl>
                    <Input placeholder="Ulica i broj, Grad" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="md:col-span-2 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Finansijski podaci i kategorija</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
            <FormField
              control={form.control}
              name="bankAccount"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Žiro / tekući račun dobavljača</FormLabel>
                  <FormControl>
                    <Input placeholder="Za porudžbenicu (dobavljač)" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pib"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PIB dobavljača</FormLabel>
                  <FormControl>
                    <Input placeholder="Opciono" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Kategorija dobavljača (može nova)</FormLabel>
                  <FormControl>
                    <Input
                      list="supplier-category-suggestions"
                      placeholder="npr. Aluminijum, Servis, Ostalo..."
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <datalist id="supplier-category-suggestions">
                    {categoryOptions.map((cat) => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                  {categoryOptions.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {categoryOptions.map((cat) => {
                        const active = (field.value ?? "").trim() === cat;
                        return (
                          <Button
                            key={cat}
                            type="button"
                            size="sm"
                            variant={active ? "secondary" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() => field.onChange(cat)}
                          >
                            {cat}
                          </Button>
                        );
                      })}
                    </div>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <FormField
          control={form.control}
          name="active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Aktivan dobavljač</FormLabel>
                <p className="text-xs text-muted-foreground">
                  Samo aktivni dobavljači se pojavljuju u listi za nove narudžbine.
                </p>
              </div>
            </FormItem>
          )}
        />

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end sm:gap-3 [&>button]:w-full sm:[&>button]:w-auto">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Otkaži
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Čuvanje..." : "Sačuvaj dobavljača"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
