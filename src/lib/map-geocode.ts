/** Shared geocoding + cache for job/installation maps (Nominatim + localStorage). */

import {
  buildGeocodeCandidates,
  isCoordsPlausibleForGeocodeAddress,
  normalizeAddressForGeocoding,
} from "../../lib/geocode-plausibility";

export { normalizeAddressForGeocoding } from "../../lib/geocode-plausibility";

export const GEOCODE_CACHE_KEY = "jobs-map-geocode-cache-v3";

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
    if (!parsed || typeof parsed !== "object") return {};

    let changed = false;
    const cleaned: Record<string, { lat: number; lng: number }> = {};
    for (const [key, coords] of Object.entries(parsed)) {
      if (!coords || !isCoordsPlausibleForGeocodeAddress(key, coords)) {
        changed = true;
        continue;
      }
      cleaned[key] = coords;
    }
    if (changed) writeGeocodeCache(cleaned);
    return cleaned;
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

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const q = normalizeAddressForGeocoding(address);
  if (!q) return null;

  try {
    const params = new URLSearchParams({ q });
    const res = await fetch(`/api/geocode?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; lat?: number; lng?: number };
    if (body.ok !== true) return null;
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
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

/** Više varijanti adrese + keš; ne oslanja se na jedan API odgovor. */
async function geocodeAddressWithCandidates(primaryAddress: string): Promise<{ lat: number; lng: number } | null> {
  const candidates = buildGeocodeCandidates(primaryAddress);
  if (candidates.length === 0) return null;

  const cache = readGeocodeCache();
  const primaryKey = normalizeAddressForGeocoding(primaryAddress);

  for (const candidate of candidates) {
    const key = normalizeAddressForGeocoding(candidate);
    const cached = cache[key];
    if (cached && isCoordsPlausibleForGeocodeAddress(key, cached)) {
      return cached;
    }
  }

  for (const candidate of candidates.slice(0, 6)) {
    const key = normalizeAddressForGeocoding(candidate);
    const geocoded = await geocodeAddress(candidate);
    if (!geocoded) continue;
    if (!isCoordsPlausibleForGeocodeAddress(key, geocoded)) continue;

    cache[key] = geocoded;
    if (primaryKey && primaryKey !== key) {
      cache[primaryKey] = geocoded;
    }
    writeGeocodeCache(cache);
    return geocoded;
  }

  return null;
}

/**
 * Resolve WGS84 coordinates: DB columns → inline lat,lng in text → Nominatim (cached).
 */
export async function resolveCoordinatesForInstallation(opts: {
  address?: string | null;
  installationLat?: number | null;
  installationLng?: number | null;
}): Promise<{ lat: number; lng: number } | null> {
  const normalized = normalizeAddressForGeocoding(opts.address ?? undefined);

  const stored = tryStoredCoordinates(opts.installationLat, opts.installationLng);
  if (stored && isCoordsPlausibleForGeocodeAddress(normalized, stored)) {
    return stored;
  }

  const inline = parseInlineCoordinates(opts.address ?? null);
  if (inline && isCoordsPlausibleForGeocodeAddress(normalized, inline)) {
    return inline;
  }

  if (!normalized) return null;

  return geocodeAddressWithCandidates(normalized);
}
