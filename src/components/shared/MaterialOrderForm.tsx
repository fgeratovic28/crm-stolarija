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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useJobsListSimple } from "@/hooks/use-jobs";
import type { MaterialOrder, MaterialType } from "@/types";

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

const DELIVERY_STATUSES = [
  { value: "pending", label: "Na čekanju" },
  { value: "shipped", label: "Poslato" },
  { value: "delivered", label: "Isporučeno" },
  { value: "partial", label: "Delimično isporučeno" },
];

const orderSchema = z.object({
  jobId: z.string().optional(),
  materialType: z.string().min(1, "Izaberite vrstu materijala"),
  supplierId: z.string().min(1, "Izaberite dobavljača"),
  requestDate: z.string().min(1, "Datum upita je obavezan"),
  expectedDelivery: z.string().min(1, "Očekivani datum je obavezan"),
  deliveryDate: z.string().optional(),
  price: z.coerce.number().min(0, "Cena ne može biti negativna"),
  paid: z.boolean().default(false),
  deliveryVerified: z.boolean().default(false),
  deliveryStatus: z.string().default("pending"),
  notes: z.string().optional(),
  barcode: z.string().optional(),
  allDelivered: z.boolean().default(false),
});

export type MaterialOrderFormValues = z.infer<typeof orderSchema>;

interface MaterialOrderFormProps {
  jobId?: string;
  initialData?: Partial<MaterialOrder>;
  onSubmit: (data: MaterialOrderFormValues) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function MaterialOrderForm({ jobId, initialData, onSubmit, onCancel, isLoading }: MaterialOrderFormProps) {
  const { suppliers } = useSuppliers();
  const { data: jobs } = useJobsListSimple();
  const activeSuppliers = suppliers?.filter(s => s.active) || [];
  const hasFixedJob = Boolean(jobId);

  const form = useForm<MaterialOrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      jobId: jobId || initialData?.jobId || "",
      materialType: initialData?.materialType || "",
      supplierId: initialData?.supplierId || "",
      requestDate: initialData?.requestDate || new Date().toISOString().split("T")[0],
      expectedDelivery: initialData?.expectedDelivery || "",
      deliveryDate: initialData?.deliveryDate || "",
      price: initialData?.price || 0,
      paid: initialData?.paid ?? false,
      deliveryVerified: initialData?.deliveryVerified ?? false,
      deliveryStatus: initialData?.deliveryStatus || "pending",
      notes: initialData?.notes || "",
      barcode: initialData?.barcode || "",
      allDelivered: initialData?.allDelivered ?? false,
    },
  });

  const selectedSupplierId = form.watch("supplierId");
  const selectedSupplier = suppliers?.find(s => s.id === selectedSupplierId);

  const handleInternalSubmit = (data: MaterialOrderFormValues) => {
    // Add supplier name and contact for display/compatibility
    const submissionData = {
      ...data,
      supplier: selectedSupplier?.name || "",
      supplierContact: selectedSupplier?.phone || "",
      // Maintain legacy fields
      orderDate: data.requestDate,
      supplierPrice: data.price,
      quantityVerified: data.deliveryVerified,
    };
    onSubmit(submissionData);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleInternalSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            name="materialType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vrsta materijala</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Izaberite materijal" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MATERIAL_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
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
            name="requestDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Datum upita/narudžbine</FormLabel>
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
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cena (RSD)</FormLabel>
                <FormControl>
                  <Input type="number" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="deliveryStatus"
            render={({ field }) => (
              <FormItem>
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Napomene</FormLabel>
              <FormControl>
                <Textarea placeholder="Dodatni detalji o narudžbini..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
