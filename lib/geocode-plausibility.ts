/** Deljena provera da geokodirane / sačuvane koordinate odgovaraju adresi (BG metropola po podrazumevanju). */

export type GeocodeCoords = { lat: number; lng: number };

export const BELGRADE_CENTER: GeocodeCoords = { lat: 44.7866, lng: 20.4489 };
export const BELGRADE_METRO_MAX_KM = 45;

const OTHER_SERBIAN_CITIES = [
  "novi sad",
  "niš",
  "nis",
  "kragujevac",
  "subotica",
  "zrenjanin",
  "pančevo",
  "pancevo",
  "čačak",
  "cacak",
  "kraljevo",
  "smederevo",
  "leskovac",
  "užice",
  "uzice",
  "vranje",
  "šabac",
  "sabac",
  "sombor",
  "požarevac",
  "pozarevac",
] as const;

export function normalizeAddressForGeocoding(address?: string): string {
  return (address ?? "").trim().replace(/\s+/g, " ");
}

export function haversineKm(a: GeocodeCoords, b: GeocodeCoords): number {
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

export function queryMentionsBelgrade(query: string): boolean {
  const l = query.toLowerCase();
  return l.includes("beograd") || l.includes("belgrade") || /\bbg\b/.test(l);
}

export function queryMentionsOtherSerbianCity(query: string): boolean {
  const l = query.toLowerCase();
  return OTHER_SERBIAN_CITIES.some((city) => l.includes(city));
}

/** Da li koordinate odgovaraju tekstu adrese (sprečava npr. Kosovo za beogradsku ulicu). */
export function isGeocodePlausibleForQuery(query: string, coords: GeocodeCoords): boolean {
  if (queryMentionsBelgrade(query)) {
    return haversineKm(coords, BELGRADE_CENTER) <= BELGRADE_METRO_MAX_KM;
  }
  if (queryMentionsOtherSerbianCity(query)) {
    return true;
  }
  return haversineKm(coords, BELGRADE_CENTER) <= BELGRADE_METRO_MAX_KM;
}

export function isCoordsPlausibleForGeocodeAddress(
  address: string | undefined,
  coords: GeocodeCoords,
): boolean {
  const q = normalizeAddressForGeocoding(address);
  if (!q) return true;
  return isGeocodePlausibleForQuery(q, coords);
}

/** Varijante adrese za geokodiranje (bez sprata/stana, sa Beogradom, itd.). */
export function buildGeocodeCandidates(address: string): string[] {
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

  const streetOnly = noFloorOrApartment && !queryMentionsOtherSerbianCity(lowered);
  const withUlica =
    streetOnly && !/\bulica\b/i.test(noFloorOrApartment)
      ? `Ulica ${noFloorOrApartment}, Beograd, Srbija`
      : "";

  const variants = [
    normalized,
    noParen,
    noFloorOrApartment,
    withUlica,
    hasCountry ? "" : `${normalized}, Srbija`,
    hasCountry ? "" : `${normalized}, Beograd, Srbija`,
    streetOnly && !lowered.includes("beograd") ? `${noFloorOrApartment}, Beograd, Srbija` : "",
  ];

  const unique = new Set<string>();
  for (const value of variants) {
    const cleaned = normalizeAddressForGeocoding(value);
    if (cleaned) unique.add(cleaned);
  }

  return [...unique];
}
