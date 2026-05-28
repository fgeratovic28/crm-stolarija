/** Deljeno za Vercel/api i Next route handlere koji parsiraju JWT iz zaglavlja. */
export function parseBearerFromAuthorizationHeader(authorization?: string): string | null {
  if (!authorization || typeof authorization !== "string") return null;
  const [type, ...rest] = authorization.split(" ");
  const token = rest.join(" ").trim();
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}
