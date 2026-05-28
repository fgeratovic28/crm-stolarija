import { useEffect, useMemo, useState } from "react";
import { DollarSign, Pencil } from "lucide-react";
import { StatCard } from "@/components/shared/StatCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { RecordPaymentModal } from "@/components/modals/RecordPaymentModal";
import { useRole } from "@/contexts/RoleContext";
import { formatCurrencyBySettings, formatDateByAppLanguage } from "@/lib/app-settings";
import { labelQuoteDeliveryMethod } from "@/lib/quote-delivery-method";
import { labelQuoteStatus } from "@/lib/activity-labels";
import type { Job, Payment, Quote } from "@/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UpdateJobPricingInput } from "@/hooks/use-jobs";
import { computeJobAmountsFromLineSum, splitPaymentByJobVat, vatAmountsFromTotalDue } from "@/lib/job-pricing";
import { moneyInputStringFromNumber, parseMoneyInput } from "@/lib/money-input";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { DEFAULT_OUTGOING_VAT_RATE_PERCENT, VAT_RATE_CHOICES, type VatRatePercent } from "@/lib/vat-constants";

export function FinancesTab({
  job,
  payments,
  quotes = [],
  updateJobPricing,
}: {
  job: Job;
  payments: Payment[];
  quotes?: Quote[];
  updateJobPricing: {
    mutateAsync: (input: UpdateJobPricingInput) => Promise<void>;
    isPending: boolean;
  };
}) {
  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const { canPerformAction, hasAccess } = useRole();

  const latestQuote = [...quotes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  const acceptedQuote = [...quotes]
    .filter((q) => q.status === "accepted")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const paymentDefaultIncludesVat = Boolean(
    (acceptedQuote ?? latestQuote)?.pricesIncludeVat ?? job.pricesIncludeVat,
  );

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = job.totalPrice - totalPaid;
  const showJobPriceForm = hasAccess("finances");

  const [editPayment, setEditPayment] = useState<Payment | null>(null);
  const [editPriceOpen, setEditPriceOpen] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [formVatRate, setFormVatRate] = useState<VatRatePercent>(DEFAULT_OUTGOING_VAT_RATE_PERCENT);
  const [formPricesIncludeVat, setFormPricesIncludeVat] = useState(true);

  useEffect(() => {
    if (!editPriceOpen) return;
    setPriceInput(moneyInputStringFromNumber(job.totalPrice));
    setFormVatRate(job.vatRatePercent === 20 ? 20 : 0);
    setFormPricesIncludeVat(job.pricesIncludeVat);
  }, [editPriceOpen, job.totalPrice, job.vatRatePercent, job.pricesIncludeVat]);

  const breakdownPreview = useMemo(() => {
    const amt = parseMoneyInput(priceInput);
    if (amt == null || amt <= 0) return { empty: true as const };
    const rate = formVatRate;
    const pi = formPricesIncludeVat;
    if (rate === 0) {
      return { empty: false as const, base: amt, vat: 0, total: amt };
    }
    const d = pi ? vatAmountsFromTotalDue(amt, rate) : computeJobAmountsFromLineSum(amt, false, rate);
    return {
      empty: false as const,
      base: d.priceWithoutVat,
      vat: d.vatAmount,
      total: d.totalPrice,
    };
  }, [priceInput, formVatRate, formPricesIncludeVat]);

  const remainingSplit = splitPaymentByJobVat(
    remainingBalance,
    job.totalPrice,
    job.priceWithoutVat,
    job.vatAmount,
  );

  const saveJobPrice = async () => {
    if (breakdownPreview.empty) return;
    await updateJobPricing.mutateAsync({
      id: job.id,
      totalDue: breakdownPreview.total,
      pricesIncludeVat: formVatRate === 0 ? true : formPricesIncludeVat,
      vatRatePercent: formVatRate,
    });
    setEditPriceOpen(false);
  };

  const estimatedPriceDisplay = job.totalPrice > 0 ? formatCurrency(job.totalPrice) : "-";

  const canRecordPayment = canPerformAction("record_payment");

  return (
    <div className="space-y-6">
      {canRecordPayment ? (
        <RecordPaymentModal
          jobId={job.id}
          payment={editPayment}
          open={editPayment != null}
          onOpenChange={(next) => {
            if (!next) setEditPayment(null);
          }}
          defaultIncludesVat={paymentDefaultIncludesVat}
        />
      ) : null}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Ukupan iznos za naplatu (posao)</h3>
          </div>
          {showJobPriceForm ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-2"
              onClick={() => setEditPriceOpen((v) => !v)}
            >
              <Pencil className="h-3.5 w-3.5" />
              {editPriceOpen ? "Zatvori uređivanje" : "Cena posla"}
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard title="Ukupna cena" value={estimatedPriceDisplay} icon={DollarSign} />
          <StatCard title="Osnovica (bez PDV-a)" value={formatCurrency(job.priceWithoutVat)} icon={DollarSign} />
          <StatCard
            title={`PDV (${job.vatRatePercent}%)`}
            value={formatCurrency(job.vatAmount)}
            icon={DollarSign}
          />
          <StatCard title="Preostalo za uplatu" value={formatCurrency(remainingBalance)} icon={DollarSign} />
        </div>
        {remainingBalance > 0.009 && job.totalPrice > 0.009 ? (
          <div className="rounded-lg border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Analiza preostalog duga (procena)</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
              <span>
                Osnovica: <span className="text-foreground">{formatCurrency(remainingSplit.base)}</span>
              </span>
              <span>
                PDV: <span className="text-foreground">{formatCurrency(remainingSplit.vat)}</span>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {editPriceOpen && showJobPriceForm ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 p-4 space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">
            Ručno usklađivanje kada nema ponude ili za korekciju. Isti obračun kao pri prihvatanju ponude.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`job-price-total-${job.id}`}>
                {formPricesIncludeVat || formVatRate === 0
                  ? "Ukupna cena za naplatu"
                  : "Osnovica (bez PDV-a)"}
              </Label>
              <MoneyInput
                id={`job-price-total-${job.id}`}
                value={priceInput}
                onValueChange={setPriceInput}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Stopa PDV</Label>
              <Select
                value={String(formVatRate)}
                onValueChange={(v) => {
                  const next = v === "20" ? 20 : 0;
                  setFormVatRate(next);
                  if (next === 0) setFormPricesIncludeVat(true);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VAT_RATE_CHOICES.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id={`job-price-inc-${job.id}`}
              checked={formPricesIncludeVat}
              onCheckedChange={(v) => setFormPricesIncludeVat(v === true)}
              disabled={formVatRate === 0}
            />
            <Label htmlFor={`job-price-inc-${job.id}`} className="text-xs font-normal leading-snug cursor-pointer">
              Iznos gore je sa uključenim PDV-om (bruto)
            </Label>
          </div>
          {!breakdownPreview.empty ? (
            <div className="rounded-lg border border-border bg-background/80 p-3 space-y-1 tabular-nums text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Osnovica</span>
                <span>{formatCurrency(breakdownPreview.base)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Iznos PDV-a</span>
                <span>{formatCurrency(breakdownPreview.vat)}</span>
              </div>
              <div className="flex justify-between font-semibold pt-1 border-t border-border">
                <span>Ukupna cena</span>
                <span>{formatCurrency(breakdownPreview.total)}</span>
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={breakdownPreview.empty || updateJobPricing.isPending}
              onClick={() => void saveJobPrice()}
            >
              {updateJobPricing.isPending ? "Čuvanje…" : "Sačuvaj cenu posla"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditPriceOpen(false)}>
              Otkaži
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
        <Badge
          variant={job.pricesIncludeVat ? "secondary" : "outline"}
          className="shrink-0 w-fit"
          title={job.pricesIncludeVat ? "Stavke ponude sa PDV-om" : "Stavke ponude bez PDV-a"}
        >
          {job.pricesIncludeVat ? "Ponuda: sa PDV-om u stavkama" : "Ponuda: bez PDV-a u stavkama"}
        </Badge>
        <Badge variant={job.vatRatePercent === 20 ? "default" : "outline"} className="shrink-0 w-fit">
          Stopa PDV na poslu: {job.vatRatePercent}%
        </Badge>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {job.vatRatePercent === 0
            ? "Za ovaj posao je evidentirano 0% PDV-a; ceo iznos za naplatu je osnovica."
            : job.pricesIncludeVat
              ? `Stopa ${job.vatRatePercent}%: jedinične cene u ponudi su bile bruto; osnovica i PDV izvode se iz ukupnog iznosa.`
              : `Stopa ${job.vatRatePercent}%: jedinične cene su bile neto (osnovica); PDV se dodaje na ukupan zbir.`}
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-foreground text-sm">Istorija plaćanja</h3>
            {canRecordPayment ? (
              <RecordPaymentModal jobId={job.id} defaultIncludesVat={paymentDefaultIncludesVat} />
            ) : null}
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-4">
            <div>
              Uplaćeno: <span className="font-medium text-success">{formatCurrency(totalPaid)}</span>
            </div>
          </div>
        </div>
        {payments.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={DollarSign}
              title="Nema evidentiranih plaćanja"
              description="Još uvek nema uplata za ovaj posao."
              actionLabel={canPerformAction("record_payment") ? "Evidentiraj uplatu" : undefined}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3">Datum</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3">Iznos</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3 hidden sm:table-cell">
                    PDV
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3">Napomena</th>
                  {canRecordPayment ? (
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3 w-[1%]">
                      Akcije
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 sm:px-5 py-3 text-sm">
                      {formatDateByAppLanguage(p.date) || p.date}
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-sm font-medium">{formatCurrency(p.amount)}</td>
                    <td className="px-4 sm:px-5 py-3 hidden sm:table-cell">
                      <Badge
                        variant={p.includesVat ? "secondary" : "outline"}
                        className="font-normal"
                        title={
                          p.includesVat ? "Uplata evidentirana kao sa uključenim PDV-om" : "Uplata evidentirana kao bez PDV-a"
                        }
                      >
                        {p.includesVat ? "Sa PDV-om" : "Bez PDV-a"}
                      </Badge>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-sm text-muted-foreground">{p.note || "—"}</td>
                    {canRecordPayment ? (
                      <td className="px-4 sm:px-5 py-3 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => setEditPayment(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Izmeni
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {quotes.length > 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <div className="p-4 sm:p-5 border-b border-border">
            <h3 className="font-semibold text-foreground text-sm">Ponude (evidencija slanja)</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Pregled načina na koji je klijent primio svaku verziju ponude.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left font-medium text-muted-foreground px-4 sm:px-5 py-2.5">Verzija</th>
                  <th className="text-left font-medium text-muted-foreground px-4 sm:px-5 py-2.5">Datum</th>
                  <th className="text-left font-medium text-muted-foreground px-4 sm:px-5 py-2.5">Status</th>
                  <th className="text-left font-medium text-muted-foreground px-4 sm:px-5 py-2.5">Način slanja</th>
                  <th className="text-right font-medium text-muted-foreground px-4 sm:px-5 py-2.5">Iznos</th>
                  <th className="text-right font-medium text-muted-foreground px-4 sm:px-5 py-2.5">PDV stopa</th>
                </tr>
              </thead>
              <tbody>
                {[...quotes]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((q) => (
                    <tr key={q.id} className="border-b border-border last:border-0">
                      <td className="px-4 sm:px-5 py-2.5 font-medium">
                        {q.versionName?.trim() || `${q.quoteNumber} v${q.versionNumber}`}
                      </td>
                      <td className="px-4 sm:px-5 py-2.5 text-muted-foreground whitespace-nowrap">
                        {formatDateByAppLanguage(q.createdAt)}
                      </td>
                      <td className="px-4 sm:px-5 py-2.5">{labelQuoteStatus(q.status)}</td>
                      <td className="px-4 sm:px-5 py-2.5">{labelQuoteDeliveryMethod(q.deliveryMethod)}</td>
                      <td className="px-4 sm:px-5 py-2.5 text-right tabular-nums">
                        {formatCurrencyBySettings(q.totalAmount)}
                      </td>
                      <td className="px-4 sm:px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                        {q.vatRatePercent ?? 0}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
