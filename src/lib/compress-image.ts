import imageCompression from "browser-image-compression";

/** Stability baseline: fiksne granice kao u zahtevu. */
const MAX_SIZE_MB = 1;
const MAX_WIDTH_OR_HEIGHT_PX = 1920;

/**
 * Kompresija slike u browseru pre otpremanja (max 1MB, max širina/visina 1920px).
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Mogu se otpremiti samo slike");
  }
  return imageCompression(file, {
    maxSizeMB: MAX_SIZE_MB,
    maxWidthOrHeight: MAX_WIDTH_OR_HEIGHT_PX,
    useWebWorker: true,
  });
}
