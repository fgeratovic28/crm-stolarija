/** Prikaz adrese ugradnje sa opcionim spratom i stanjem (posao). */

export type JobInstallationLocationParts = {
  installationAddress?: string | null;
  installationApartment?: string | null;
  installationFloor?: string | null;
};

export type JobInstallationLocationSource = {
  jobInstallationAddress?: string;
  jobInstallationApartment?: string;
  jobInstallationFloor?: string;
  customer: {
    installationAddress: string;
    installationApartment?: string;
    installationFloor?: string;
  };
};

function installationAddressIsCoordinatesOnly(text: string | undefined | null): boolean {
  if (!text) return false;
  return /^\s*-?\d{1,2}(?:\.\d+)?\s*[,;]\s*-?\d{1,3}(?:\.\d+)?\s*$/.test(text);
}

/** Efektivna lokacija ugradnje: prvo kolone sa posla, pa fallback na kupca. */
export function resolveJobInstallationLocationParts(
  job: JobInstallationLocationSource,
): JobInstallationLocationParts {
  const jobStreet = job.jobInstallationAddress?.trim() ?? "";
  const customerStreet = job.customer.installationAddress?.trim() ?? "";

  let street = jobStreet;
  if (jobStreet && installationAddressIsCoordinatesOnly(jobStreet)) {
    street = customerStreet || jobStreet;
  } else if (!jobStreet) {
    street = customerStreet;
  }

  const apartment =
    job.jobInstallationApartment?.trim() ||
    job.customer.installationApartment?.trim() ||
    undefined;
  const floor =
    job.jobInstallationFloor?.trim() ||
    job.customer.installationFloor?.trim() ||
    undefined;

  return {
    installationAddress: street || undefined,
    installationApartment: apartment,
    installationFloor: floor,
  };
}

export function getJobInstallationLocationDisplay(job: JobInstallationLocationSource): string {
  return formatJobInstallationLocationDisplay(resolveJobInstallationLocationParts(job));
}

export function formatJobInstallationLocationDisplay(
  parts: JobInstallationLocationParts,
): string {
  const address = parts.installationAddress?.trim() ?? "";
  const extras: string[] = [];
  const stan = parts.installationApartment?.trim();
  const sprat = parts.installationFloor?.trim();
  if (sprat) extras.push(`sprat ${sprat}`);
  if (stan) extras.push(`stan ${stan}`);
  if (!address) return extras.join(", ");
  if (!extras.length) return address;
  return `${address}, ${extras.join(", ")}`;
}

/** Ulica za mapu / geokodiranje — bez stana i sprata. */
export function jobInstallationStreetAddress(parts: JobInstallationLocationParts): string {
  return parts.installationAddress?.trim() ?? "";
}
