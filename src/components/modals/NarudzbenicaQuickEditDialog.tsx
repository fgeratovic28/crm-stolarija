import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NarudzbenicaFields } from "@/components/shared/NarudzbenicaFields";
import {
  narudzbenicaFieldsSchema,
  narudzbenicaDefaultsFromOrder,
  type NarudzbenicaFieldsValues,
} from "@/lib/material-order-form-schema";
import type { MaterialOrder } from "@/types";

interface NarudzbenicaQuickEditDialogProps {
  order: MaterialOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: NarudzbenicaFieldsValues) => void;
  isLoading?: boolean;
}

export function NarudzbenicaQuickEditDialog({
  order,
  open,
  onOpenChange,
  onSave,
  isLoading,
}: NarudzbenicaQuickEditDialogProps) {
  const form = useForm<NarudzbenicaFieldsValues>({
    resolver: zodResolver(narudzbenicaFieldsSchema),
    values: order ? narudzbenicaDefaultsFromOrder(order) : undefined,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Podaci za porudžbenicu</DialogTitle>
          <DialogDescription>
            Ovde menjate stavke i PDV na porudžbenici. Podaci naručioca su u Podešavanjima.
          </DialogDescription>
        </DialogHeader>
        {order && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => {
                onSave(values);
              })}
              className="space-y-4"
            >
              <NarudzbenicaFields control={form.control} />
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                  Otkaži
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Čuvanje…" : "Sačuvaj"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
