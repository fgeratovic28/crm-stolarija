import { useMemo, useState } from "react";
import { Users, Plus, Edit2, Trash2, HeartPulse, Search } from "lucide-react";
import type { Worker, WorkerSickLeave } from "@/types";
import { useWorkers } from "@/hooks/use-workers";
import { useUsers } from "@/hooks/use-users";
import { useRole } from "@/contexts/RoleContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { EmptyState } from "@/components/shared/EmptyState";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ROLE_CONFIG, type UserRole } from "@/types";
import { cn } from "@/lib/utils";

type WorkerFormState = {
  userId: string;
  fullName: string;
  position: string;
  phone: string;
  active: boolean;
  notes: string;
};

type SickLeaveFormState = {
  workerId: string;
  reasons: string[];
  otherReason: string;
  startDate: string;
  endDate: string;
  daysCount: string;
  note: string;
};

const ABSENCE_REASON_OPTIONS = [
  { value: "bolovanje", label: "Bolovanje" },
  { value: "slava", label: "Slava" },
  { value: "odmor", label: "Odmor" },
  { value: "privatni_poslovi", label: "Privatni poslovi" },
  { value: "ostalo", label: "Ostalo" },
] as const;

const emptyWorkerForm: WorkerFormState = {
  userId: "",
  fullName: "",
  position: "",
  phone: "",
  active: true,
  notes: "",
};

const emptySickLeaveForm: SickLeaveFormState = {
  workerId: "",
  reasons: [],
  otherReason: "",
  startDate: "",
  endDate: "",
  daysCount: "",
  note: "",
};

function parseStoredAbsenceReason(reason: string): { reasons: string[]; otherReason: string } {
  const tokens = reason
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const reasons: string[] = [];
  let otherReason = "";
  for (const token of tokens) {
    if (ABSENCE_REASON_OPTIONS.some((opt) => opt.value === token)) {
      reasons.push(token);
      continue;
    }
    if (token.startsWith("ostalo:")) {
      reasons.push("ostalo");
      otherReason = token.replace(/^ostalo:\s*/i, "").trim();
    }
  }
  if (reasons.length === 0) {
    reasons.push("ostalo");
    otherReason = reason;
  }
  return {
    reasons: Array.from(new Set(reasons)),
    otherReason,
  };
}

function formatAbsenceReasonDisplay(reason: string): string {
  const { reasons, otherReason } = parseStoredAbsenceReason(reason);
  const labels = reasons.map((value) => {
    const option = ABSENCE_REASON_OPTIONS.find((opt) => opt.value === value);
    if (!option) return value;
    if (value === "ostalo" && otherReason) return `Ostalo: ${otherReason}`;
    return option.label;
  });
  return labels.join(", ");
}

