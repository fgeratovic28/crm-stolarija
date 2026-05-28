/** Android — za file input u terenskim izveštajima (kamera podrazumevano). */
export function isAndroidForFieldReportPhoto(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}
