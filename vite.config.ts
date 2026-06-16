import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Connect, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "url";
import { parseBearerFromAuthorizationHeader } from "./lib/bearer-auth";
import {
  fetchImageBytesFromUpstream,
  isProxyableR2ImageUrl,
  pickR2PublicBaseUrl,
} from "./lib/image-proxy-for-r2";
import {
  isSendMultipleQuotesPayload,
  runSendMultipleQuotesEmailHandler,
} from "./lib/send-multiple-quotes-email-handler";
import {
  isSendMaterialOrderEmailPayload,
  runSendMaterialOrderEmailHandler,
} from "./lib/send-material-order-email-handler";
import { handleInboundEmailWebhook } from "./lib/inbound-email-handler";
import { handleInboundProcurementEmailWebhook } from "./lib/inbound-procurement-email-handler";
import { geocodeAddressOnServer } from "./lib/geocode-address-server";
import compression from "vite-plugin-compression";
import { VitePWA } from "vite-plugin-pwa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function attachSendMaterialOrderEmailMiddleware(
  middlewares: Connect.Server,
  mode: string,
  envDir: string,
): void {
  const loaded = loadEnv(mode, envDir, "");
  for (const [k, v] of Object.entries(loaded)) {
    if (process.env[k] === undefined && typeof v === "string") process.env[k] = v;
  }

  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    if (pathname !== "/api/material-orders/send-email") {
      next();
      return;
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Method not allowed." }));
      return;
    }
    try {
      const body = await readJsonBody(req as IncomingMessage);
      const auth = req.headers.authorization;
      const bearer = parseBearerFromAuthorizationHeader(typeof auth === "string" ? auth : undefined);
      if (!bearer) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Missing bearer token." }));
        return;
      }
      if (!isSendMaterialOrderEmailPayload(body)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Invalid payload." }));
        return;
      }
      const result = await runSendMaterialOrderEmailHandler(body, bearer);
      res.statusCode = result.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : "Unexpected server error.",
        }),
      );
    }
  });
}

function attachSendMultipleQuotesMiddleware(
  middlewares: Connect.Server,
  mode: string,
  envDir: string,
): void {
  const loaded = loadEnv(mode, envDir, "");
  for (const [k, v] of Object.entries(loaded)) {
    if (process.env[k] === undefined && typeof v === "string") process.env[k] = v;
  }

  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    if (pathname !== "/api/quotes/send-multiple") {
      next();
      return;
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Method not allowed." }));
      return;
    }
    try {
      const body = await readJsonBody(req as IncomingMessage);
      const auth = req.headers.authorization;
      const bearer = parseBearerFromAuthorizationHeader(typeof auth === "string" ? auth : undefined);
      if (!bearer) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Missing bearer token." }));
        return;
      }
      if (!isSendMultipleQuotesPayload(body)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Invalid payload." }));
        return;
      }
      const result = await runSendMultipleQuotesEmailHandler(body, bearer);
      res.statusCode = result.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : "Unexpected server error.",
        }),
      );
    }
  });
}

function attachInboundEmailWebhookMiddleware(
  middlewares: Connect.Server,
  mode: string,
  envDir: string,
): void {
  const loaded = loadEnv(mode, envDir, "");
  for (const [k, v] of Object.entries(loaded)) {
    if (process.env[k] === undefined && typeof v === "string") process.env[k] = v;
  }

  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    if (pathname !== "/api/inbound-email/webhook") {
      next();
      return;
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Method not allowed." }));
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");

      const rh = req.headers;
      const svixId = (Array.isArray(rh["svix-id"]) ? rh["svix-id"][0] : rh["svix-id"]) ?? "";
      const svixTimestamp = (Array.isArray(rh["svix-timestamp"]) ? rh["svix-timestamp"][0] : rh["svix-timestamp"]) ?? "";
      const svixSignature = (Array.isArray(rh["svix-signature"]) ? rh["svix-signature"][0] : rh["svix-signature"]) ?? "";

      const result = await handleInboundEmailWebhook({ rawBody, svixId, svixTimestamp, svixSignature });
      res.statusCode = result.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : "Unexpected server error.",
        }),
      );
    }
  });
}

function attachInboundProcurementEmailWebhookMiddleware(
  middlewares: Connect.Server,
  mode: string,
  envDir: string,
): void {
  const loaded = loadEnv(mode, envDir, "");
  for (const [k, v] of Object.entries(loaded)) {
    if (process.env[k] === undefined && typeof v === "string") process.env[k] = v;
  }

  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    if (pathname !== "/api/inbound-email/procurement-webhook") {
      next();
      return;
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Method not allowed." }));
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");

      const rh = req.headers;
      const svixId = (Array.isArray(rh["svix-id"]) ? rh["svix-id"][0] : rh["svix-id"]) ?? "";
      const svixTimestamp =
        (Array.isArray(rh["svix-timestamp"]) ? rh["svix-timestamp"][0] : rh["svix-timestamp"]) ?? "";
      const svixSignature =
        (Array.isArray(rh["svix-signature"]) ? rh["svix-signature"][0] : rh["svix-signature"]) ?? "";

      const result = await handleInboundProcurementEmailWebhook({
        rawBody,
        svixId,
        svixTimestamp,
        svixSignature,
      });
      res.statusCode = result.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : "Unexpected server error.",
        }),
      );
    }
  });
}

