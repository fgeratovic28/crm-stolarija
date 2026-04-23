import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus } from "lucide-react";
import { useJobRelatedData } from "@/hooks/use-job-data";

const paymentSchema = z.object({
  amount: z.coerce.number().min(1, "Iznos mora biti veći od 0"),
  date: z.string().trim().min(1, "Datum je obavezan"),
  includesVat: z.boolean(),
  note: z.string().trim().max(200).optional(),
});

type PaymentValues = z.infer<typeof paymentSchema>;

interface RecordPaymentModalProps {
  jobId: string;
  defaultIncludesVat?: boolean;
  trigger?: React.ReactNode;
}

export function RecordPaymentModal({ jobId, defaultIncludesVat = true, trigger }: RecordPaymentModalProps) {
  const [open, setOpen] = useState(false);
  const { recordPayment } = useJobRelatedData(jobId);

  const form = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: 0, date: new Date().toISOString().slice(0, 10), includesVat: defaultIncludesVat, note: "" },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      form.reset({
        amount: 0,
        date: new Date().toISOString().slice(0, 10),
        includesVat: defaultIncludesVat,
        note: "",
      });
    }
  };

  const onSubmit = async (data: PaymentValues) => {
    try {
      await recordPayment.mutateAsync({
        jobId,
        amount: data.amount,
        date: data.date,
        includesVat: data.includesVat,
        note: data.note,
      });
      form.reset({
        amount: 0,
        date: new Date().toISOString().slice(0, 10),
        includesVat: defaultIncludesVat,
        note: "",
      });
      setOpen(false);
    } catch (error) {
      // Error handled in hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Evidentiraj uplatu</Button>}
      </DialogTrigger>
      <DialogContent className="w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Evidentiranje plaćanja</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="amount" render={({ field }) => (
              <FormItem>
                <FormLabel>Iznos (RSD)</FormLabel>
                <FormControl><Input type="number" min={0} placeholder="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem>
                <FormLabel>Datum plaćanja</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="includesVat" render={({ field }) => (
              <FormItem className="border border-border rounded-lg p-3 bg-muted/20 space-y-0">
                <div className="flex items-center justify-between gap-3">
                  <FormLabel htmlFor="payment-includes-vat" className="font-normal cursor-pointer">
                    Iznos uključuje PDV
                  </FormLabel>
                  <FormControl>
                    <Switch
                      id="payment-includes-vat"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="Iznos uključuje PDV"
                    />
                  </FormControl>
                </div>
              </FormItem>
            )} />

            <FormField control={form.control} name="note" render={({ field }) => (
              <FormItem>
                <FormLabel>Napomena (opciono)</FormLabel>
                <FormControl><Textarea placeholder="npr. Avans, završna uplata..." rows={2} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={recordPayment.isPending}>Otkaži</Button>
              <Button type="submit" disabled={recordPayment.isPending}>
                {recordPayment.isPending ? "Evidentiranje..." : "Evidentiraj"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
