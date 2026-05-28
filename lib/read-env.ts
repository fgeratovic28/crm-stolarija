/** Trim + skini okolne navodnike (dotenv sa `<email>` u vrednosti). */
export function normalizeEnvString(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Čita env po imenu (toleriše razmake oko `=` u .env fajlu). */
export function readEnv(name: string): string | undefined {
  const direct = process.env[name];
  if (direct != null && direct !== "") {
    return normalizeEnvString(direct);
  }
  for (const [key, val] of Object.entries(process.env)) {
    if (key.trim() === name && val != null && val !== "") {
      return normalizeEnvString(val);
    }
  }
  return undefined;
}

export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
