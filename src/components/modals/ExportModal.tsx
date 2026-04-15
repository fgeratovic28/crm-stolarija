import { useState, useMemo } from "react";
import { format } from "date-fns";
import { CalendarIcon, Download, FileText, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { JOB_STATUS_CONFIG, type JobStatus, type Job } from "@/types";
import { exportFinancesCSV, exportFinancesPDF } from "@/lib/export";
import { useJobs } from "@/hooks/use-jobs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportModal({ open, onOpenChange }: ExportModalProps) {
  const { jobs: jobsData, isLoading: jobsLoading, error: jobsError, refetch } = useJobs();
  const jobsList = useMemo(() => jobsData ?? [], [jobsData]);

  const [status, setStatus] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const customers = useMemo(() => {
    const unique = new Map<string, string>();
    jobsList.forEach(j => unique.set(j.customer.id, j.customer.fullName));
    return Array.from(unique, ([id, name]) => ({ id, name }));
  }, [jobsList]);

  const filteredJobs = useMemo(() => {
    return jobsList.filter((j: Job) => {
      if (status !== "all" && j.status !== status) return false;
      if (customer !== "all" && j.customer.id !== customer) return false;
      if (dateFrom && new Date(j.createdAt) < dateFrom) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (new Date(j.createdAt) > end) return false;
      }
      return true;
    });
  }, [jobsList, status, customer, dateFrom, dateTo]);

  const handleExport = (type: "csv" | "pdf") => {
    if (type === "csv") exportFinancesCSV(filteredJobs);
    else exportFinancesPDF(filteredJobs);
    onOpenChange(false);
  };

  const resetFilters = () => {
    setStatus("all");
    setCustomer("all");
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Izvoz finansijskog izveštaja</DialogTitle>
        </DialogHeader>

        {jobsError && (
          <Alert variant="destructive">
            <AlertTitle>Učitavanje poslova nije uspelo</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{jobsError instanceof Error ? jobsError.message : "Nepoznata greška"}</span>
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => refetch()}>
                Pokušaj ponovo
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {jobsLoading && !jobsError && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Učitavanje poslova…
          </div>
        )}

        <div className={cn("space-y-4 py-2", (jobsLoading && !jobsError) || jobsError ? "pointer-events-none opacity-50" : "")}>
          {/* Status filter */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Status posla</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi statusi</SelectItem>
                {Object.entries(JOB_STATUS_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Customer filter */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Kupac</Label>
            <Select value={customer} onValueChange={setCustomer}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi kupci</SelectItem>
                {customers.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Datum od</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    {dateFrom ? format(dateFrom, "dd.MM.yyyy") : "Izaberi"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Datum do</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    {dateTo ? format(dateTo, "dd.MM.yyyy") : "Izaberi"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm text-muted-foreground flex justify-between items-center">
            <span>Pronađeno poslova: <strong className="text-foreground">{filteredJobs.length}</strong></span>
            {(status !== "all" || customer !== "all" || dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetFilters}>Poništi filtere</Button>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => handleExport("csv")}
            disabled={jobsLoading || !!jobsError || filteredJobs.length === 0}
          >
            <Download className="w-4 h-4 mr-1.5" />CSV izvoz
          </Button>
          <Button
            className="flex-1"
            onClick={() => handleExport("pdf")}
            disabled={jobsLoading || !!jobsError || filteredJobs.length === 0}
          >
            <FileText className="w-4 h-4 mr-1.5" />PDF izvoz
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
