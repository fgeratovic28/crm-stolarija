import imageCompression from "browser-image-compression";

/** Cilj za terenske / CRM slike (telefoni često šalju 4–12MB po slici). */
const MAX_SIZE_MB = 0.65;
const MAX_WIDTH_OR_HEIGHT_PX = 1600;
const INITIAL_QUALITY = 0.82;

function isProbablyImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name);
}

function extensionFromFile(file: File): string {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()?.trim().toLowerCase() : undefined;
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const sub = file.type?.split("/")[1]?.split("+")[0]?.trim().toLowerCase();
  return sub && /^[a-z0-9]{1,8}$/.test(sub) ? sub : "bin";
}

/**
 * Kompresija slike u browseru pre otpremanja (manja rezolucija + JPEG kvalitet).
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!isProbablyImage(file)) {
    throw new Error("Mogu se otpremiti samo slike");
  }
  return imageCompression(file, {
    maxSizeMB: MAX_SIZE_MB,
    maxWidthOrHeight: MAX_WIDTH_OR_HEIGHT_PX,
    useWebWorker: true,
    initialQuality: INITIAL_QUALITY,
  });
}

/**
 * Dokumenti (PDF itd.) prolaze neizmenjeni; slike se kompresuju, a pri grešci ostaje original.
 */
export async function maybeCompressImageForUpload(file: File): Promise<File> {
  if (!isProbablyImage(file)) {
    return file;
  }
  try {
    return await compressImageForUpload(file);
  } catch (err) {
    console.warn("[compress-image] Kompresija nije uspela, otpremanje originala:", file.name, err);
    return file;
  }
}

export { extensionFromFile };
