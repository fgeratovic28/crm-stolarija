import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type Step = "q_proforma" | "position" | "measurements";

export type MissingOnSiteApplyResult =
  | { flow: "proforma_position"; positions: string[] }
  | { flow: "client_extra_measurements"; text: string };

export type ReportMissingOnSiteModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobNumber?: string;
  /** Upisuje podatke u roditeljski terenski izveštaj; korisnik zatim čuva ceo izveštaj. */
  onApply: (payload: MissingOnSiteApplyResult) => void;
};

export function ReportMissingOnSiteModal({
  open,
  onOpenChange,
  jobNumber,
  onApply,
}: ReportMissingOnSiteModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("q_proforma");
  const [positionDraft, setPositionDraft] = useState("");
  const [addedPositions, setAddedPositions] = useState<string[]>([]);
  const [measurementsText, setMeasurementsText] = useState("");

  const reset = () => {
    setStep("q_proforma");
    setPositionDraft("");
    setAddedPositions([]);
    setMeasurementsText("");
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const addPositionFromDraft = () => {
    const pos = positionDraft.trim();
    if (!pos) {
      toast({ title: "Upišite broj ili oznaku pozicije", variant: "destructive" });
      return;
    }
    setAddedPositions((prev) => {
      if (prev.some((p) => p.toLowerCase() === pos.toLowerCase())) {
        toast({ title: "Ova pozicija je već na listi", variant: "destructive" });
        return prev;
      }
      return [...prev, pos];
    });
    setPositionDraft("");
  };

  const applyProforma = () => {
    if (addedPositions.length === 0) {
      toast({ title: "Dodajte bar jednu poziciju", variant: "destructive" });
      return;
    }
    onApply({ flow: "proforma_position", positions: [...addedPositions] });
    toast({
      title: "Uneto u izveštaj",
      description:
        "Sačuvajte terenski izveštaj. Posle čuvanja sistem šalje hitno obaveštenje po svakoj poziciji (Nabavka / Proizvodnja / kancelarija); novi RN ugradnje sledi posle odluke u upozorenju na početnoj.",
    });
    close();
  };

  const applyExtraMeasurements = () => {
    const txt = measurementsText.trim();
    if (!txt) {
      toast({ title: "Unesite mere i opis", variant: "destructive" });
      return;
    }
    onApply({ flow: "client_extra_measurements", text: txt });
    toast({
      title: "Uneto u izveštaj",
      description:
        "Tražena dopuna je dodata. Sačuvajte izveštaj — sistem otvara prateći nalog ugradnje po postojećim pravilima.",
    });
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prijavi nedostatak na terenu</DialogTitle>
          <DialogDescription>
            {jobNumber ? `Posao ${jobNumber}. ` : null}
            Podaci se unose u terenski izveštaj; posle čuvanja posao ide u „Ugradnja — problem“. Novi nalog ugradnje za
            ponovno zakazivanje ne otvara se odmah za stavku sa predračuna — otvara ga kancelarija posle izbora u
            upozorenju na početnoj (Nabavka / magacin).
          </DialogDescription>
        </DialogHeader>

        {step === "q_proforma" && (
          <div className="space-y-4 py-2">
            <p className="text-sm font-medium">Da li se stavka nalazi na predračunu?</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="flex-1" onClick={() => setStep("position")}>
                Da
              </Button>
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep("measurements")}>
                Ne
              </Button>
            </div>
          </div>
        )}

        {step === "position" && (
          <div className="space-y-3 py-2">
            <div className="space-y-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3">
              <Label className="text-xs font-medium text-foreground">Pozicije sa predračuna koje nedostaju</Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Za svaku faleću poziciju upišite broj ili oznaku i kliknite „Dodaj“. Možete dodati više pre nego što
                potvrdite unos u izveštaj.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="missing-pos-draft" className="text-[11px] text-muted-foreground">
                    Pozicija
                  </Label>
                  <Input
                    id="missing-pos-draft"
                    value={positionDraft}
                    onChange={(e) => setPositionDraft(e.target.value)}
                    placeholder="npr. 12 ili 12.3"
                    className="h-9"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addPositionFromDraft();
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9 shrink-0 gap-1"
                  onClick={addPositionFromDraft}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Dodaj
                </Button>
              </div>
              {addedPositions.length > 0 ? (
                <ul className="space-y-1.5 rounded-md border border-border bg-card px-2 py-2 text-xs">
                  {addedPositions.map((p, idx) => (
                    <li
                      key={`${p}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5"
                    >
                      <span className="font-mono font-medium text-foreground">{p}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Ukloni poziciju ${p}`}
                        onClick={() => setAddedPositions((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Biće zabeleženo kao nedostatak na terenu. Posle čuvanja izveštaja šalje se hitno obaveštenje Nabavci i
              Proizvodnji.
            </p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPositionDraft("");
                  setAddedPositions([]);
                  setStep("q_proforma");
                }}
              >
                Nazad
              </Button>
              <Button type="button" onClick={applyProforma}>
                Unesi u izveštaj
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "measurements" && (
          <div className="space-y-3 py-2">
            <Label htmlFor="missing-meas">Mere i opis (tražena dopuna / za novu ponudu)</Label>
            <Textarea
              id="missing-meas"
              value={measurementsText}
              onChange={(e) => setMeasurementsText(e.target.value)}
              rows={5}
              placeholder="Dimenzije, lokacija, šta treba ponuditi…"
              autoFocus
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setStep("q_proforma")}>
                Nazad
              </Button>
              <Button type="button" onClick={applyExtraMeasurements}>
                Unesi u izveštaj
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
