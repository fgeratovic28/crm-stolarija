import { useRef } from "react";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAndroidForFieldReportPhoto } from "@/lib/field-report-photo-input";

type FieldReportPhotoAddTileProps = {
  uploading: boolean;
  disabled?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
};

function handleFileChange(
  e: React.ChangeEvent<HTMLInputElement>,
  onChange: FieldReportPhotoAddTileProps["onChange"],
) {
  onChange(e);
  e.target.value = "";
}

/**
 * Dodavanje slika u terenskim izveštajima.
 * Android: podrazumevano kamera (`capture`); „Iz galerije“ kao rezerva.
 */
export function FieldReportPhotoAddTile({ uploading, disabled, onChange, className }: FieldReportPhotoAddTileProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const android = isAndroidForFieldReportPhoto();

  const tileClass = cn(
    "aspect-square flex flex-col items-center justify-center border-2 border-dashed border-border rounded-md transition-colors",
    disabled || uploading ? "opacity-60 pointer-events-none" : "cursor-pointer hover:bg-muted/50",
    className,
  );

  if (!android) {
    return (
      <label className={tileClass}>
        {uploading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <Plus className="w-5 h-5 text-muted-foreground" />
        )}
        <input
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFileChange(e, onChange)}
          disabled={disabled || uploading}
        />
      </label>
    );
  }

  return (
    <>
      <button
        type="button"
        className={tileClass}
        disabled={disabled || uploading}
        onClick={() => cameraInputRef.current?.click()}
        aria-label="Dodaj fotografiju kamerom"
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <Plus className="w-5 h-5 text-muted-foreground" />
            <span className="mt-1 text-[10px] font-medium text-muted-foreground">Kamera</span>
          </>
        )}
      </button>
      <input
        ref={cameraInputRef}
        type="file"
        multiple
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFileChange(e, onChange)}
        disabled={disabled || uploading}
      />
      <input
        ref={galleryInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileChange(e, onChange)}
        disabled={disabled || uploading}
      />
      <div className="col-span-full flex justify-center py-0.5">
        <button
          type="button"
          className="text-xs text-primary font-medium underline-offset-2 hover:underline disabled:opacity-50"
          disabled={disabled || uploading}
          onClick={() => galleryInputRef.current?.click()}
        >
          Dodaj iz galerije
        </button>
      </div>
    </>
  );
}
