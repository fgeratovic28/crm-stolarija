import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { divIcon, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { MapPinned, Calendar, Phone, CheckCircle2, ClipboardList, MapPin } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { useCompletedJobsMap, useJobActivitiesForMap, type CompletedJobMapItem } from "@/hooks/use-completed-jobs-map";
import { formatDateByAppLanguage } from "@/lib/app-settings";

const defaultCenter: LatLngTuple = [44.7866, 20.4489];

const completedMarkerIcon = divIcon({
  className: "completed-job-marker",
  html: "<span style='display:block;width:14px;height:14px;border-radius:9999px;background:#16a34a;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35)'></span>",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function MapDetailsDialog({
  job,
  open,
  onOpenChange,
}: {
  job: CompletedJobMapItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: activities = [], isLoading } = useJobActivitiesForMap(job?.id ?? null);

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPinned className="h-5 w-5 text-primary" />
            {job.jobNumber} - mini izvestaj
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Klijent</p>
              <p className="font-medium">{job.customerName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Status</p>
              <StatusBadge status={job.status} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Lokacija</p>
              <p className="font-medium">{job.installationAddress || "Nije uneta"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Telefon</p>
              <p className="font-medium">{job.customerPhone || "Nema"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Datum zavrsetka/statusa</p>
              <p className="font-medium">
                {job.statusChangedAt ? formatDateByAppLanguage(job.statusChangedAt) : formatDateByAppLanguage(job.createdAt)}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Bitni detalji</p>
            <p className="text-sm bg-muted rounded-md p-3">{job.summary || "Nema dodatnog opisa."}</p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <ClipboardList className="h-3.5 w-3.5" />
              Aktivnosti (poslednjih 12)
            </p>
            <ScrollArea className="h-52 rounded-md border">
              <div className="p-2 space-y-2">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground p-2">Ucitavanje aktivnosti...</p>
                ) : activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-2">Nema aktivnosti za ovaj posao.</p>
                ) : (
                  activities.map((activity) => (
                    <div key={activity.id} className="rounded-md border bg-card p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <Badge variant="secondary" className="capitalize">{activity.type.replaceAll("_", " ")}</Badge>
                        <span className="text-xs text-muted-foreground">{formatDateByAppLanguage(activity.createdAt)}</span>
                      </div>
                      <p className="text-sm">{activity.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">Autor: {activity.createdBy}</p>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex justify-stretch sm:justify-end">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to={`/jobs/${job.id}`}>Otvori ceo posao</Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CompletedJobsMapPage() {
  const { data: jobs = [], isLoading } = useCompletedJobsMap();
  const [selectedJob, setSelectedJob] = useState<CompletedJobMapItem | null>(null);
  const [open, setOpen] = useState(false);

  const jobsWithLocation = useMemo(() => jobs.filter((job) => !!job.location), [jobs]);

  const mapCenter = useMemo<LatLngTuple>(() => {
    const first = jobsWithLocation[0]?.location;
    if (!first) return defaultCenter;
    return [first.lat, first.lng];
  }, [jobsWithLocation]);

  if (isLoading) {
    return (
      <AppLayout title="Mapa zavrsenih poslova">
        <TableSkeleton rows={6} cols={6} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Mapa zavrsenih poslova">
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Kupci / Poslovi", href: "/jobs" }, { label: "Mapa zavrsenih poslova" }]} />

        <PageHeader
          title="Mapa zavrsenih poslova"
          description={`Prikazano ${jobsWithLocation.length} od ${jobs.length} zavrsenih poslova sa lokacijom.`}
          icon={MapPinned}
        />

        {jobsWithLocation.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="Nema zavrsenih poslova sa koordinatama"
            description="Dodajte koordinate na posao (lat/lng) ili unesite ih u adresu u formatu lat,lng da bi marker bio prikazan."
          />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Ukupno zavrsenih</p>
                <p className="text-xl font-semibold">{jobs.length}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Sa lokacijom</p>
                <p className="text-xl font-semibold">{jobsWithLocation.length}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Bez lokacije</p>
                <p className="text-xl font-semibold">{Math.max(0, jobs.length - jobsWithLocation.length)}</p>
              </div>
            </div>

            <div className="h-[560px] w-full overflow-hidden rounded-xl border">
              <MapContainer center={mapCenter} zoom={11} scrollWheelZoom className="h-full w-full z-0">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MarkerClusterGroup
                  chunkedLoading
                  maxClusterRadius={50}
                  spiderfyOnMaxZoom
                  showCoverageOnHover={false}
                >
                  {jobsWithLocation.map((job) => (
                    <Marker
                      key={job.id}
                      position={[job.location!.lat, job.location!.lng]}
                      icon={completedMarkerIcon}
                      eventHandlers={{
                        click: () => {
                          setSelectedJob(job);
                          setOpen(true);
                        },
                      }}
                    >
                      <Popup>
                        <div className="text-sm space-y-1 min-w-[180px]">
                          <p className="font-semibold">{job.jobNumber}</p>
                          <p>{job.customerName}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {job.statusChangedAt ? formatDateByAppLanguage(job.statusChangedAt) : formatDateByAppLanguage(job.createdAt)}
                          </p>
                          {job.customerPhone && (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              {job.customerPhone}
                            </p>
                          )}
                          <p className="flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Zavrsen posao
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MarkerClusterGroup>
              </MapContainer>
            </div>
          </div>
        )}
      </div>

      <MapDetailsDialog job={selectedJob} open={open} onOpenChange={setOpen} />
    </AppLayout>
  );
}
