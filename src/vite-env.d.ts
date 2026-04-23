/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * Javni URL frontenda (https://…) bez završnog /. Za QR/link javne narudžbenice:
   * ako nije postavljen, koristi se trenutni origin (npr. localhost u dev-u).
   */
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_ELECTRON_BUILD?: string;
  /** Javni bazni URL R2 (custom domena ili *.r2.dev), bez završnog / */
  readonly VITE_R2_PUBLIC_BASE_URL?: string;
}
