/**
 * Geokodiranje adresa na serveru (Vite dev + Vercel API).
 * Nominatim ne dozvoljava pozive iz browsera; Photon (Komoot/OSM) je primarni za Srbiju.
 */

import {
  BELGRADE_CENTER,
  buildGeocodeCandidates,
  type GeocodeCoords,
  haversineKm,
  isGeocodePlausibleForQuery,
  queryMentionsBelgrade,
  queryMentionsOtherSerbianCity,
} from "./geocode-plausibility.js";

export type { GeocodeCoords } from "./geocode-plausibility.js";
export { buildGeocodeCandidates } from "./geocode-plausibility.js";

const SERBIA_BBOX = "18.8,41.8,23.0,46.2";

function pickBestPhotonCoords(query: string, features: Array<{ geometry?: { coordinates?: [number, number] } }>): GeocodeCoords | null {
  const parsed: GeocodeCoords[] = [];
  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    parsed.push({ lat, lng });
  }
  if (parsed.length === 0) return null;

  const plausible = parsed.filter((c) => isGeocodePlausibleForQuery(query, c));
  if (plausible.length === 0) return null;

  if (queryMentionsBelgrade(query) || !queryMentionsOtherSerbianCity(query)) {
    plausible.sort((a, b) => haversineKm(a, BELGRADE_CENTER) - haversineKm(b, BELGRADE_CENTER));
  }

  return plausible[0] ?? null;
}

function nominatimUserAgent(): string {
  const base =
    process.env.GEOCODE_USER_AGENT?.trim() ||
    process.env.VITE_PUBLIC_APP_URL?.trim() ||
    "https://termoplast-crm.local";
  return `TermoPlastCRM/1.0 (${base})`;
}

async function geocodeWithPhoton(query: string): Promise<GeocodeCoords | null> {
  const params = new URLSearchParams({
    q: query,
    limit: "8",
    bbox: SERBIA_BBOX,
    lat: String(BELGRADE_CENTER.lat),
    lon: String(BELGRADE_CENTER.lng),
  });

  let res: Response;
  try {
    res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const body = (await res.json()) as {
    features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
  };
  return pickBestPhotonCoords(query, body.features ?? []);
}

async function geocodeWithNominatim(query: string): Promise<GeocodeCoords | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    addressdetails: "0",
    countrycodes: "rs",
    "accept-language": "sr,en",
    q: query,
  });

  let res: Response;
  try {
    res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": nominatimUserAgent(),
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const rows = (await res.json()) as Array<{ lat?: string; lon?: string }>;
  const first = rows[0];
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Geokodira adresu — Photon prvo, zatim Nominatim (ograničen broj pokušaja). */
export async function geocodeAddressOnServer(address: string): Promise<GeocodeCoords | null> {
  const candidates = buildGeocodeCandidates(address);
  if (candidates.length === 0) return null;

  for (const candidate of candidates.slice(0, 6)) {
    const photon = await geocodeWithPhoton(candidate);
    if (photon) return photon;
  }

  for (const candidate of candidates.slice(0, 4)) {
    const nominatim = await geocodeWithNominatim(candidate);
    if (nominatim && isGeocodePlausibleForQuery(candidate, nominatim)) return nominatim;
    await new Promise((r) => setTimeout(r, 1100));
  }

  return null;
}
