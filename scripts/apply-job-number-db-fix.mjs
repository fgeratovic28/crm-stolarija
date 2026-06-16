import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const yymm =
  String(new Date().getFullYear()).slice(-2) + String(new Date().getMonth() + 1).padStart(2, "0");
const period = new Date().getFullYear() * 100 + (new Date().getMonth() + 1);
const pattern = new RegExp(`^${yymm}\\d+$`);

async function rest(path, opts = {}) {
  const r = await fetch(`${url}${path}`, { ...opts, headers: { ...h, ...opts.headers } });
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: text };
  }
}

const all = await rest(`/rest/v1/jobs?select=job_number&job_number=like.${yymm}*`);
let maxSeq = 0;
for (const row of all.body ?? []) {
  const n = row.job_number;
  if (typeof n !== "string" || !pattern.test(n)) continue;
  const seq = Number.parseInt(n.slice(yymm.length), 10);
  if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
}

const patch = await rest(`/rest/v1/job_number_counters?prefix=eq.%23&year=eq.${period}`, {
  method: "PATCH",
  body: JSON.stringify({ last_value: maxSeq }),
});

const peek = await rest("/rest/v1/rpc/peek_job_number_counter", {
  method: "POST",
  body: JSON.stringify({ p_format: "numeric" }),
});

console.log("maxSeq u jobs:", maxSeq);
console.log("counter sync:", patch.status, patch.body);
console.log("peek:", peek.body);
console.log("sledeći broj posla:", `${yymm}${String(maxSeq + 1).padStart(2, "0")}`);
console.log("\nPrimeni SQL u Supabase Editoru:");
console.log("supabase/migrations/20260630120000_fix_next_job_number_numeric_sync.sql");