function attachGeocodeMiddleware(middlewares: Connect.Server, mode: string, envDir: string): void {
  const loaded = loadEnv(mode, envDir, "");
  for (const [k, v] of Object.entries(loaded)) {
    if (process.env[k] === undefined && typeof v === "string") process.env[k] = v;
  }

  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    if (pathname !== "/api/geocode") {
      next();
      return;
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Method not allowed." }));
      return;
    }

    let q: string | null = null;
    try {
      q = new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("q")?.trim() ?? null;
    } catch {
      q = null;
    }
    if (!q) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Missing q query parameter." }));
      return;
    }
    if (q.length > 500) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Query too long." }));
      return;
    }

    try {
      const coords = await geocodeAddressOnServer(q);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (!coords) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: "Address not found." }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.end(JSON.stringify({ ok: true, lat: coords.lat, lng: coords.lng }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }),
      );
    }
  });
}

function attachProxyExternalImageMiddleware(
  middlewares: Connect.Server,
  mode: string,
  envDir: string,
): void {
  const loaded = loadEnv(mode, envDir, "");
  for (const [k, v] of Object.entries(loaded)) {
    if (process.env[k] === undefined && typeof v === "string") process.env[k] = v;
  }

  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    if (pathname !== "/api/proxy-external-image") {
      next();
      return;
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Method not allowed." }));
      return;
    }

    const full = req.url ?? "";
    let targetUrl: string | null = null;
    try {
      targetUrl = new URL(full, "http://127.0.0.1").searchParams.get("u");
    } catch {
      targetUrl = null;
    }
    if (!targetUrl?.trim()) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Missing u query parameter." }));
      return;
    }

    const r2base = pickR2PublicBaseUrl(process.env as Record<string, string | undefined>);
    if (!isProxyableR2ImageUrl(targetUrl, r2base)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "URL not allowed for proxy." }));
      return;
    }

    try {
      const fetched = await fetchImageBytesFromUpstream(targetUrl);
      if (!fetched) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Could not fetch image." }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", fetched.contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(Buffer.from(fetched.bytes));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }),
      );
    }
  });
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }: { mode: string }) => {
  const electronBuild = process.env.ELECTRON_BUILD === "1";

  return {
  base: electronBuild ? "./" : "/",
  optimizeDeps: {
    /** jspdf dinamički vuče canvg (SVG); mora biti instaliran i uključen u pre-bundle. */
    include: ["jspdf", "html2canvas", "canvg"],
  },
  define: {
    "import.meta.env.VITE_ELECTRON_BUILD": JSON.stringify(electronBuild ? "true" : ""),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    {
      name: "dev-send-multiple-quotes-api",
      enforce: "pre" as const,
      configureServer(server: ViteDevServer) {
        const envDir = server.config.envDir ?? path.resolve(__dirname);
        attachSendMultipleQuotesMiddleware(server.middlewares, server.config.mode, envDir);
        attachSendMaterialOrderEmailMiddleware(server.middlewares, server.config.mode, envDir);
        attachInboundEmailWebhookMiddleware(server.middlewares, server.config.mode, envDir);
        attachInboundProcurementEmailWebhookMiddleware(server.middlewares, server.config.mode, envDir);
        attachProxyExternalImageMiddleware(server.middlewares, server.config.mode, envDir);
        attachGeocodeMiddleware(server.middlewares, server.config.mode, envDir);
      },
      configurePreviewServer(server: PreviewServer) {
        const envDir = server.config.envDir ?? path.resolve(__dirname);
        attachSendMultipleQuotesMiddleware(server.middlewares, server.config.mode, envDir);
        attachSendMaterialOrderEmailMiddleware(server.middlewares, server.config.mode, envDir);
        attachInboundEmailWebhookMiddleware(server.middlewares, server.config.mode, envDir);
        attachInboundProcurementEmailWebhookMiddleware(server.middlewares, server.config.mode, envDir);
        attachProxyExternalImageMiddleware(server.middlewares, server.config.mode, envDir);
        attachGeocodeMiddleware(server.middlewares, server.config.mode, envDir);
      },
    },
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: electronBuild ? null : "auto",
      includeAssets: ["pwa-icon-192.png", "pwa-icon-512.png"],
      manifest: {
        name: "Termo Plast CRM",
        short_name: "Termo Plast",
        description: "CRM sistem za upravljanje poslovima u stolariji",
        theme_color: "#0B2147",
        background_color: "#f4f6fa",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        permissions: [{ name: "camera" as const }],
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
    compression({
      algorithm: 'gzip',
      ext: '.gz',
    }),
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    sourcemap: mode === "development",
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'tanstack': ['@tanstack/react-query'],
          'ui-core': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
          ],
          'charts': ['recharts'],
          'utils': ['date-fns', 'xlsx', 'framer-motion', 'lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
};
});
