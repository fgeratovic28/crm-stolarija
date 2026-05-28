import { useEffect, useState } from "react";
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
import { MoneyInput } from "@/components/shared/MoneyInput";
import { moneyInputStringFromNumber, parseMoneyInput } from "@/lib/money-input";
import type { Payment } from "@/types";

const paymentSchema = z.object({
  amount: z
    .string()
    .trim()
    .refine((v) => {
      const n = parseMoneyInput(v);
      return n != null && n >= 0.01;
    }, "Iznos mora biti veći od 0"),
  date: z.string().trim().min(1, "Datum je obavezan"),
  includesVat: z.boolean(),
  note: z.string().trim().max(200).optional(),
});

type PaymentValues = z.infer<typeof paymentSchema>;

function paymentDateForInput(date: string): string {
  const raw = date.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function emptyPaymentValues(defaultIncludesVat: boolean): PaymentValues {
  return {
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    includesVat: defaultIncludesVat,
    note: "",
  };
}

function valuesFromPayment(payment: Payment): PaymentValues {
  return {
    amount: moneyInputStringFromNumber(payment.amount),
    date: paymentDateForInput(payment.date),
    includesVat: payment.includesVat,
    note: payment.note ?? "",
  };
}

interface RecordPaymentModalProps {
  jobId: string;
  defaultIncludesVat?: boolean;
  trigger?: React.ReactNode;
  /** Izmena postojeće uplate (kontrolisani modal). */
  payment?: Payment | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function RecordPaymentModal({
  jobId,
  defaultIncludesVat = true,
  trigger,
  payment = null,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: RecordPaymentModalProps) {
  const isEdit = payment != null;
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = (next: boolean) => {
    if (isControlled) controlledOnOpenChange?.(next);
    else setInternalOpen(next);
  };

  const { recordPayment, updatePayment } = useJobRelatedData(jobId);
  const pending = isEdit ? updatePayment.isPending : recordPayment.isPending;

  const form = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: emptyPaymentValues(defaultIncludesVat),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(isEdit && payment ? valuesFromPayment(payment) : emptyPaymentValues(defaultIncludesVat));
  }, [open, isEdit, payment, defaultIncludesVat, form]);

  const onSubmit = async (data: PaymentValues) => {
    const amount = parseMoneyInput(data.amount);
    if (amount == null || amount < 0.01) return;
    try {
      if (isEdit && payment) {
        await updatePayment.mutateAsync({
          ...payment,
          amount,
          date: data.date,
          includesVat: data.includesVat,
          note: data.note,
        });
      } else {
        await recordPayment.mutateAsync({
          jobId,
          amount,
          date: data.date,
          includesVat: data.includesVat,
          note: data.note,
        });
      }
      setOpen(false);
    } catch {
      // Toast iz hook-a
    }
  };

  const dialog = (
    <DialogContent className="w-full sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Izmena uplate" : "Evidentiranje plaćanja"}</DialogTitle>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Iznos (RSD)</FormLabel>
                <FormControl>
                  <MoneyInput
                    placeholder="0,00"
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Datum plaćanja</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="includesVat"
            render={({ field }) => (
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
            )}
          />

          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Napomena (opciono)</FormLabel>
                <FormControl>
                  <Textarea placeholder="npr. Avans, završna uplata..." rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Otkaži
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (isEdit ? "Čuvanje..." : "Evidentiranje...") : isEdit ? "Sačuvaj izmene" : "Evidentiraj"}
            </Button>
          </div>
        </form>
      </Form>
    </DialogContent>
  );

  if (isControlled) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        {dialog}
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" /> Evidentiraj uplatu
          </Button>
        )}
      </DialogTrigger>
      {dialog}
    </Dialog>
  );
}
