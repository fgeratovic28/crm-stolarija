/**
 * Minimalne deklaracije za Deno API u Edge funkciji (IDE / tsc u monorepu).
 * Runtime i dalje koristi Deno iz Supabase Edge.
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

declare module "https://esm.sh/@supabase/supabase-js@2.49.8" {
  export * from "@supabase/supabase-js";
}
