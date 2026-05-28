import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import {
  getInstallationAddressForDisplay,
  installationAddressIsCoordinatesOnly,
  resolveCoordinatesForInstallation,
} from "@/lib/map-geocode";
import { jobInstallationStreetAddress } from "@/lib/job-installation-location";
import type { FieldTeamWorkOrder } from "@/hooks/use-field-team-data";

export type FieldTeamMapMarker = {
  workOrder: FieldTeamWorkOrder;
  coords: { lat: number; lng: number };
};

/** Ulica za geokodiranje — bez sprata/stana (sprat/stan zbunjuju geokoder). */
function resolveWorkOrderGeocodeStreet(wo: FieldTeamWorkOrder): string | undefined {
  const measurementAddress = wo.measurementLocation?.trim();
  if (measurementAddress) return measurementAddress;

  const jobAddr = wo.job?.installationAddress?.trim() ?? "";
  const customerAddr = wo.job?.customer?.installationAddress?.trim() ?? "";

  if (jobAddr && installationAddressIsCoordinatesOnly(jobAddr)) {
    return customerAddr || jobAddr;
  }

  if (wo.job) {
    const street = jobInstallationStreetAddress({
      installationAddress: wo.job.installationAddress,
    });
    if (street) return street;
  }

  return customerAddr || undefined;
}

function resolveWorkOrderGeocodeInput(wo: FieldTeamWorkOrder): {
  address?: string;
  installationLat?: number | null;
  installationLng?: number | null;
} {
  const measurementAddress = wo.measurementLocation?.trim();
  if (measurementAddress) {
    return { address: measurementAddress, installationLat: null, installationLng: null };
  }

  const street = resolveWorkOrderGeocodeStreet(wo);
  if (street) {
    return {
      address: street,
      installationLat: wo.job?.installationLat ?? null,
      installationLng: wo.job?.installationLng ?? null,
    };
  }

  if (wo.job?.customer?.installationAddress) {
    const display = getInstallationAddressForDisplay({
      jobInstallationAddress: wo.job.installationAddress,
      customer: { installationAddress: wo.job.customer.installationAddress },
    }).trim();
    if (display) {
      return {
        address: jobInstallationStreetAddress({ installationAddress: display }) || display,
        installationLat: wo.job.installationLat ?? null,
        installationLng: wo.job.installationLng ?? null,
      };
    }
  }

  return {
    address: undefined,
    installationLat: wo.job?.installationLat ?? null,
    installationLng: wo.job?.installationLng ?? null,
  };
}

export function useFieldTeamMapMarkers(workOrders: FieldTeamWorkOrder[] | undefined) {
  const { user } = useAuthStore();
  const active = useMemo(
    () => (workOrders ?? []).filter((w) => w.status === "pending" || w.status === "in_progress"),
    [workOrders],
  );

  return useQuery({
    queryKey: [
      "field-team-map-markers",
      "geocode-v4",
      user?.teamId,
      active
        .map((w) => {
          const g = resolveWorkOrderGeocodeInput(w);
          return [w.id, g.installationLat, g.installationLng, g.address ?? ""].join(":");
        })
        .join("|"),
    ],
    queryFn: async (): Promise<FieldTeamMapMarker[]> => {
      const enriched = await Promise.all(
        active.map(async (wo) => {
          const geocodeInput = resolveWorkOrderGeocodeInput(wo);
          const coords = await resolveCoordinatesForInstallation(geocodeInput);
          if (!coords) return null;
          return { workOrder: wo, coords };
        }),
      );
      return enriched.filter((x): x is FieldTeamMapMarker => x !== null);
    },
    enabled: active.length > 0 && !!user?.teamId,
    staleTime: 60_000,
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
