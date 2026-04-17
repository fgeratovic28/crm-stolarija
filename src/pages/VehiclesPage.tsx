import { useMemo, useState, type ComponentProps } from "react";
import { Truck, Plus, Search, Eye, Edit2, Trash2, RotateCcw } from "lucide-react";
import type { Vehicle, VehicleStatus } from "@/types";
import { VEHICLE_STATUS_CONFIG } from "@/types";
import { useVehicles } from "@/hooks/use-vehicles";
import { useUsers } from "@/hooks/use-users";
import { useRole } from "@/contexts/RoleContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { VehicleForm, type VehicleFormValues } from "@/components/shared/VehicleForm";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";

type VehiclesStatusFilter = "all" | VehicleStatus;

function normalizeOptionalDb(value: string | undefined | null): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 ? v : null;
}

function formatVehicleField(value: string | undefined | null): string {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 ? v : "-";
}

function formatKilometers(value: number | null | undefined): string {
  if (typeof value !== "number") return "-";
  return `${value.toLocaleString("sr-RS")} km`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("sr-RS");
}

export default function VehiclesPage() {
  const { vehicles, isLoading, createVehicle, updateVehicle, deleteVehicle, setVehicleArchived } = useVehicles();
  const { users } = useUsers();
  const { canPerformAction } = useRole();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<VehiclesStatusFilter>("all");

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  const workers = useMemo(
    () => (users ?? []).filter((u) => u.active && (u.role === "production" || u.role === "montaza" || u.role === "teren")),
    [users],
  );

  const workerMap = useMemo(() => new Map(workers.map((w) => [w.id, w.name])), [workers]);

  const statusOptions: { value: VehiclesStatusFilter; label: string }[] = [
    { value: "all", label: "Svi statusi" },
    { value: "active", label: "Aktivna" },
    { value: "in_service", label: "U servisu" },
    { value: "archived", label: "Arhivirana" },
  ];

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return (vehicles ?? []).filter((v) => {
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (!q) return true;

      const assigned = v.assignedWorkerId ? workerMap.get(v.assignedWorkerId) ?? "" : "";
      const haystack = [
        v.vehicleName,
        v.registrationNumber ?? "",
        v.brandModel ?? "",
        v.generalNotes ?? "",
        v.serviceNotes ?? "",
        v.registrationDate ?? "",
        v.expirationDate ?? "",
        v.lastServiceDate ?? "",
        typeof v.serviceKilometers === "number" ? String(v.serviceKilometers) : "",
        assigned,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [vehicles, searchTerm, statusFilter, workerMap]);

  const openCreate = () => {
    setEditingVehicle(null);
    setIsFormOpen(true);
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setIsFormOpen(true);
  };

  const openDetails = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setIsDetailsOpen(true);
  };

  const handleSubmit = (data: VehicleFormValues) => {
    const payload = {
      vehicleName: data.vehicleName,
      registrationNumber: normalizeOptionalDb(data.registrationNumber),
      brandModel: normalizeOptionalDb(data.brandModel),
      status: data.status,
      registrationDate: normalizeOptionalDb(data.registrationDate),
      expirationDate: normalizeOptionalDb(data.expirationDate),
      serviceNotes: normalizeOptionalDb(data.serviceNotes),
      serviceKilometers: typeof data.serviceKilometers === "number" ? data.serviceKilometers : null,
      assignedWorkerId: normalizeOptionalDb(data.assignedWorkerId),
      generalNotes: normalizeOptionalDb(data.generalNotes),
      lastServiceDate: normalizeOptionalDb(data.lastServiceDate),
      trafficPermitImageUrl: normalizeOptionalDb(data.trafficPermitImageUrl),
      insuranceImageUrl: normalizeOptionalDb(data.insuranceImageUrl),
      serviceRecordImageUrl: normalizeOptionalDb(data.serviceRecordImageUrl),
      additionalImageUrls: data.additionalImageUrls ?? [],
    };

    if (editingVehicle) {
      updateVehicle.mutate({ id: editingVehicle.id, ...payload }, { onSuccess: () => setIsFormOpen(false) });
    } else {
      createVehicle.mutate(payload, { onSuccess: () => setIsFormOpen(false) });
    }
  };

  const handleDelete = (vehicle: Vehicle) => {
    const ok = confirm(`Da li ste sigurni da želite da obrišete vozilo "${vehicle.vehicleName}"?`);
    if (!ok) return;
    deleteVehicle.mutate(vehicle.id);
  };

  const toggleArchived = (vehicle: Vehicle) => {
    const targetArchived = vehicle.status !== "archived";
    setVehicleArchived.mutate(
      { id: vehicle.id, archived: targetArchived },
      { onSuccess: () => void 0 },
    );
  };

  const detailsWorkerName = selectedVehicle?.assignedWorkerId ? workerMap.get(selectedVehicle.assignedWorkerId) : undefined;

  return (
    <AppLayout title="Vozila">
      <PageTransition>
        <Breadcrumbs items={[{ label: "Nabavka", href: "/material-orders" }, { label: "Vozila" }]} />
        <PageHeader
          title="Vozila"
          description="Upravljanje voznim parkom: registracija, servis, zaduženi radnik."
          icon={Truck}
          actions={
            canPerformAction("create_vehicle") && (
              <div className="flex gap-2">
                <Button onClick={openCreate}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  Novo vozilo
                </Button>
              </div>
            )
          }
        />

        <div className="mb-6 flex flex-col md:flex-row md:items-end gap-4">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Pretraži vozila..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="max-w-sm w-full">
            <Select value={statusFilter} onValueChange={(v: VehiclesStatusFilter) => setStatusFilter(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter statusa" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton rows={6} cols={10} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Nema vozila"
            description="Nema vozila koja odgovaraju unetim filterima. Dodajte novo vozilo ili proširite pretragu."
            actionLabel={canPerformAction("create_vehicle") ? "Dodaj vozilo" : undefined}
            onAction={canPerformAction("create_vehicle") ? openCreate : undefined}
          />
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vozilo</TableHead>
                  <TableHead>Registracija</TableHead>
                  <TableHead>Marka/Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Datum reg.</TableHead>
                  <TableHead>Ističe</TableHead>
                  <TableHead>Zaduženi</TableHead>
                  <TableHead>Datum servisa</TableHead>
                  <TableHead>Servis na (km)</TableHead>
                  <TableHead className="w-[1%]">Akcije</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filtered.map((v) => {
                  const statusCfg = VEHICLE_STATUS_CONFIG[v.status];
                  const assignedName = v.assignedWorkerId ? workerMap.get(v.assignedWorkerId) : undefined;
                  const isArchived = v.status === "archived";

                  return (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.vehicleName}</TableCell>
                      <TableCell>{formatVehicleField(v.registrationNumber)}</TableCell>
                      <TableCell>{formatVehicleField(v.brandModel)}</TableCell>
                      <TableCell>
                        <GenericBadge label={statusCfg.label} variant={statusCfg.variant} />
                      </TableCell>
                      <TableCell>{formatVehicleField(v.registrationDate)}</TableCell>
                      <TableCell>{formatVehicleField(v.expirationDate)}</TableCell>
                      <TableCell>{formatVehicleField(assignedName)}</TableCell>
                      <TableCell>{formatVehicleField(v.lastServiceDate)}</TableCell>
                      <TableCell>{formatKilometers(v.serviceKilometers)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => openDetails(v)} title="Pregled">
                            <Eye className="w-4 h-4" />
                          </Button>

                          {canPerformAction("edit_vehicle") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(v)}
                              title="Izmena"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          )}

                          {canPerformAction("archive_vehicle") && (
                            <Button
                              variant={isArchived ? "outline" : "ghost"}
                              size="sm"
                              onClick={() => toggleArchived(v)}
                              title={isArchived ? "Vrati iz arhive" : "Arhiviraj"}
                            >
                              {isArchived ? <RotateCcw className="w-4 h-4" /> : <ArchiveIcon className="w-4 h-4" />}
                            </Button>
                          )}

                          {canPerformAction("delete_vehicle") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleDelete(v)}
                              title="Obriši"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogContent className="w-full sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{editingVehicle ? "Izmena vozila" : "Novo vozilo"}</DialogTitle>
            </DialogHeader>
            <VehicleForm
              initialData={editingVehicle ?? undefined}
              workers={workers.map((w) => ({ id: w.id, name: w.name }))}
              onSubmit={handleSubmit}
              onCancel={() => setIsFormOpen(false)}
              isLoading={createVehicle.isPending || updateVehicle.isPending}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
          <DialogContent className="w-full sm:max-w-3xl">
            {selectedVehicle && (
              <>
                <DialogHeader>
                  <DialogTitle>Detalji vozila</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-1">
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold">{selectedVehicle.vehicleName}</h2>
                        <p className="text-sm text-muted-foreground">{selectedVehicle.brandModel || "Marka/model nije unet"}</p>
                      </div>
                      <GenericBadge
                        label={VEHICLE_STATUS_CONFIG[selectedVehicle.status].label}
                        variant={VEHICLE_STATUS_CONFIG[selectedVehicle.status].variant}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Osnovni podaci</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <DetailField label="Registracija" value={formatVehicleField(selectedVehicle.registrationNumber)} />
                      <DetailField label="Zaduženi" value={formatVehicleField(detailsWorkerName)} />
                      <DetailField label="Datum registracije" value={formatVehicleField(selectedVehicle.registrationDate)} />
                      <DetailField label="Istek registracije" value={formatVehicleField(selectedVehicle.expirationDate)} />
                      <DetailField label="Datum zadnjeg servisa" value={formatVehicleField(selectedVehicle.lastServiceDate)} />
                      <DetailField label="Servis na (km)" value={formatKilometers(selectedVehicle.serviceKilometers)} />
                    </div>
                  </div>

                  <details className="rounded-xl border border-border bg-card p-4 group">
                    <summary className="cursor-pointer list-none flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</span>
                      <span className="text-xs text-primary group-open:hidden">Prikaži</span>
                      <span className="text-xs text-primary hidden group-open:inline">Sakrij</span>
                    </summary>
                    <div className="space-y-3 mt-3">
                      <TimelineItem label="Kreirano" value={formatDateTime(selectedVehicle.createdAt)} />
                      <TimelineItem label="Poslednja izmena" value={formatDateTime(selectedVehicle.updatedAt || selectedVehicle.createdAt)} />
                      <TimelineItem label="Poslednji servis" value={formatVehicleField(selectedVehicle.lastServiceDate)} />
                    </div>
                  </details>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Servis napomena</p>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap min-h-16">
                        {selectedVehicle.serviceNotes || "Nema napomene"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Opšta napomena</p>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap min-h-16">
                        {selectedVehicle.generalNotes || "Nema napomene"}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dokumenta i slike</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <VehicleImageTile title="Saobraćajna" url={selectedVehicle.trafficPermitImageUrl} />
                      <VehicleImageTile title="Osiguranje" url={selectedVehicle.insuranceImageUrl} />
                      <VehicleImageTile title="Servisna evidencija" url={selectedVehicle.serviceRecordImageUrl} />
                    </div>
                    {selectedVehicle.additionalImageUrls && selectedVehicle.additionalImageUrls.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Dodatne slike</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {selectedVehicle.additionalImageUrls.map((url, idx) => (
                            <a
                              key={url + idx}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="relative aspect-square rounded-md overflow-hidden border border-border hover:border-primary transition-colors"
                              title={`Dodatna slika ${idx + 1}`}
                            >
                              <img src={url} alt={`Dodatna slika ${idx + 1}`} className="w-full h-full object-cover" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-border">
                    <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
                      Zatvori
                    </Button>

                    {canPerformAction("archive_vehicle") && (
                      <Button
                        variant={selectedVehicle.status === "archived" ? "outline" : "destructive"}
                        onClick={() => toggleArchived(selectedVehicle)}
                      >
                        {selectedVehicle.status === "archived" ? (
                          <>
                            <RotateCcw className="w-4 h-4 mr-1.5" />
                            Vrati
                          </>
                        ) : (
                          "Arhiviraj"
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </PageTransition>
    </AppLayout>
  );
}

function ArchiveIcon(props: ComponentProps<"svg">) {
  // Small inline icon to avoid additional lucide import.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="3 6 21 6 21 21 3 21 3 6" />
      <path d="M8 12h8" />
    </svg>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-1">{value}</p>
    </div>
  );
}

function TimelineItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border border-border rounded-lg px-3 py-2 bg-muted/20">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function VehicleImageTile({ title, url }: { title: string; url?: string | null }) {
  if (!url) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground mb-2">{title}</p>
        <div className="aspect-[4/3] rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
          Nema slike
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground mb-2">{title}</p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block aspect-[4/3] rounded overflow-hidden border border-border hover:border-primary transition-colors"
      >
        <img src={url} alt={title} className="w-full h-full object-cover" />
      </a>
    </div>
  );
}

