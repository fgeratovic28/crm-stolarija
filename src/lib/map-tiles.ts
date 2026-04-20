/**
 * Ne koristiti direktno tile.openstreetmap.org u produkciji — OSM često vrati 403 (Referer / usage policy).
 * Carto CDN je uobičajen izbor za web aplikacije (uz ispravnu atribuciju).
 */
export const MAP_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

/** Carto koristi poddomene a–d za {s} u URL-u. */
export const MAP_TILE_SUBDOMAINS = "abcd";
