import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { divIcon, type LatLngTuple } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { format } from "date-fns";
import { sr } from "date-fns/locale";
import {
  MapPin,
  Navigation,
  Calendar,
  Phone,
  Loader2,
  Crosshair,
  ListOrdered,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import type { FieldTeamWorkOrder } from "@/hooks/use-field-team-data";
import { distanceKm, useFieldTeamMapMarkers, type FieldTeamMapMarker } from "@/hooks/use-field-team-map";
import { labelWorkOrderType } from "@/lib/activity-labels";
import { cn } from "@/lib/utils";

const defaultCenter: LatLngTuple = [44.7866, 20.4489];

const markerIcon = (color: string) =>
  divIcon({
    className: "field-team-wo-marker",
    html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

const userIcon = divIcon({
  className: "field-team-user-marker",
  html:
    "<span style='display:block;width:14px;height:14px;border-radius:9999px;background:#0ea5e9;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35)'></span>",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function FitBounds({
  markerPositions,
  userPos,
}: {
  markerPositions: LatLngTuple[];
  userPos: LatLngTuple | null;
}) {
  const map = useMap();
  useEffect(() => {
    const pts: LatLngTuple[] = [...markerPositions];
    if (userPos) pts.push(userPos);
    if (pts.length === 0) return;
    const b = L.latLngBounds(pts);
    map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
  }, [map, markerPositions, userPos]);
  return null;
}

function openDirections(opts: {
  dest: { lat: number; lng: number } | null;
  origin: { lat: number; lng: number } | null;
  address?: string;
}) {
  const { dest, origin, address } = opts;
  const destinationQuery = dest ? `${dest.lat},${dest.lng}` : (address ? encodeURIComponent(address) : "");
  if (!destinationQuery) return;
  if (origin) {
    window.open(
      `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destinationQuery}`,
      "_blank",
    );
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destinationQuery}`, "_blank");
  }
}

function getCustomerPhone(wo: FieldTeamWorkOrder): string | undefined {
  const c = wo.job?.customer;
  if (!c) return undefined;
  return c.phones?.[0];
}

type FieldTeamWorkOrdersMapProps = {
  workOrders: FieldTeamWorkOrder[];
  onOpenWorkOrder: (wo: FieldTeamWorkOrder) => void;
};

export function FieldTeamWorkOrdersMap({ workOrders, onOpenWorkOrder }: FieldTeamWorkOrdersMapProps) {
  const { toast } = useToast();
  const { data: markers = [], isLoading: loadingMarkers } = useFieldTeamMapMarkers(workOrders);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [open, setOpen] = useState(false);

  const activeOrders = useMemo(
    () => workOrders.filter((w) => w.status === "pending" || w.status === "in_progress"),
    [workOrders],
  );

  const markerPositions = useMemo(
    () => markers.map((m) => [m.coords.lat, m.coords.lng] as LatLngTuple),
    [markers],
  );

  const sortedMarkers = useMemo(() => {
    const enriched = markers.map((m) => ({
      ...m,
      distanceKm: userPos ? distanceKm(userPos, m.coords) : undefined,
    }));
    enriched.sort((a, b) => {
      if (userPos && a.distanceKm != null && b.distanceKm != null) {
        return a.distanceKm - b.distanceKm;
      }
      const ta = new Date(a.workOrder.date).getTime();
      const tb = new Date(b.workOrder.date).getTime();
      return ta - tb;
    });
    return enriched;
  }, [markers, userPos]);

  const mapCenter = useMemo((): LatLngTuple => {
    if (markerPositions.length > 0) return markerPositions[0];
    if (userPos) return [userPos.lat, userPos.lng];
    return defaultCenter;
  }, [markerPositions, userPos]);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      toast({
        title: "Lokacija nije dostupna",
        description: "Vaš pregledač ne podržava geolokaciju.",
        variant: "destructive",
      });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        toast({ title: "Lokacija učitana", description: "Lista je sortirana po udaljenosti." });
      },
      () => {
        setLocating(false);
        toast({
          title: "Nije moguće očitati lokaciju",
          description: "Dozvolite pristup lokaciji u pregledaču ili koristite Navigacija bez polazne tačke.",
          variant: "destructive",
        });
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden border-border/80">
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5 text-primary" />
                Mapa aktivnih naloga
              </CardTitle>
              <CardDescription>
                Samo nalozi u statusu „Na čekanju“ ili „U toku“. Uključite lokaciju da vidite najbliže zadatke i pokrenete
                navigaciju.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2" onClick={requestLocation} disabled={locating}>
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                {userPos ? "Osveži moju lokaciju" : "Moja lokacija"}
              </Button>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="secondary" size="sm">
                  {open ? "Sakrij mapu" : "Prikaži mapu"}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {activeOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">
                Trenutno nema aktivnih naloga (Na čekanju / U toku), pa nema tačaka za prikaz.
              </p>
            ) : loadingMarkers ? (
              <div className="flex h-48 items-center justify-center rounded-lg border bg-muted/20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : markers.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">
                Nema tačaka na mapi — adrese aktivnih naloga nisu mogli da se lociraju. Proverite adresu ugradnje na poslu ili
                unesite koordinate u sistem.
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[1fr_minmax(260px,320px)]">
            <div className="h-[340px] w-full overflow-hidden rounded-xl border">
              <MapContainer center={mapCenter} zoom={12} scrollWheelZoom className="h-full w-full z-0">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FitBounds markerPositions={markerPositions} userPos={userPos ? [userPos.lat, userPos.lng] : null} />
                {userPos && (
                  <Marker position={[userPos.lat, userPos.lng]} icon={userIcon}>
                    <Popup>Vaša trenutna lokacija (približno)</Popup>
                  </Marker>
                )}
                <MarkerClusterGroup chunkedLoading maxClusterRadius={52} spiderfyOnMaxZoom showCoverageOnHover={false}>
                  {markers.map((m) => (
                    <Marker
                      key={m.workOrder.id}
                      position={[m.coords.lat, m.coords.lng]}
                      icon={markerIcon(m.workOrder.status === "in_progress" ? "#2563eb" : "#ea580c")}
                      eventHandlers={{
                        click: () => onOpenWorkOrder(m.workOrder),
                      }}
                    >
                      <Popup>
                        <FieldTeamMarkerPopupContent
                          marker={m}
                          userPos={userPos}
                          onDetails={() => onOpenWorkOrder(m.workOrder)}
                        />
                      </Popup>
                    </Marker>
                  ))}
                </MarkerClusterGroup>
              </MapContainer>
            </div>

            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ListOrdered className="h-3.5 w-3.5" />
                {userPos ? "Najbliže prvo" : "Po datumu naloga"}
              </div>
              <ScrollArea className="h-[340px] rounded-lg border">
                <div className="p-2 space-y-2">
                  {sortedMarkers.map((m) => (
                    <button
                      key={m.workOrder.id}
                      type="button"
                      className="w-full rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:bg-muted/50"
                      onClick={() => onOpenWorkOrder(m.workOrder)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-primary">{m.workOrder.job?.jobNumber}</p>
                          <p className="text-xs text-muted-foreground">{labelWorkOrderType(m.workOrder.type)}</p>
                        </div>
                        {m.distanceKm != null && (
                          <Badge variant="secondary" className="shrink-0">
                            {m.distanceKm < 1
                              ? `${Math.round(m.distanceKm * 1000)} m`
                              : `${m.distanceKm.toFixed(1)} km`}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {m.workOrder.job?.installationAddress || "Bez adrese"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDirections({
                              dest: m.coords,
                              origin: userPos,
                              address: m.workOrder.job?.installationAddress,
                            });
                          }}
                        >
                          <Navigation className="mr-1 h-3.5 w-3.5" />
                          Navigacija
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={(e) => {
                          e.stopPropagation();
                          onOpenWorkOrder(m.workOrder);
                        }}>
                          Detalji
                        </Button>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
      <div
        className={cn(
          "px-6 pb-4 pt-1 text-sm text-foreground/80",
          open && "hidden",
        )}
      >
        Kliknite na <span className="font-semibold text-foreground">Prikaži mapu</span> za pregled lokacija i navigaciju.
      </div>
    </Collapsible>
  );
}

function FieldTeamMarkerPopupContent({
  marker,
  userPos,
  onDetails,
}: {
  marker: FieldTeamMapMarker;
  userPos: { lat: number; lng: number } | null;
  onDetails: () => void;
}) {
  const wo = marker.workOrder;
  const phone = getCustomerPhone(wo);
  return (
    <div className="min-w-[200px] space-y-2 text-sm">
      <div>
        <p className="font-semibold">{wo.job?.jobNumber}</p>
        <p className="text-xs text-muted-foreground">{labelWorkOrderType(wo.type)}</p>
      </div>
      <Badge variant={wo.status === "in_progress" ? "default" : "secondary"}>
        {wo.status === "in_progress" ? "U toku" : "Na čekanju"}
      </Badge>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Calendar className="h-3 w-3 shrink-0" />
        {wo.date ? format(new Date(wo.date), "dd.MM.yyyy", { locale: sr }) : "—"}
      </p>
      <p className="text-xs leading-snug">{wo.job?.installationAddress || "Nema adrese"}</p>
      {phone && (
        <a href={`tel:${phone}`} className="flex items-center gap-1 text-xs text-primary">
          <Phone className="h-3 w-3" />
          {phone}
        </a>
      )}
      <p className="text-xs line-clamp-3 text-muted-foreground">{wo.description || "—"}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="default" className="h-8" type="button" onClick={onDetails}>
          Detalji naloga
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          type="button"
          onClick={() =>
            openDirections({
              dest: marker.coords,
              origin: userPos,
              address: marker.workOrder.job?.installationAddress,
            })
          }
        >
          <Navigation className="mr-1 h-3.5 w-3.5" />
          Navigacija
        </Button>
      </div>
    </div>
  );
}
