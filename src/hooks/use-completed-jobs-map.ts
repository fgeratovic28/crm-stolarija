import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Activity, JobStatus } from "@/types";
import { resolveCoordinatesForInstallation } from "@/lib/map-geocode";

export type CompletedJobMapItem = {
  id: string;
  jobNumber: string;
  status: JobStatus;
  summary: string;
  customerName: string;
  installationAddress?: string;
  billingAddress?: string;
  customerPhone?: string;
  createdAt: string;
  statusChangedAt?: string;
  location: {
    lat: number;
    lng: number;
    source: "coordinates" | "address-inline";
  } | null;
};

function mapCompletedJobRow(row: Record<string, unknown>, hasCoordinates: boolean): Omit<CompletedJobMapItem, "location"> & {
  _lat?: number | null;
  _lng?: number | null;
} {
  const customerRaw = row.customers as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
  const installationAddress = typeof row.installation_address === "string" ? row.installation_address : undefined;

  const rawLat = hasCoordinates ? row.installation_lat : null;
  const rawLng = hasCoordinates ? row.installation_lng : null;
  const lat = rawLat === null || rawLat === undefined || rawLat === "" ? Number.NaN : Number(rawLat);
  const lng = rawLng === null || rawLng === undefined || rawLng === "" ? Number.NaN : Number(rawLng);
  const hasStoredCoordinates = Number.isFinite(lat) && Number.isFinite(lng);

  return {
    id: String(row.id),
    jobNumber: String(row.job_number ?? ""),
    status: (row.status as JobStatus) ?? "completed",
    summary: String(row.summary ?? ""),
    customerName: String(customer?.name ?? "Nepoznat klijent"),
    installationAddress,
    billingAddress: typeof row.billing_address === "string" ? row.billing_address : undefined,
    customerPhone: typeof row.customer_phone === "string" ? row.customer_phone : undefined,
    createdAt: String(row.created_at ?? ""),
    statusChangedAt: typeof row.status_changed_at === "string" ? row.status_changed_at : undefined,
    _lat: hasStoredCoordinates ? lat : null,
    _lng: hasStoredCoordinates ? lng : null,
  };
}

async function loadCompletedJobsRows() {
  const selectWithCoords = `
    id,
    job_number,
    status,
    summary,
    created_at,
    status_changed_at,
    installation_address,
    billing_address,
    customer_phone,
    installation_lat,
    installation_lng,
    customers (name)
  `;

  const withCoords = await supabase
    .from("jobs")
    .select(selectWithCoords)
    .eq("status", "completed")
    .order("status_changed_at", { ascending: false });

  if (!withCoords.error) {
    return {
      rows: (withCoords.data ?? []) as Record<string, unknown>[],
      hasCoordinates: true,
    };
  }

  const selectLegacy = `
    id,
    job_number,
    status,
    summary,
    created_at,
    status_changed_at,
    installation_address,
    billing_address,
    customer_phone,
    customers (name)
  `;

  const legacy = await supabase
    .from("jobs")
    .select(selectLegacy)
    .eq("status", "completed")
    .order("status_changed_at", { ascending: false });

  if (legacy.error) throw legacy.error;
  return {
    rows: (legacy.data ?? []) as Record<string, unknown>[],
    hasCoordinates: false,
  };
}

export function useCompletedJobsMap() {
  return useQuery({
    queryKey: ["completed-jobs-map"],
    queryFn: async () => {
      const { rows, hasCoordinates } = await loadCompletedJobsRows();
      const mapped = rows.map((row) => mapCompletedJobRow(row, hasCoordinates));

      const withLocations = await Promise.all(
        mapped.map(async (job) => {
          const { _lat, _lng, ...rest } = job;
          const coords = await resolveCoordinatesForInstallation({
            address: rest.installationAddress,
            installationLat: _lat ?? null,
            installationLng: _lng ?? null,
          });
          if (!coords) {
            return { ...rest, location: null as CompletedJobMapItem["location"] };
          }
          const fromDb = _lat != null && _lng != null && Number.isFinite(_lat) && Number.isFinite(_lng);
          return {
            ...rest,
            location: {
              lat: coords.lat,
              lng: coords.lng,
              source: fromDb ? ("coordinates" as const) : ("address-inline" as const),
            },
          };
        }),
      );

      return withLocations;
    },
  });
}

export function useJobActivitiesForMap(jobId: string | null) {
  return useQuery({
    queryKey: ["completed-job-map-activities", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      if (!jobId) return [] as Activity[];
      const { data, error } = await supabase
        .from("activities")
        .select(`
          id,
          job_id,
          type,
          description,
          date,
          file_id,
          users (name)
        `)
        .eq("job_id", jobId)
        .order("date", { ascending: false })
        .limit(12);
      if (error) throw error;

      return (data ?? []).map((row) => {
        const user = Array.isArray(row.users) ? row.users[0] : row.users;
        return {
          id: row.id,
          jobId: row.job_id,
          type: row.type,
          description: row.description,
          createdBy: user?.name || "Sistem",
          createdAt: row.date,
          attachmentName: row.file_id ? "Prilog" : undefined,
        } as Activity;
      });
    },
  });
}
