import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export const URGENT_SITE_MISSING_QUERY_KEY = ["urgent-site-missing-notifications"] as const;

export type UrgentSiteMissingProcurementTriage = {
  materialOrderId: string;
  /** Legacy vanredna stavka; `null` kada je kreirana samo Porudžbina po nedostatku (novi modal). */
  adHocItemId: string | null;
  /** Legacy `procurement_ad_hoc_items.status`; za novi tok `null`. */
  adHocStatus: string | null;
  /** `procurement_ad_hoc_items.vrsta_stavke` ili odgovarajuće mapiranje iz `order_kind`. */
  vrstaStavke: string;
  /** `material_orders.delivery_status` shortage narudžbine (novi tok + osvežavanje). */
  shortageDeliveryStatus: string | null;
  requiresProduction: boolean;
  /** Link `awaiting_production_at` — čeka se proizvodnja pre zakaživanja dopune. */
  awaitingProduction: boolean;
};

export type UrgentSiteMissingRow = {
  id: string;
  title: string;
  description: string;
  jobId: string | null;
  createdAt: string;
  jobNumber: string | null;
  /** Iz `user_notifications.meta` (pozicija sa predračuna). */
  position: string | null;
  /** `lower(trim(position))` za spajanje sa `invoice_missing_site_procurement`. */
  positionKey: string | null;
  /** Otvorena veza ka nabavci (dugme „Prosledi u nabavku“). */
  procurementTriage: UrgentSiteMissingProcurementTriage | null;
  /** Već je kliknuto „Zaboravljeno u magacinu“ — RN dopune postoji (`invoice_missing_part_secured`). */
  installationFollowupSecured?: boolean;
};

/** Isto pravilo kao `position_key` u bazi — za keš / optimistic ažuriranja. */
export function urgentSiteMissingPositionKey(position: string | null | undefined): string | null {
  if (!position || !String(position).trim()) return null;
  return String(position).trim().toLowerCase();
}

export function urgentSiteMissingRowMatches(
  row: UrgentSiteMissingRow,
  jobId: string,
  positionTrimmed: string,
): boolean {
  if (row.jobId !== jobId) return false;
  const key = urgentSiteMissingPositionKey(positionTrimmed);
  if (!key) return false;
  return row.positionKey === key || urgentSiteMissingPositionKey(row.position) === key;
}

function metaPosition(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const p = m.position;
  if (typeof p === "string" && p.trim()) return p.trim();
  if (typeof p === "number" && Number.isFinite(p)) return String(p);
  return null;
}

