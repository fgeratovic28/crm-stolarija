import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MaterialOrderForm } from "@/components/shared/MaterialOrderForm";
import type { MaterialOrderFormValues } from "@/components/shared/MaterialOrderForm";
import {
  useInvoiceMissingSendToProcurement,
  type InvoiceMissingSendToProcurementPayload,
} from "@/hooks/use-invoice-missing-send-to-procurement";
import { supabase } from "@/lib/supabase";
import type { MaterialType } from "@/types";
import {
  buildInvoiceMissingSendPayload,
  type InvoiceMissingOrderKind,
} from "@/lib/invoice-missing-shortage-payload";
import { toast } from "sonner";

type ParentMaterialOrderRow = {
  id: string;
  supplier_id: string | null;
  supplier: string | null;
  supplier_contact: string | null;
  material_type: MaterialType;
  delivery_status: string;
  created_at: string;
  is_shortage_order: boolean | null;
};

function rankDeliveryStatus(s: string): number {
  switch (s) {
    case "materials_received":
      return 0;
    case "received_with_issues":
      return 1;
    case "waiting_for_delivery":
      return 2;
    case "sent_to_supplier":
      return 3;
    case "waiting_for_payment":
      return 4;
    default:
      return 5;
  }
}

export type InvoiceMissingShortageOrderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  position: string;
  sendMutation: ReturnType<typeof useInvoiceMissingSendToProcurement>;
  onCreated?: () => void;
};

export function InvoiceMissingShortageOrderModal({
  open,
  onOpenChange,
  jobId,
  position,
  sendMutation,
  onCreated,
}: InvoiceMissingShortageOrderModalProps) {
  const [orderKind, setOrderKind] = useState<InvoiceMissingOrderKind>("gotov_deo");

  const parentQuery = useQuery({
    queryKey: ["invoice-missing-shortage-parent-mo", jobId],
    enabled: open && !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("material_orders")
        .select(
          "id, supplier_id, supplier, supplier_contact, material_type, delivery_status, created_at, is_shortage_order",
        )
        .eq("job_id", jobId);
      if (error) throw error;
      const rows = ((data ?? []) as ParentMaterialOrderRow[]).filter((r) => !r.is_shortage_order);
      rows.sort((a, b) => {
        const d = rankDeliveryStatus(a.delivery_status) - rankDeliveryStatus(b.delivery_status);
        if (d !== 0) return d;
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      return rows[0] ?? null;
    },
  });

  const initialMaterialOrder = useMemo(() => {
    const p = parentQuery.data;
    if (!p?.supplier_id) return undefined;
    return {
      supplierId: p.supplier_id,
      materialType: p.material_type,
      jobId,
    };
  }, [parentQuery.data, jobId]);

  const handleFormSubmit = (data: MaterialOrderFormValues & Record<string, unknown>) => {
    const pos = position.trim();
    if (!pos) {
      toast.error("Nedostaje pozicija sa predračuna.");
      return;
    }
    if (!parentQuery.data?.id) {
      toast.error("Nema osnovne narudžbine materijala na poslu.");
      return;
    }
    const payload = buildInvoiceMissingSendPayload({
      data,
      orderKind,
      invoicePosition: pos,
    }) as InvoiceMissingSendToProcurementPayload;
    sendMutation.mutate(
      { jobId, position: pos, payload },
      {
        onSuccess: () => {
          onOpenChange(false);
          onCreated?.();
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setOrderKind("gotov_deo");
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[min(98vw,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(98vw,56rem)]">
        <DialogHeader className="shrink-0 space-y-2 border-b border-border px-4 py-4 sm:px-6">
          <DialogTitle>Porudžbina po nedostatku (hitno sa ugradnje)</DialogTitle>
          <DialogDescription>
            Isti unos kao za običnu narudžbinu (dobavljač, Excel ili stavke, porudžbenica). Pozicija sa predračuna:{" "}
            <span className="font-medium text-foreground">{position.trim() || "—"}</span>. Za svaku drugu poziciju iz
            upozorenja kreirajte posebnu porudžbinu (ponovo „Prosledi u nabavku“ na tom redu).
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {parentQuery.isError ? (
            <p className="text-sm text-destructive">
              {parentQuery.error instanceof Error
                ? parentQuery.error.message
                : "Greška pri učitavanju roditeljske narudžbine."}
            </p>
          ) : parentQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Učitavanje…</p>
          ) : !parentQuery.data?.supplier_id ? (
            <p className="text-sm text-destructive">
              Za ovaj posao nema standardne narudžbine materijala — dodajte je pre slanja u nabavku.
            </p>
          ) : (
            <>
              <div className="mb-6 rounded-lg border border-border bg-muted/25 p-4">
                <p className="mb-3 text-sm font-medium text-foreground">Tok posle prijema u magacin</p>
                <RadioGroup
                  value={orderKind}
                  onValueChange={(v) => setOrderKind(v as InvoiceMissingOrderKind)}
                  className="grid gap-3"
                >
                  <div className="flex items-start gap-2 rounded-md border border-border bg-background p-3">
                    <RadioGroupItem value="gotov_deo" id="im-flow-gotov" className="mt-1" />
                    <Label htmlFor="im-flow-gotov" className="cursor-pointer font-normal leading-snug">
                      <span className="font-medium">Gotov deo</span> — spreman za ugradnju (bez proizvodnje u pogonu)
                    </Label>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border border-border bg-background p-3">
                    <RadioGroupItem value="sirovine" id="im-flow-prod" className="mt-1" />
                    <Label htmlFor="im-flow-prod" className="cursor-pointer font-normal leading-snug">
                      <span className="font-medium">Ide u proizvodnju</span> — sirovine / obrada (Excel ili ručne
                      stavke)
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <MaterialOrderForm
                key={`${open ? "open" : "closed"}-${jobId}-${initialMaterialOrder?.supplierId ?? ""}`}
                jobId={jobId}
                initialData={initialMaterialOrder}
                submitButtonLabel="Kreiraj porudžbinu po nedostatku"
                onSubmit={handleFormSubmit}
                onCancel={() => onOpenChange(false)}
                isLoading={sendMutation.isPending}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
