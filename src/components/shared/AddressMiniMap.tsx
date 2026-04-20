import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { divIcon, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { ExternalLink, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveCoordinatesForInstallation } from "@/lib/map-geocode";
import { MAP_TILE_ATTRIBUTION, MAP_TILE_SUBDOMAINS, MAP_TILE_URL } from "@/lib/map-tiles";

const markerIcon = divIcon({
  className: "address-mini-map-marker",
  html: "<span style='display:block;width:12px;height:12px;border-radius:9999px;background:#2563eb;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)'></span>",
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function MapResizeOnMount() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    fix();
    requestAnimationFrame(fix);
    const t = window.setTimeout(fix, 250);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

type Status = "idle" | "loading" | "ok" | "fail";

export interface AddressMiniMapProps {
  address: string;
  className?: string;
}

/**
 * Kompaktna mapa (Leaflet + Nominatim preko resolveCoordinatesForInstallation).
 * Koristi se pored polja za adresu u formularima (npr. klijent).
 */
export function AddressMiniMap({ address, className }: AddressMiniMapProps) {
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [center, setCenter] = useState<LatLngTuple | null>(null);

  const trimmedLive = (address ?? "").trim();

  useEffect(() => {
    if (!trimmedLive) {
      setDebounced("");
      return;
    }
    const t = window.setTimeout(() => setDebounced(trimmedLive), 450);
    return () => window.clearTimeout(t);
  }, [trimmedLive]);

  useEffect(() => {
    let cancelled = false;
    const q = debounced.trim();

    if (!q) {
      setStatus("idle");
      setCenter(null);
      return () => {
        cancelled = true;
      };
    }

    setStatus("loading");
    setCenter(null);
    void (async () => {
      const coords = await resolveCoordinatesForInstallation({ address: q });
      if (cancelled) return;
      if (!coords) {
        setCenter(null);
        setStatus("fail");
        return;
      }
      setCenter([coords.lat, coords.lng]);
      setStatus("ok");
    })();

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  if (!trimmedLive) return null;

  /** Dok korisnik kuca, `debounced` zaostaje — ne prikazujemo staru tačku na pogrešnoj adresi. */
  if (trimmedLive !== debounced.trim()) {
    return (
      <p className={cn("mt-2 text-xs text-muted-foreground", className)}>
        Mapa će se učitati posle kratke pauze u unosu…
      </p>
    );
  }

  if (status === "idle") return null;

  if (status === "loading") {
    return (
      <div
        className={cn(
          "mt-2 flex h-[7.5rem] items-center justify-center gap-2 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        <span>Traženje lokacije…</span>
      </div>
    );
  }

  if (status === "fail") {
    return (
      <p className={cn("mt-2 flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <span>Adresa nije pronađena na mapi — proverite grad i ulicu.</span>
      </p>
    );
  }

  if (!center) return null;

  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((address ?? "").trim())}`;

  return (
    <div className={cn("relative mt-2 h-[7.5rem] overflow-hidden rounded-md border border-border", className)}>
      <MapContainer center={center} zoom={16} scrollWheelZoom={false} className="h-full w-full z-0 [&_.leaflet-control-attribution]:text-[9px] [&_.leaflet-control-attribution]:leading-tight">
        <MapResizeOnMount />
        <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} subdomains={MAP_TILE_SUBDOMAINS} />
        <Marker position={center} icon={markerIcon} />
      </MapContainer>
      <a
        href={mapsHref}
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-1 right-1 z-[1000] flex items-center gap-0.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-primary shadow-sm ring-1 ring-border hover:bg-muted"
      >
        Google
        <ExternalLink className="h-2.5 w-2.5 opacity-80" aria-hidden />
      </a>
    </div>
  );
}
