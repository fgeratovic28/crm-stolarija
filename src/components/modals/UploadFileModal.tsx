import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { Upload, X, FileText, Loader2 } from "lucide-react";
import { useFiles } from "@/hooks/use-files";
import { useAuthStore } from "@/stores/auth-store";
import { useParams } from "react-router-dom";

const uploadSchema = z.object({
  category: z.enum(["offers", "communication", "finance", "supplier", "work_order", "field_photos", "reports"], {
    required_error: "Izaberite kategoriju",
  }),
});

type UploadValues = z.infer<typeof uploadSchema>;

interface UploadFileModalProps {
  trigger?: React.ReactNode;
  jobId?: string;
}

export function UploadFileModal({ trigger, jobId: propJobId }: UploadFileModalProps) {
  const { id: urlJobId } = useParams();
  const jobId = propJobId || urlJobId;
  const [open, setOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useFiles();
  const { user } = useAuthStore();

  const form = useForm<UploadValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { category: undefined },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter(f => f.size <= 20 * 1024 * 1024);
      if (newFiles.length < (e.target.files?.length || 0)) {
        toast.error("Neki fajlovi prelaze 20MB i nisu dodati");
      }
      setSelectedFiles(prev => [...prev, ...newFiles].slice(0, 10));
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: UploadValues) => {
    if (selectedFiles.length === 0) {
      toast.error("Izaberite bar jedan fajl");
      return;
    }

    if (!user) {
      toast.error("Morate biti prijavljeni");
      return;
    }

    try {
      // Upload files one by one
      for (const file of selectedFiles) {
        await uploadFile.mutateAsync({
          jobId,
          category: data.category,
          file,
          uploadedBy: user.id,
        });
      }
      
      form.reset();
      setSelectedFiles([]);
      setOpen(false);
    } catch (err) {
      // Error is handled in the hook
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files).filter(f => f.size <= 20 * 1024 * 1024);
      setSelectedFiles(prev => [...prev, ...newFiles].slice(0, 10));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSelectedFiles([]); form.reset(); } }}>
      <DialogTrigger asChild>
        {trigger || <Button size="sm"><Upload className="w-4 h-4 mr-1" /> Otpremi</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Otpremanje fajlova</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Prevucite fajlove ovde ili kliknite za pretragu</p>
              <p className="text-xs text-muted-foreground mt-1">Maks 20MB po fajlu, do 10 fajlova</p>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            </div>

            {selectedFiles.length > 0 && (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {selectedFiles.map((file, i) => {
                  const isImage = file.type.startsWith("image/");
                  return (
                    <div key={i} className="flex items-center gap-3 bg-muted rounded-lg px-3 py-2">
                      {isImage ? (
                        <div className="w-8 h-8 rounded bg-background flex-shrink-0 overflow-hidden">
                          <img 
                            src={URL.createObjectURL(file)} 
                            alt={file.name} 
                            className="w-full h-full object-cover"
                            onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                          />
                        </div>
                      ) : (
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(i)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Kategorija</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Izaberite kategoriju" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="offers">Ponude</SelectItem>
                    <SelectItem value="communication">Komunikacija</SelectItem>
                    <SelectItem value="finance">Finansije</SelectItem>
                    <SelectItem value="supplier">Dobavljač</SelectItem>
                    <SelectItem value="work_order">Radni nalozi</SelectItem>
                    <SelectItem value="field_photos">Terenske fotografije</SelectItem>
                    <SelectItem value="reports">Izveštaji</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Otkaži</Button>
              <Button type="submit" disabled={selectedFiles.length === 0 || uploadFile.isPending}>
                {uploadFile.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Otpremanje...</>
                ) : (
                  `Otpremi ${selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}`
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
