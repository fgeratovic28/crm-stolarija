import { useState, useRef } from "react";
import { FileSpreadsheet, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseExcelFile } from "@/lib/excel-import";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ImportExcelButtonProps<T> {
  onImport: (data: T[]) => Promise<void>;
  columnMap: Record<string, keyof T>;
  label?: string;
  variant?: "outline" | "default" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export function ImportExcelButton<T>({
  onImport,
  columnMap,
  label = "Uvezi iz Excel-a",
  variant = "outline",
  size = "sm",
}: ImportExcelButtonProps<T>) {
  const [isImporting, setIsImporting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [importData, setImportData] = useState<T[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const result = await parseExcelFile<T>(file, columnMap);
      setImportData(result.data);
      setImportErrors(result.errors);
      setShowConfirm(true);
    } catch (error) {
      console.error("Excel parse error:", error);
      toast.error("Greška pri čitanju Excel fajla", {
        description: "Proverite format fajla i pokušajte ponovo.",
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleConfirmImport = async () => {
    setIsImporting(true);
    try {
      await onImport(importData);
      toast.success("Podaci uspešno uvezeni", {
        description: `Uvezeno ${importData.length} stavki.`,
      });
      setShowConfirm(false);
    } catch (error: unknown) {
      console.error("Import error:", error);
      const errorMessage = error instanceof Error ? error.message : "Došlo je do greške prilikom čuvanja podataka.";
      toast.error("Greška pri uvozu podataka", {
        description: errorMessage,
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".xlsx, .xls, .csv"
        onChange={handleFileChange}
      />
      <Button
        variant={variant}
        size={size}
        disabled={isImporting}
        onClick={() => fileInputRef.current?.click()}
      >
        {isImporting ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-4 h-4 mr-2" />
        )}
        {label}
      </Button>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="w-full sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Potvrda uvoza</DialogTitle>
            <DialogDescription>
              Pronađeno je {importData.length} stavki za uvoz.
            </DialogDescription>
          </DialogHeader>

          {importErrors.length > 0 && (
            <div className="bg-destructive/10 p-3 rounded-md flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm text-destructive-foreground">
                <p className="font-semibold mb-1">Upozorenja ({importErrors.length}):</p>
                <ul className="list-disc list-inside max-h-32 overflow-y-auto">
                  {importErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {Object.values(columnMap).map((key) => (
                    <th key={String(key)} className="p-2 text-left font-medium">
                      {String(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {importData.slice(0, 5).map((item, i) => (
                  <tr key={i}>
                    {Object.values(columnMap).map((key) => (
                      <td key={String(key)} className="p-2 truncate max-w-[100px]">
                        {String(item[key])}
                      </td>
                    ))}
                  </tr>
                ))}
                {importData.length > 5 && (
                  <tr>
                    <td
                      colSpan={Object.keys(columnMap).length}
                      className="p-2 text-center text-muted-foreground italic"
                    >
                      + još {importData.length - 5} stavki...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>
              Otkaži
            </Button>
            <Button onClick={handleConfirmImport} disabled={isImporting}>
              {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Potvrdi uvoz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