/** Fallback kada meta.position nedostaje; ne sme da se zaustavi na zarezu („1,“ umesto „1, 2“ ili „12“). */
function extractPositionFromUrgentTitle(title: string): string | null {
  const m = title.match(/Poziciju\s+(.+?)\s*\(Posao/i);
  const s = m?.[1]?.trim().replace(/\s+/g, " ");
  return s || null;
}

function positionKeyFromDisplay(position: string | null): string | null {
  if (!position || !position.trim()) return null;
  return position.trim().toLowerCase();
}

type MaterialOrderNested = {
  delivery_status?: string;
  requires_production?: boolean | null;
};

export function useUrgentSiteMissingNotifications(enabled: boolean) {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: [...URGENT_SITE_MISSING_QUERY_KEY, user?.id],
    enabled: enabled && !!user?.id,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_notifications")
        .select("id, title, description, job_id, created_at, meta, jobs ( job_number )")
        .eq("user_id", user!.id)
        .eq("notification_type", "urgent_on_site_missing")
        .eq("read", false)
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) throw error;

      const base = (data ?? []).map((r: Record<string, unknown>) => {
        const jobsRaw = r.jobs;
        const jobRel = (Array.isArray(jobsRaw) ? jobsRaw[0] : jobsRaw) as { job_number?: string } | null;
        const position = metaPosition(r.meta) ?? extractPositionFromUrgentTitle(String(r.title ?? ""));
        return {
          id: String(r.id),
          title: String(r.title ?? ""),
          description: String(r.description ?? ""),
          jobId: typeof r.job_id === "string" ? r.job_id : null,
          createdAt: String(r.created_at ?? ""),
          jobNumber: typeof jobRel?.job_number === "string" ? jobRel.job_number : null,
          position,
          positionKey: positionKeyFromDisplay(position),
          procurementTriage: null as UrgentSiteMissingProcurementTriage | null,
        } satisfies UrgentSiteMissingRow;
      });

      const jobIds = [...new Set(base.map((b) => b.jobId).filter(Boolean))] as string[];
      if (jobIds.length === 0) return base;

      const { data: linkRows, error: linkErr } = await supabase
        .from("invoice_missing_site_procurement")
        .select(
          "job_id, position_key, material_order_id, ad_hoc_item_id, awaiting_production_at, material_orders ( delivery_status, requires_production )",
        )
        .in("job_id", jobIds)
        .is("completed_at", null);

      if (linkErr) throw linkErr;

      const { data: securedRows, error: securedErr } = await supabase
        .from("invoice_missing_part_secured")
        .select("job_id, position_key")
        .in("job_id", jobIds);

      const securedPairKeys = new Set<string>();
      if (securedErr) {
        console.warn("[urgent-site-missing] invoice_missing_part_secured:", securedErr.message);
      } else {
        for (const s of securedRows ?? []) {
          const jid = (s as { job_id?: string }).job_id;
          const pk = (s as { position_key?: string }).position_key;
          if (typeof jid === "string" && typeof pk === "string" && jid && pk) {
            securedPairKeys.add(`${jid}:${pk}`);
          }
        }
      }

      const links = (linkRows ?? []) as Record<string, unknown>[];
      const adHocIds = [
        ...new Set(
          links
            .map((L) => (typeof L.ad_hoc_item_id === "string" ? L.ad_hoc_item_id : null))
            .filter(Boolean),
        ),
      ] as string[];

      let statusByAdHocId: Record<string, string> = {};
      let vrstaByAdHocId: Record<string, string> = {};
      if (adHocIds.length > 0) {
        const { data: adRows, error: adErr } = await supabase
          .from("procurement_ad_hoc_items")
          .select("id, status, vrsta_stavke")
          .in("id", adHocIds);
        if (adErr) throw adErr;
        for (const ar of adRows ?? []) {
          const rec = ar as { id?: string; status?: string; vrsta_stavke?: string };
          if (rec.id && typeof rec.status === "string") statusByAdHocId[rec.id] = rec.status;
          if (rec.id && typeof rec.vrsta_stavke === "string") vrstaByAdHocId[rec.id] = rec.vrsta_stavke;
        }
      }

      return base.map((row) => {
        let next: UrgentSiteMissingRow = row;
        if (row.jobId && row.positionKey && securedPairKeys.has(`${row.jobId}:${row.positionKey}`)) {
          next = { ...row, installationFollowupSecured: true };
        }

        if (!next.jobId || !next.positionKey) return next;
        const hit = links.find(
          (L) =>
            String(L.job_id) === next.jobId &&
            typeof L.position_key === "string" &&
            L.position_key === next.positionKey,
        );
        if (!hit) return next;
        const materialOrderId = typeof hit.material_order_id === "string" ? hit.material_order_id : null;
        if (!materialOrderId) return next;

        const moRaw = hit.material_orders;
        const mo = (Array.isArray(moRaw) ? moRaw[0] : moRaw) as MaterialOrderNested | null | undefined;
        const shortageDeliveryStatus =
          typeof mo?.delivery_status === "string" && mo.delivery_status.length > 0 ? mo.delivery_status : null;
        const requiresProduction = Boolean(mo?.requires_production);

        const adHocItemId = typeof hit.ad_hoc_item_id === "string" ? hit.ad_hoc_item_id : null;
        const st = adHocItemId ? statusByAdHocId[adHocItemId] : null;
        const vrsta = adHocItemId
          ? (vrstaByAdHocId[adHocItemId] ?? "sirovine_za_proizvodnju")
          : requiresProduction
            ? "sirovine_za_proizvodnju"
            : "gotov_proizvod";

        if (adHocItemId && !st) return next;

        const awaitingRaw =
          typeof hit.awaiting_production_at === "string" && hit.awaiting_production_at.length > 0;
        const awaitingProduction = awaitingRaw;

        return {
          ...next,
          procurementTriage: {
            materialOrderId,
            adHocItemId,
            adHocStatus: st,
            vrstaStavke: vrsta,
            shortageDeliveryStatus,
            requiresProduction,
            awaitingProduction,
          },
        };
      });
    },
  });
}