function toDisplayName(fullName: string | undefined, rawName: string | undefined, email: string | undefined): string {
  const source = (fullName && fullName.trim().length > 0 ? fullName : rawName && rawName.trim().length > 0 ? rawName : email?.split("@")[0] ?? "").trim();
  if (!source) return "Nepoznat korisnik";
  if (source.includes(" ")) return source;

  const parts = source
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return source;
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function looksLikeUsername(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (!v) return true;
  // Username-like: no space and contains digits or lacks separators that usually split first/last name.
  return !v.includes(" ") && /[0-9]/.test(v);
}

function toNullable(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export default function WorkersPage() {
  const { workers, sickLeaves, isLoading, createWorker, updateWorker, deleteWorker, createSickLeave, updateSickLeave, deleteSickLeave } =
    useWorkers();
  const { users } = useUsers();
  const { canPerformAction } = useRole();

  const [query, setQuery] = useState("");
  const [workerFormOpen, setWorkerFormOpen] = useState(false);
  const [sickLeaveFormOpen, setSickLeaveFormOpen] = useState(false);
  const [sickLeaveWorkerSelectOpen, setSickLeaveWorkerSelectOpen] = useState(false);
  const [sickLeaveWorkerSearch, setSickLeaveWorkerSearch] = useState("");
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [editingSickLeave, setEditingSickLeave] = useState<WorkerSickLeave | null>(null);
  const [workerForm, setWorkerForm] = useState<WorkerFormState>(emptyWorkerForm);
  const [sickLeaveForm, setSickLeaveForm] = useState<SickLeaveFormState>(emptySickLeaveForm);
  const [absenceQuery, setAbsenceQuery] = useState("");
  const [absenceWorkerFilter, setAbsenceWorkerFilter] = useState("all");
  const [absenceReasonFilter, setAbsenceReasonFilter] = useState("all");

  const workerMap = useMemo(() => new Map(workers.map((w) => [w.id, w.fullName])), [workers]);
  const userMap = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);

  const filteredWorkers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter((w) =>
      [
        w.fullName,
        w.position ?? "",
        w.phone ?? "",
        w.notes ?? "",
        w.userId ? userMap.get(w.userId)?.email ?? "" : "",
        w.userId ? userMap.get(w.userId)?.name ?? "" : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [workers, query, userMap]);

  const canEditWorkers = canPerformAction("create_worker") || canPerformAction("edit_worker");
  const canManageSickLeaves = canPerformAction("manage_worker_sick_leave");

  const filteredWorkersForSickLeaveSelect = useMemo(() => {
    const q = sickLeaveWorkerSearch.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter((w) =>
      [w.fullName, w.position ?? "", w.phone ?? "", w.notes ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [workers, sickLeaveWorkerSearch]);

  const filteredSickLeaves = useMemo(() => {
    const q = absenceQuery.trim().toLowerCase();
    return sickLeaves.filter((leave) => {
      if (absenceWorkerFilter !== "all" && leave.workerId !== absenceWorkerFilter) return false;
      if (absenceReasonFilter !== "all") {
        const normalizedReason = leave.reason.toLowerCase();
        if (absenceReasonFilter === "ostalo") {
          if (!normalizedReason.includes("ostalo")) return false;
        } else {
          if (!normalizedReason.includes(absenceReasonFilter.toLowerCase())) return false;
        }
      }
      if (!q) return true;
      const workerName = (workerMap.get(leave.workerId) ?? "").toLowerCase();
      const haystack = `${workerName} ${leave.reason} ${leave.note ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [sickLeaves, absenceWorkerFilter, absenceReasonFilter, absenceQuery, workerMap]);

  const openCreateWorker = () => {
    setEditingWorker(null);
    setWorkerForm(emptyWorkerForm);
    setWorkerFormOpen(true);
  };

  const openEditWorker = (worker: Worker) => {
    setEditingWorker(worker);
    setWorkerForm({
      userId: worker.userId ?? "",
      fullName: worker.fullName,
      position: worker.position ?? "",
      phone: worker.phone ?? "",
      active: worker.active,
      notes: worker.notes ?? "",
    });
    setWorkerFormOpen(true);
  };

  const submitWorker = () => {
    const payload = {
      fullName: workerForm.fullName.trim(),
      position: toNullable(workerForm.position),
      phone: toNullable(workerForm.phone),
      active: workerForm.active,
      userId: toNullable(workerForm.userId),
      teamId: null,
      notes: toNullable(workerForm.notes),
    };
    if (!payload.fullName) return;

    if (editingWorker) {
      updateWorker.mutate({ id: editingWorker.id, ...payload }, { onSuccess: () => setWorkerFormOpen(false) });
    } else {
      createWorker.mutate(payload, { onSuccess: () => setWorkerFormOpen(false) });
    }
  };

  const openCreateSickLeave = () => {
    setEditingSickLeave(null);
    setSickLeaveForm(emptySickLeaveForm);
    setSickLeaveWorkerSearch("");
    setSickLeaveWorkerSelectOpen(false);
    setSickLeaveFormOpen(true);
  };

  const openEditSickLeave = (leave: WorkerSickLeave) => {
    const parsedReason = parseStoredAbsenceReason(leave.reason);
    setEditingSickLeave(leave);
    setSickLeaveForm({
      workerId: leave.workerId,
      reasons: parsedReason.reasons,
      otherReason: parsedReason.otherReason,
      startDate: leave.startDate ?? "",
      endDate: leave.endDate ?? "",
      daysCount: leave.daysCount ? String(leave.daysCount) : "",
      note: leave.note ?? "",
    });
    setSickLeaveWorkerSearch("");
    setSickLeaveWorkerSelectOpen(false);
    setSickLeaveFormOpen(true);
  };

  const submitSickLeave = () => {
    const reasons = Array.from(new Set(sickLeaveForm.reasons));
    const includeOther = reasons.includes("ostalo");
    const otherText = sickLeaveForm.otherReason.trim();
    if (reasons.length === 0) return;
    if (includeOther && !otherText) return;
    const reasonText = reasons
      .map((reason) => (reason === "ostalo" ? `ostalo: ${otherText}` : reason))
      .join(", ");
    const payload = {
      workerId: sickLeaveForm.workerId,
      reason: reasonText,
      startDate: toNullable(sickLeaveForm.startDate),
      endDate: toNullable(sickLeaveForm.endDate),
      daysCount: sickLeaveForm.daysCount ? Number(sickLeaveForm.daysCount) : null,
      note: toNullable(sickLeaveForm.note),
    };
    if (!payload.workerId) return;
    if (!payload.daysCount && !(payload.startDate && payload.endDate)) return;

    if (editingSickLeave) {
      updateSickLeave.mutate({ id: editingSickLeave.id, ...payload }, { onSuccess: () => setSickLeaveFormOpen(false) });
    } else {
      createSickLeave.mutate(payload, { onSuccess: () => setSickLeaveFormOpen(false) });
    }
  };

  return (
    <AppLayout title="Radnici">
      <PageTransition>
        <Breadcrumbs items={[{ label: "Radnici" }]} />
        <PageHeader
          title="Radnici"
          description="Evidencija radnika i bolovanja sa brzim pregledom statusa."
          icon={Users}
          actions={
            canEditWorkers && (
              <Button onClick={openCreateWorker}>
                <Plus className="w-4 h-4 mr-1.5" />
                Novi radnik
              </Button>
            )
          }
        />

        <div className="mb-6 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Pretraga radnika..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : filteredWorkers.length === 0 ? (
          <EmptyState icon={Users} title="Nema radnika" description="Dodajte prvog radnika u evidenciju." onAction={canEditWorkers ? openCreateWorker : undefined} actionLabel={canEditWorkers ? "Dodaj radnika" : undefined} />
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ime i prezime</TableHead>
                  <TableHead>Pozicija</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Korisnik/Uloga</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[1%]">Akcije</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWorkers.map((worker) => (
                  <TableRow key={worker.id}>
                    <TableCell className="font-medium">{worker.fullName}</TableCell>
                    <TableCell>{worker.position || "-"}</TableCell>
                    <TableCell>{worker.phone || "-"}</TableCell>
                    <TableCell>
                      {worker.userId && userMap.get(worker.userId)
                        ? `${toDisplayName(
                            userMap.get(worker.userId)?.fullName,
                            userMap.get(worker.userId)?.name,
                            userMap.get(worker.userId)?.email,
                          )} / ${
                            ROLE_CONFIG[(userMap.get(worker.userId)?.role ?? "office") as UserRole]?.label ?? "-"
                          }`
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <GenericBadge label={worker.active ? "Aktivan" : "Neaktivan"} variant={worker.active ? "success" : "muted"} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {canPerformAction("edit_worker") && (
                          <Button size="sm" variant="ghost" onClick={() => openEditWorker(worker)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                        {canPerformAction("delete_worker") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              if (confirm(`Obrisati radnika "${worker.fullName}"?`)) {
                                deleteWorker.mutate(worker.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm">Odsustva radnika</h2>
              <p className="text-xs text-muted-foreground mt-1">Razlog, trajanje (od-do ili broj dana) i napomena.</p>
            </div>
            {canManageSickLeaves && (
              <Button onClick={openCreateSickLeave}>
                <HeartPulse className="w-4 h-4 mr-1.5" />
                Novo odsustvo
              </Button>
            )}
          </div>
          <div className="p-4 sm:p-5 border-b border-border grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Pretraga</Label>
              <Input
                placeholder="Radnik, razlog ili napomena..."
                value={absenceQuery}
                onChange={(e) => setAbsenceQuery(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Radnik</Label>
              <Select value={absenceWorkerFilter} onValueChange={setAbsenceWorkerFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Svi radnici" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Svi radnici</SelectItem>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Razlog</Label>
              <Select value={absenceReasonFilter} onValueChange={setAbsenceReasonFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Svi razlozi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Svi razlozi</SelectItem>
                  {ABSENCE_REASON_OPTIONS.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Radnik</TableHead>
                <TableHead>Razlog</TableHead>
                <TableHead>Trajanje</TableHead>
                <TableHead>Dana</TableHead>
                <TableHead>Napomena</TableHead>
                <TableHead className="w-[1%]">Akcije</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSickLeaves.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nema unosa odsustva.
                  </TableCell>
                </TableRow>
              ) : (
                filteredSickLeaves.map((leave) => (
                  <TableRow key={leave.id}>
                    <TableCell>{workerMap.get(leave.workerId) ?? "-"}</TableCell>
                    <TableCell>{formatAbsenceReasonDisplay(leave.reason)}</TableCell>
                    <TableCell>{leave.startDate && leave.endDate ? `${leave.startDate} - ${leave.endDate}` : "-"}</TableCell>
                    <TableCell>{leave.daysCount ?? "-"}</TableCell>
                    <TableCell className="max-w-xs truncate">{leave.note || "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {canManageSickLeaves && (
                          <Button size="sm" variant="ghost" onClick={() => openEditSickLeave(leave)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                        {canManageSickLeaves && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              if (confirm("Obrisati bolovanje?")) deleteSickLeave.mutate(leave.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <Dialog open={workerFormOpen} onOpenChange={setWorkerFormOpen}>
          <DialogContent className="w-full sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingWorker ? "Izmena radnika" : "Novi radnik"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Povezani korisnik (opciono)</Label>
                <Select
                  value={workerForm.userId || "none"}
                  onValueChange={(v) => {
                    if (v === "none") {
                      setWorkerForm((s) => ({ ...s, userId: "" }));
                      return;
                    }
                    const selectedUser = userMap.get(v);
                    setWorkerForm((s) => ({
                      ...s,
                      userId: v,
                      fullName:
                        s.fullName ||
                        (selectedUser?.fullName && selectedUser.fullName.trim().length > 0
                          ? selectedUser.fullName.trim()
                          : looksLikeUsername(selectedUser?.name)
                            ? ""
                            : toDisplayName(selectedUser?.fullName, selectedUser?.name, selectedUser?.email)),
                      position:
                        s.position ||
                        (selectedUser?.role
                          ? (ROLE_CONFIG[selectedUser.role as UserRole]?.label ?? selectedUser.role)
                          : ""),
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Izaberi korisnika" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nije povezano</SelectItem>
                    {(users ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {toDisplayName(u.fullName, u.name, u.email)} ({u.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ime i prezime</Label>
                <Input
                  value={workerForm.fullName}
                  placeholder="Unesite ime i prezime"
                  onChange={(e) => setWorkerForm((s) => ({ ...s, fullName: e.target.value }))}
                />
              </div>
              <div>
                <Label>Pozicija</Label>
                <Input value={workerForm.position} onChange={(e) => setWorkerForm((s) => ({ ...s, position: e.target.value }))} />
              </div>
              <div>
                <Label>Telefon</Label>
                <Input value={workerForm.phone} onChange={(e) => setWorkerForm((s) => ({ ...s, phone: e.target.value }))} />
              </div>
              <div>
                <Label>Napomena</Label>
                <Textarea value={workerForm.notes} onChange={(e) => setWorkerForm((s) => ({ ...s, notes: e.target.value }))} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <span className="text-sm">Aktivan</span>
                <Switch checked={workerForm.active} onCheckedChange={(checked) => setWorkerForm((s) => ({ ...s, active: checked }))} />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
                <Button variant="outline" onClick={() => setWorkerFormOpen(false)}>
                  Otkaži
                </Button>
                <Button onClick={submitWorker}>Sačuvaj</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={sickLeaveFormOpen} onOpenChange={setSickLeaveFormOpen}>
          <DialogContent className="w-full sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingSickLeave ? "Izmena odsustva" : "Novo odsustvo"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Radnik</Label>
                <Popover open={sickLeaveWorkerSelectOpen} onOpenChange={setSickLeaveWorkerSelectOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between">
                      <span className="truncate text-left">
                        {workers.find((w) => w.id === sickLeaveForm.workerId)?.fullName ?? "Izaberite radnika"}
                      </span>
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
                    <Command>
                      <CommandInput
                        placeholder="Pretraži radnika..."
                        value={sickLeaveWorkerSearch}
                        onValueChange={setSickLeaveWorkerSearch}
                      />
                      <CommandList>
                        <CommandEmpty>Nema rezultata.</CommandEmpty>
                        <CommandGroup>
                          {filteredWorkersForSickLeaveSelect.map((w) => (
                            <CommandItem
                              key={w.id}
                              value={`${w.fullName} ${w.position ?? ""} ${w.phone ?? ""}`}
                              onSelect={() => {
                                setSickLeaveForm((s) => ({ ...s, workerId: w.id }));
                                setSickLeaveWorkerSelectOpen(false);
                              }}
                            >
                              <span className={cn("mr-2 h-2 w-2 rounded-full", sickLeaveForm.workerId === w.id ? "bg-primary" : "bg-transparent")} />
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate">{w.fullName}</span>
                                <span className="truncate text-xs text-muted-foreground">{w.position || "—"} · {w.phone || "—"}</span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Razlog</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border border-border p-3">
                  {ABSENCE_REASON_OPTIONS.map((reason) => {
                    const checked = sickLeaveForm.reasons.includes(reason.value);
                    return (
                      <label key={reason.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => {
                            setSickLeaveForm((s) => {
                              const nextReasons = value
                                ? [...s.reasons, reason.value]
                                : s.reasons.filter((r) => r !== reason.value);
                              return { ...s, reasons: Array.from(new Set(nextReasons)) };
                            });
                          }}
                        />
                        {reason.label}
                      </label>
                    );
                  })}
                </div>
              </div>
              {sickLeaveForm.reasons.includes("ostalo") && (
                <div>
                  <Label>Ostalo (upišite razlog)</Label>
                  <Input
                    value={sickLeaveForm.otherReason}
                    onChange={(e) => setSickLeaveForm((s) => ({ ...s, otherReason: e.target.value }))}
                    placeholder="Npr. porodične obaveze..."
                  />
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label>Od</Label>
                  <Input type="date" value={sickLeaveForm.startDate} onChange={(e) => setSickLeaveForm((s) => ({ ...s, startDate: e.target.value }))} />
                </div>
                <div>
                  <Label>Do</Label>
                  <Input type="date" value={sickLeaveForm.endDate} onChange={(e) => setSickLeaveForm((s) => ({ ...s, endDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Broj dana (alternativa)</Label>
                <Input type="number" min={1} value={sickLeaveForm.daysCount} onChange={(e) => setSickLeaveForm((s) => ({ ...s, daysCount: e.target.value }))} />
              </div>
              <div>
                <Label>Napomena</Label>
                <Textarea value={sickLeaveForm.note} onChange={(e) => setSickLeaveForm((s) => ({ ...s, note: e.target.value }))} />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
                <Button variant="outline" onClick={() => setSickLeaveFormOpen(false)}>
                  Otkaži
                </Button>
                <Button onClick={submitSickLeave}>Sačuvaj</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </PageTransition>
    </AppLayout>
  );
}
