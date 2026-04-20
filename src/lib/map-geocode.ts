/** Shared geocoding + cache for job/installation maps (Nominatim + localStorage). */

export const GEOCODE_CACHE_KEY = "jobs-map-geocode-cache-v1";

/** Ceo string je samo lat,lng (npr. za mapu), bez tekstualne adrese. */
export function installationAddressIsCoordinatesOnly(text: string | undefined | null): boolean {
  if (!text) return false;
  return /^\s*-?\d{1,2}(?:\.\d+)?\s*[,;]\s*-?\d{1,3}(?:\.\d+)?\s*$/.test(text);
}

/**
 * Za prikaz u UI: ako je na poslu u `installation_address` samo lat,lng, koristi adresu klijenta iz `customers`.
 */
export function getInstallationAddressForDisplay(job: {
  jobInstallationAddress?: string;
  customer: { installationAddress: string };
}): string {
  const jobPart = job.jobInstallationAddress?.trim() ?? "";
  const cust = job.customer.installationAddress?.trim() ?? "";
  if (jobPart && installationAddressIsCoordinatesOnly(jobPart)) {
    return cust || jobPart;
  }
  return jobPart || cust || "";
}

export function parseInlineCoordinates(address?: string | null): { lat: number; lng: number } | null {
  if (!address) return null;
  const match = address.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function readGeocodeCache(): Record<string, { lat: number; lng: number }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(GEOCODE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { lat: number; lng: number }>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeGeocodeCache(cache: Record<string, { lat: number; lng: number }>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

export function normalizeAddressForGeocoding(address?: string): string {
  return (address ?? "").trim().replace(/\s+/g, " ");
}

function extractCoordinates(rows: Array<{ lat?: string; lon?: string }>): { lat: number; lng: number } | null {
  const first = rows[0];
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function buildGeocodeCandidates(address: string): string[] {
  const normalized = normalizeAddressForGeocoding(address);
  if (!normalized) return [];

  const lowered = normalized.toLowerCase();
  const hasCountry =
    lowered.includes("serbia") ||
    lowered.includes("srbija") ||
    lowered.includes("republika srbija");

  const noParen = normalized.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const noFloorOrApartment = noParen
    .replace(/\b(stan|sprat|ulaz)\b[^,]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const variants = [
    normalized,
    noParen,
    noFloorOrApartment,
    hasCountry ? "" : `${normalized}, Srbija`,
    hasCountry ? "" : `${normalized}, Serbia`,
  ];

  const unique = new Set<string>();
  for (const value of variants) {
    const cleaned = normalizeAddressForGeocoding(value);
    if (cleaned) unique.add(cleaned);
  }

  return [...unique];
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const candidates = buildGeocodeCandidates(address);
  for (const candidate of candidates) {
    const params = new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      addressdetails: "0",
      countrycodes: "rs",
      "accept-language": "sr,en",
      q: candidate,
    });

    let res: Response;
    try {
      res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: {
          Accept: "application/json",
        },
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;

    const rows = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const extracted = extractCoordinates(rows);
    if (extracted) return extracted;
  }

  return null;
}

export function tryStoredCoordinates(lat?: unknown, lng?: unknown): { lat: number; lng: number } | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  // Safety guard against legacy null -> 0 coercion.
  if (la === 0 && ln === 0) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

/**
 * Resolve WGS84 coordinates: DB columns → inline lat,lng in text → Nominatim (cached).
 */
export async function resolveCoordinatesForInstallation(opts: {
  address?: string | null;
  installationLat?: number | null;
  installationLng?: number | null;
}): Promise<{ lat: number; lng: number } | null> {
  const stored = tryStoredCoordinates(opts.installationLat, opts.installationLng);
  if (stored) return stored;

  const inline = parseInlineCoordinates(opts.address ?? null);
  if (inline) return inline;

  const normalized = normalizeAddressForGeocoding(opts.address ?? undefined);
  if (!normalized) return null;

  const cache = readGeocodeCache();
  if (cache[normalized]) return cache[normalized];

  const geocoded = await geocodeAddress(normalized);
  if (!geocoded) return null;

  cache[normalized] = geocoded;
  writeGeocodeCache(cache);
  return geocoded;
}
