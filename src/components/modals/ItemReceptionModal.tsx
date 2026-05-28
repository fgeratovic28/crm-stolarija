import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IntegerQuantityInput } from "@/components/shared/IntegerQuantityInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFiles } from "@/hooks/use-files";
import { useBarcodeScannerListener } from "@/hooks/use-barcode-scanner-listener";
import { matchItemReceptionActionBarcode } from "@/lib/item-reception-modal-barcodes";
import type { MaterialOrderLine } from "@/types";

export type ItemReceptionConfirmPayload = {
  receivedIntact: number;
  missing: number;
  damaged: number;
  notes: string;
  photoUrls: string[];
};

function clampNonNegInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function ItemReceptionModal({
  open,
  onOpenChange,
  line,
  expectedQty,
  jobId,
  materialOrderId,
  uploadedBy,
  saved,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line: MaterialOrderLine;
  expectedQty: number;
  jobId?: string | null;
  materialOrderId: string;
  uploadedBy: string;
  saved?: ItemReceptionConfirmPayload | null;
  onConfirm: (payload: ItemReceptionConfirmPayload) => void;
}) {
  const { uploadFile } = useFiles();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [receivedIntact, setReceivedIntact] = useState(0);
  const [missing, setMissing] = useState(0);
  const [damaged, setDamaged] = useState(0);
  const [notes, setNotes] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);

  const m = line.procurementMeta;
  const uom = (line.unit ?? "kom").trim() || "kom";
  const missingQty = clampNonNegInt(missing);
  const damagedQty = clampNonNegInt(damaged);
  const needsComplaintDetails = missingQty > 0 || damagedQty > 0;

  useEffect(() => {
    if (!needsComplaintDetails) setNotes("");
    if (damagedQty <= 0) setPhotoUrls([]);
  }, [needsComplaintDetails, damagedQty]);

  useEffect(() => {
    if (!open) return;
    if (saved) {
      setReceivedIntact(saved.receivedIntact);
      setMissing(saved.missing);
      setDamaged(saved.damaged);
      setNotes(saved.notes);
      setPhotoUrls(Array.isArray(saved.photoUrls) ? [...saved.photoUrls] : []);
      return;
    }
    setReceivedIntact(Math.max(0, Math.floor(expectedQty)));
    setMissing(0);
    setDamaged(0);
    setNotes("");
    setPhotoUrls([]);
  }, [open, saved, expectedQty]);

  const handleConfirm = useCallback(() => {
    const ri = clampNonNegInt(receivedIntact);
    const mi = clampNonNegInt(missing);
    const da = clampNonNegInt(damaged);
    const sum = ri + mi + da;
    if (sum !== expectedQty) {
      toast.error("Količine se ne slažu", {
        description: `Zbir (ispravno + nedostaje + oštećeno) mora biti tačno ${expectedQty} (${uom}).`,
      });
      return;
    }
    if ((mi > 0 || da > 0) && !notes.trim()) {
      toast.error("Napomena je obavezna", {
        description: "Unesite napomenu ili detalje reklamacije kada ima nedostajućeg ili oštećenog materijala.",
      });
      return;
    }
    if (da > 0 && photoUrls.length === 0) {
      toast.error("Potrebna je fotografija", {
        description: "Kod oštećenog materijala otpremite bar jednu fotografiju kao dokaz.",
      });
      return;
    }
    onConfirm({ receivedIntact: ri, missing: mi, damaged: da, notes: notes.trim(), photoUrls: [...photoUrls] });
    onOpenChange(false);
  }, [
    damaged,
    expectedQty,
    missing,
    notes,
    onConfirm,
    onOpenChange,
    photoUrls,
    receivedIntact,
    uom,
  ]);

  useBarcodeScannerListener(
    (raw) => {
      const action = matchItemReceptionActionBarcode(raw);
      if (action === "confirm") handleConfirm();
      else if (action === "cancel") onOpenChange(false);
    },
    { enabled: open && !uploadBusy, ignoreInputFocus: true },
  );

  const onPickFiles = async (files: FileList | null) => {
    if (!uploadedBy.trim()) {
      toast.error("Morate biti prijavljeni da biste otpremili fajl.");
      return;
    }
    if (!files?.length) return;
    if (damagedQty <= 0) return;
    setUploadBusy(true);
    try {
      const nextUrls: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error("Samo slike", { description: file.name });
          continue;
        }
        const res = await uploadFile.mutateAsync({
          jobId: jobId?.trim() || undefined,
          materialOrderId,
          category: "supplier",
          file,
          uploadedBy,
        });
        if (res.storageUrl) nextUrls.push(res.storageUrl);
      }
      if (nextUrls.length) setPhotoUrls((prev) => [...prev, ...nextUrls]);
    } catch {
      /* toast u hook-u */
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,40rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prijem stavke</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          {m?.article_code?.trim() ? (
            <p>
              <span className="text-muted-foreground">Šifra: </span>
              <span className="font-mono font-medium">{m.article_code.trim()}</span>
            </p>
          ) : null}
          {m?.color?.trim() ? (
            <p>
              <span className="text-muted-foreground">Boja: </span>
              <span className="font-medium">{m.color.trim()}</span>
            </p>
          ) : null}
          <p>
            <span className="text-muted-foreground">JM: </span>
            <span className="font-medium">{uom}</span>
            <span className="text-muted-foreground"> · Očekivano: </span>
            <span className="font-semibold tabular-nums">{expectedQty}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Artikal: </span>
            <span className="font-medium">{m?.article?.trim() || line.description}</span>
          </p>
          {m?.work_order?.trim() ? (
            <p className="text-xs text-muted-foreground">Nalog: {m.work_order.trim()}</p>
          ) : null}
          {m?.position?.trim() ? (
            <p className="text-xs text-muted-foreground">Pozicija: {m.position.trim()}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="recv-intact" className="text-sm leading-tight">
              Primljeno ispravno
            </Label>
            <IntegerQuantityInput
              id="recv-intact"
              max={expectedQty}
              value={receivedIntact}
              onValueChange={setReceivedIntact}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="recv-miss" className="text-sm leading-tight">
              Nedostaje
            </Label>
            <IntegerQuantityInput
              id="recv-miss"
              max={expectedQty}
              value={missing}
              onValueChange={setMissing}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="recv-dmg" className="text-sm leading-tight">
              Oštećeno
            </Label>
            <IntegerQuantityInput
              id="recv-dmg"
              max={expectedQty}
              value={damaged}
              onValueChange={setDamaged}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Zbir tri polja mora biti {expectedQty}. Trenutni zbir:{" "}
          <span className="font-mono tabular-nums">
            {clampNonNegInt(receivedIntact) + clampNonNegInt(missing) + clampNonNegInt(damaged)}
          </span>
        </p>

        {needsComplaintDetails ? (
          <div className="space-y-1.5">
            <Label htmlFor="recv-notes">Napomena / detalji reklamacije</Label>
            <Textarea
              id="recv-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Obavezno ako ima nedostataka ili oštećenja…"
            />
          </div>
        ) : null}

        {damagedQty > 0 ? (
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void onPickFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-2"
              disabled={uploadBusy || uploadFile.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadBusy || uploadFile.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Otpremi fotografije (dokaz oštećenja)
            </Button>
            {photoUrls.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {photoUrls.map((url, i) => (
                  <div key={`${url}-${i}`} className="relative h-16 w-16 overflow-hidden rounded-md border">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-0.5 top-0.5 rounded bg-background/90 p-0.5 shadow"
                      onClick={() => setPhotoUrls((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Ukloni sliku"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Otkaži
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={uploadBusy}>
            Potvrdi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
