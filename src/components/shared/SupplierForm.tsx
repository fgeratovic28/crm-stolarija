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
import type { Supplier, MaterialType } from "@/types";

const MATERIAL_TYPES: { value: MaterialType; label: string }[] = [
  { value: "glass", label: "Staklo" },
  { value: "profile", label: "Profil" },
  { value: "hardware", label: "Okov" },
  { value: "shutters", label: "Roletne" },
  { value: "mosquito_net", label: "Komarnici" },
  { value: "sills", label: "Podprozorske daske" },
  { value: "boards", label: "Opšivke" },
  { value: "sealant", label: "Zaptivni materijal" },
  { value: "other", label: "Ostalo" },
];

const supplierSchema = z.object({
  name: z.string().min(2, "Naziv mora imati barem 2 karaktera"),
  contactPerson: z.string().min(2, "Kontakt osoba mora imati barem 2 karaktera"),
  phone: z.string().min(5, "Telefon je obavezan"),
  email: z.string().email("Neispravan email").or(z.literal("")),
  address: z.string().min(5, "Adresa je obavezna"),
  materialTypes: z.array(z.string()).min(1, "Izaberite barem jednu vrstu materijala"),
  active: z.boolean().default(true),
});

export type SupplierFormValues = z.infer<typeof supplierSchema>;

interface SupplierFormProps {
  initialData?: Partial<Supplier>;
  onSubmit: (data: SupplierFormValues) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function SupplierForm({ initialData, onSubmit, onCancel, isLoading }: SupplierFormProps) {
  const form = useForm<z.infer<typeof supplierSchema>>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: initialData?.name || "",
      contactPerson: initialData?.contactPerson || "",
      phone: initialData?.phone || "",
      email: initialData?.email || "",
      address: initialData?.address || "",
      materialTypes: initialData?.materialTypes || [],
      active: initialData?.active ?? true,
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
                <FormLabel>Email (opciono)</FormLabel>
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

        <div className="space-y-3">
          <FormLabel>Vrste materijala</FormLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {MATERIAL_TYPES.map((type) => (
              <FormField
                key={type.value}
                control={form.control}
                name="materialTypes"
                render={({ field }) => {
                  return (
                    <FormItem
                      key={type.value}
                      className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3"
                    >
                      <FormControl>
                        <Checkbox
                          checked={field.value?.includes(type.value)}
                          onCheckedChange={(checked) => {
                            return checked
                              ? field.onChange([...field.value, type.value])
                              : field.onChange(
                                  field.value?.filter(
                                    (value) => value !== type.value
                                  )
                                );
                          }}
                        />
                      </FormControl>
                      <FormLabel className="font-normal cursor-pointer">
                        {type.label}
                      </FormLabel>
                    </FormItem>
                  );
                }}
              />
            ))}
          </div>
          <FormMessage />
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
