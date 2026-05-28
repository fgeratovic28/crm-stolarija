import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
} from "@/lib/job-status-lifecycle";
import {
  formatJobInstallationLocationDisplay,
  jobInstallationStreetAddress,
  type JobInstallationLocationParts,
} from "@/lib/job-installation-location";
import type { WorkOrder } from "@/types";

export type FieldTeamWorkOrderLocationJob = {
  installationAddress?: string;
  installationApartment?: string;
  installationFloor?: string;
  customer?: { installationAddress?: string };
};

export function fieldTeamWorkOrderLocationParts(
  wo: WorkOrder & { job?: FieldTeamWorkOrderLocationJob },
): JobInstallationLocationParts {
  const j = wo.job;
  if (!j) return {};
  const street =
    j.installationAddress?.trim() || j.customer?.installationAddress?.trim() || "";
  return {
    installationAddress: street || undefined,
    installationApartment: j.installationApartment,
    installationFloor: j.installationFloor,
  };
}

export function getFieldTeamWorkOrderAddress(
  wo: WorkOrder & { job?: FieldTeamWorkOrderLocationJob; measurementLocation?: string },
): string {
  const measurementAddress = wo.measurementLocation?.trim();
  if (measurementAddress) return measurementAddress;
  const parts = fieldTeamWorkOrderLocationParts(wo);
  if (!parts.installationAddress && !parts.installationApartment && !parts.installationFloor) {
    return "";
  }
  const isMeasOrInst =
    wo.type === INSTALLATION_WORK_ORDER_TYPE || MEASUREMENT_WORK_ORDER_TYPES.includes(wo.type);
  if (isMeasOrInst) {
    return formatJobInstallationLocationDisplay(parts);
  }
  return formatJobInstallationLocationDisplay(parts) || parts.installationAddress || "";
}

export function getFieldTeamWorkOrderStreetForMaps(
  wo: WorkOrder & { job?: FieldTeamWorkOrderLocationJob; measurementLocation?: string },
): string {
  const measurementAddress = wo.measurementLocation?.trim();
  if (measurementAddress) return measurementAddress;
  return jobInstallationStreetAddress(fieldTeamWorkOrderLocationParts(wo)) || "";
}
