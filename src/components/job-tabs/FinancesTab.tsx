import { DollarSign } from "lucide-react";
import { StatCard } from "@/components/shared/StatCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { RecordPaymentModal } from "@/components/modals/RecordPaymentModal";
import { useRole } from "@/contexts/RoleContext";
import { formatCurrencyBySettings } from "@/lib/app-settings";
import type { Job, Payment } from "@/types";

export function FinancesTab({ job, payments }: { job: Job; payments: Payment[] }) {
  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const { canPerformAction } = useRole();

  // Dynamic balance calculation
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = job.totalPrice - totalPaid;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Cena (bez PDV-a)" value={formatCurrency(job.priceWithoutVat)} icon={DollarSign} />
        <StatCard title="PDV (20%)" value={formatCurrency(job.vatAmount)} icon={DollarSign} />
        <StatCard title="Ukupno (sa PDV-om)" value={formatCurrency(job.totalPrice)} icon={DollarSign} />
        <StatCard title="Preostalo" value={formatCurrency(remainingBalance)} icon={DollarSign} />
      </div>
      <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
        <Badge
          variant={job.pricesIncludeVat ? "secondary" : "outline"}
          className="shrink-0 w-fit"
          title={job.pricesIncludeVat ? "Stavke ponude sa PDV-om" : "Stavke ponude bez PDV-a"}
        >
          {job.pricesIncludeVat ? "Ponuda: sa PDV-om" : "Ponuda: bez PDV-a"}
        </Badge>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {job.pricesIncludeVat
            ? "Jedinične cene stavki ponude bile su sa uključenim PDV-om; osnovica i PDV su izračunati od ukupnog iznosa."
            : "Jedinične cene stavki ponude bile su bez PDV-a; PDV 20% je dodat na zbir stavki da bi se dobio iznos za naplatu."}
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-foreground text-sm">Istorija plaćanja</h3>
            {canPerformAction("record_payment") && <RecordPaymentModal jobId={job.id} />}
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-4">
            <div>
              Uplaćeno: <span className="font-medium text-success">{formatCurrency(totalPaid)}</span>
            </div>
          </div>
        </div>
        {payments.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={DollarSign} title="Nema evidentiranih plaćanja" description="Još uvek nema uplata za ovaj posao." actionLabel={canPerformAction("record_payment") ? "Evidentiraj uplatu" : undefined} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3">Datum</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3">Iznos</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3 hidden sm:table-cell">PDV</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 sm:px-5 py-3">Napomena</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 sm:px-5 py-3 text-sm">{p.date}</td>
                    <td className="px-4 sm:px-5 py-3 text-sm font-medium">{formatCurrency(p.amount)}</td>
                    <td className="px-4 sm:px-5 py-3 hidden sm:table-cell">
                      <Badge
                        variant={p.includesVat ? "secondary" : "outline"}
                        className="font-normal"
                        title={p.includesVat ? "Uplata evidentirana kao sa uključenim PDV-om" : "Uplata evidentirana kao bez PDV-a"}
                      >
                        {p.includesVat ? "Sa PDV-om" : "Bez PDV-a"}
                      </Badge>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-sm text-muted-foreground">{p.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
