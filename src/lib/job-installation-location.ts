/** Prikaz adrese ugradnje sa opcionim spratom i stanjem (posao). */

export type JobInstallationLocationParts = {
  installationAddress?: string | null;
  installationApartment?: string | null;
  installationFloor?: string | null;
};

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
