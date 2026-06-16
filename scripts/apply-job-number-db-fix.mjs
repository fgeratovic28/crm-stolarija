/**
 * Poravnava brojač poslova (REST). SQL migraciju primeni ručno u Supabase SQL Editoru:
 * supabase/migrations/20260630120000_fix_next_job_number_numeric_sync.sql
 *
 * Pokreni: node scripts/apply-job-number-db-fix.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function loadDotEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const url = process.env.VITE_SUPABASE_URL || "https://ffoneiuobqrkskdhlmqq.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (u .env ili env)");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function rest(path, opts = {}) {
  const r = await fetch(`${url}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

const yymm =
  String(new Date().getFullYear()).slice(-2) + String(new Date().getMonth() + 1).padStart(2, "0");
const period = new Date().getFullYear() * 100 + (new Date().getMonth() + 1);
const pattern = new RegExp(`^${yymm}\\d+$`);

async function fetchAllJobNumbersForMonth() {
  const pageSize = 1000;
  let offset = 0;
  const numbers = [];

  for (;;) {
    const res = await rest(
      `/rest/v1/jobs?select=job_number&job_number=like.${yymm}*&limit=${pageSize}&offset=${offset}`,
    );
    if (res.status >= 400) {
      throw new Error(`jobs fetch failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const rows = Array.isArray(res.body) ? res.body : [];
    for (const row of rows) {
      if (typeof row.job_number === "string") numbers.push(row.job_number);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return numbers;
}

function maxSeqFromJobNumbers(numbers) {
  let maxSeq = 0;
  for (const n of numbers) {
    if (!pattern.test(n)) continue;
    const seq = Number.parseInt(n.slice(yymm.length), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return maxSeq;
}

async function syncCounter(maxSeq) {
  const patch = await rest(
    `/rest/v1/job_number_counters?prefix=eq.%23&year=eq.${period}`,
    { method: "PATCH", body: JSON.stringify({ last_value: maxSeq }) },
  );
  console.log("counter # /", period, "-> last_value =", maxSeq, "| HTTP", patch.status);
  if (patch.status >= 400) {
    console.error(patch.body);
  }
}

const numbers = await fetchAllJobNumbersForMonth();
const maxSeq = maxSeqFromJobNumbers(numbers);
const expected = `${yymm}${String(maxSeq + 1).padStart(2, "0")}`;

console.log("YYMM", yymm, "| poslova u mesecu:", numbers.length, "| max redni broj:", maxSeq);
await syncCounter(maxSeq);

const peek = await rest("/rest/v1/rpc/peek_job_number_counter", { method: "POST", body: "{}" });
console.log("peek_job_number_counter:", peek.body, "| očekivano:", maxSeq + 1);

console.log(
  "\nSQL migracija (ručno u Supabase SQL Editoru):\n",
  "supabase/migrations/20260630120000_fix_next_job_number_numeric_sync.sql",
);
console.log("Posle SQL-a, next_job_number treba da vrati:", expected);
