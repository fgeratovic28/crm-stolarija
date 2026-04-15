import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { Plus, Loader2, Paperclip, X } from "lucide-react";
import { useActivities } from "@/hooks/use-activities";
import { useFiles } from "@/hooks/use-files";
import { useAuthStore } from "@/stores/auth-store";
import { useParams } from "react-router-dom";

const activitySchema = z.object({
  type: z.enum(["email", "phone", "in_person", "viber", "other"], { required_error: "Izaberite tip" }),
  description: z.string().trim().min(1, "Opis je obavezan").max(1000, "Najviše 1000 karaktera"),
});

type ActivityValues = z.infer<typeof activitySchema>;

interface AddActivityModalProps {
  trigger?: React.ReactNode;
  jobId?: string;
}

export function AddActivityModal({ trigger, jobId: propJobId }: AddActivityModalProps) {
  const { id: urlJobId } = useParams();
  const jobId = propJobId || urlJobId;
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuthStore();
  const { addActivity } = useActivities();
  const { uploadFile } = useFiles();

  const form = useForm<ActivityValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: { type: undefined, description: "" },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      if (file.size > 20 * 1024 * 1024) {
        toast.error("Fajl je prevelik (maks 20MB)");
        return;
      }
      setSelectedFile(file);
    }
  };

  const onSubmit = async (data: ActivityValues) => {
    if (!jobId || !user) {
      toast.error("Nedostaju podaci za kreiranje aktivnosti");
      return;
    }

    try {
      let fileId: string | undefined;

      // 1. If there's a file, upload it first
      if (selectedFile) {
        const uploadedFile = await uploadFile.mutateAsync({
          jobId,
          category: "communication",
          file: selectedFile,
          uploadedBy: user.id,
        });
        fileId = uploadedFile.id;
      }

      // 2. Add activity with fileId
      addActivity.mutate({
        jobId,
        type: data.type,
        description: data.description,
        authorId: user.id,
        fileId,
      }, {
        onSuccess: () => {
          form.reset();
          setSelectedFile(null);
          setOpen(false);
        }
      });
    } catch (err) {
      // Error handled in hooks
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Dodaj aktivnost</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dodavanje aktivnosti</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="type" render={({ field }) => (
              <FormItem>
                <FormLabel>Tip komunikacije</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Izaberite tip" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Telefon</SelectItem>
                    <SelectItem value="in_person">Lično</SelectItem>
                    <SelectItem value="viber">Viber</SelectItem>
                    <SelectItem value="other">Ostalo</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Opis / Napomene</FormLabel>
                <FormControl><Textarea placeholder="Šta je razgovarano ili komunicirano..." rows={4} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="space-y-2">
              <FormLabel>Prilog (opciono)</FormLabel>
              <div className="flex items-center gap-2">
                <input 
                  type="file" 
                  className="hidden" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                />
                {!selectedFile ? (
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="w-4 h-4 mr-1.5" /> Priloži fajl
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 bg-muted rounded-lg px-2 py-1.5 flex-1 min-w-0">
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate flex-1">{selectedFile.name}</span>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6" 
                      onClick={() => setSelectedFile(null)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Otkaži</Button>
              <Button type="submit" disabled={addActivity.isPending || uploadFile.isPending}>
                {addActivity.isPending || uploadFile.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sačuvaj...</>
                ) : (
                  "Dodaj aktivnost"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
