import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { resolveCoordinatesForInstallation } from "@/lib/map-geocode";
import type { FieldTeamWorkOrder } from "@/hooks/use-field-team-data";

export type FieldTeamMapMarker = {
  workOrder: FieldTeamWorkOrder;
  coords: { lat: number; lng: number };
};

export function useFieldTeamMapMarkers(workOrders: FieldTeamWorkOrder[] | undefined) {
  const { user } = useAuthStore();
  const active = useMemo(
    () => (workOrders ?? []).filter((w) => w.status === "pending" || w.status === "in_progress"),
    [workOrders],
  );

  return useQuery({
    queryKey: [
      "field-team-map-markers",
      user?.teamId,
      active
        .map((w) =>
          [w.id, w.job?.installationLat, w.job?.installationLng, w.job?.installationAddress ?? ""].join(":"),
        )
        .join("|"),
    ],
    queryFn: async (): Promise<FieldTeamMapMarker[]> => {
      const enriched = await Promise.all(
        active.map(async (wo) => {
          const coords = await resolveCoordinatesForInstallation({
            address: wo.job?.installationAddress,
            installationLat: wo.job?.installationLat ?? null,
            installationLng: wo.job?.installationLng ?? null,
          });
          if (!coords) return null;
          return { workOrder: wo, coords };
        }),
      );
      return enriched.filter((x): x is FieldTeamMapMarker => x !== null);
    },
    enabled: active.length > 0 && !!user?.teamId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Haversine distance in km */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}
