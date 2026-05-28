import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFiles } from "@/hooks/use-files";
import { useCreateProcurementAdHocItem } from "@/hooks/use-procurement-ad-hoc-items";

type UploadedAttachment = {
  fileId: string;
  filename: string;
  storageUrl: string | null;
};

export function ProcurementAdHocItemModal({
  open,
  onOpenChange,
  orderId,
  jobId,
  uploadedBy,
  supplierLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string;
  jobId?: string | null;
  uploadedBy: string;
  supplierLabel?: string;
}) {
  const { uploadFile, deleteFile } = useFiles();
  const createMutation = useCreateProcurementAdHocItem();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [description, setDescription] = useState("");
  const [articleCode, setArticleCode] = useState("");
  const [quantity, setQuantity] = useState<string>("1");
  const [unit, setUnit] = useState("kom");
  const [notes, setNotes] = useState("");
  const [workOrder, setWorkOrder] = useState("");
  const [position, setPosition] = useState("");
  const [color, setColor] = useState("");
  const [lengthMm, setLengthMm] = useState("");
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);

  useEffect(() => {
    if (!open) {
      setDescription("");
      setArticleCode("");
      setQuantity("1");
      setUnit("kom");
      setNotes("");
      setWorkOrder("");
      setPosition("");
      setColor("");
      setLengthMm("");
      setAttachment(null);
    }
  }, [open]);

  const isBusy = uploadFile.isPending || createMutation.isPending || deleteFile.isPending;

  const onPickFile = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!uploadedBy.trim()) {
      toast.error("Morate biti prijavljeni da otpremite fajl.");
      return;
    }
    const file = files[0];
    try {
      const res = await uploadFile.mutateAsync({
        jobId: jobId?.trim() || undefined,
        materialOrderId: orderId,
        category: "supplier",
        file,
        uploadedBy,
      });
      setAttachment({
        fileId: res.id,
        filename: res.name,
        storageUrl: res.storageUrl ?? null,
      });
    } catch {
      /* useFiles već prikazuje toast */
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = async () => {
    if (!attachment) return;
    try {
      await deleteFile.mutateAsync(attachment.fileId);
    } catch {
      /* toast u hooku */
    } finally {
      setAttachment(null);
    }
  };

  const handleSubmit = async () => {
    const qty = Number(quantity.replace(",", "."));
    if (!description.trim()) {
      toast.error("Naziv vanredne stavke je obavezan.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Količina mora biti veća od 0.");
      return;
    }

    let lengthValue: number | null = null;
    const lengthRaw = lengthMm.trim();
    if (lengthRaw) {
      const parsed = Number(lengthRaw.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error("Dužina (mm) mora biti pozitivan broj ili prazno polje.");
        return;
      }
      lengthValue = Math.round(parsed);
    }

    try {
      await createMutation.mutateAsync({
        orderId,
        description: description.trim(),
        articleCode: articleCode.trim() || undefined,
        quantity: qty,
        unit: unit.trim() || "kom",
        notes: notes.trim() || undefined,
        attachmentFileId: attachment?.fileId ?? null,
        workOrder: workOrder.trim() || null,
        position: position.trim() || null,
        color: color.trim() || null,
        lengthMm: lengthValue,
      });
      onOpenChange(false);
    } catch {
      /* toast u hooku */
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isBusy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dodaj vanrednu stavku</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {supplierLabel ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Dobavljač: <span className="font-medium text-foreground">{supplierLabel}</span>
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="adhoc-desc">Naziv / opis stavke</Label>
              <Input
                id="adhoc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="npr. Aluminijumski okov za prozore"
                autoFocus
              />
            </div>
            <div className="space-y-1.5 sm:w-[8rem]">
              <Label htmlFor="adhoc-code">Šifra (opciono)</Label>
              <Input
                id="adhoc-code"
                value={articleCode}
                onChange={(e) => setArticleCode(e.target.value)}
                placeholder="—"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="adhoc-qty">Količina</Label>
              <Input
                id="adhoc-qty"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adhoc-unit">Jedinica mere</Label>
              <Input id="adhoc-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adhoc-length">Dužina (mm) <span className="text-muted-foreground">opc.</span></Label>
              <Input
                id="adhoc-length"
                inputMode="numeric"
                value={lengthMm}
                onChange={(e) => setLengthMm(e.target.value)}
                placeholder="npr. 6000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adhoc-color">Boja <span className="text-muted-foreground">opc.</span></Label>
              <Input
                id="adhoc-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="npr. RAL 9016 / antracit"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="adhoc-work-order">Radni nalog (NALOG) <span className="text-muted-foreground">opc.</span></Label>
              <Input
                id="adhoc-work-order"
                value={workOrder}
                onChange={(e) => setWorkOrder(e.target.value)}
                placeholder="npr. 2026-015"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adhoc-position">Pozicija (POZ) <span className="text-muted-foreground">opc.</span></Label>
              <Input
                id="adhoc-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="npr. P1.3"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adhoc-notes">Napomena (opciono)</Label>
            <Textarea
              id="adhoc-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Razlog vanredne nabavke, specifikacije…"
            />
          </div>

          <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Prilog (faktura / specifikacija)
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
              >
                {uploadFile.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Paperclip className="h-3.5 w-3.5" />
                )}
                {attachment ? "Zameni" : "Otpremi fajl"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files)}
              />
            </div>
            {attachment ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm">
                <a
                  href={attachment.storageUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-primary hover:underline"
                >
                  {attachment.filename}
                </a>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => void removeAttachment()}
                  disabled={isBusy}
                  aria-label="Ukloni prilog"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Opciono — možete priložiti fakturu ili specifikaciju. Magacin će videti link uz stavku.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Otkaži
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isBusy}>
            {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Sačuvaj (generiši barkod)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
