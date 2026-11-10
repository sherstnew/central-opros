/** Production accepts only the configured origin. Development also accepts explicit loopback hosts. */
export function isAllowedOrigin(
  origin: string | undefined,
  appOrigin: string,
  production: boolean,
): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    // Browser Origin headers contain only scheme, host and port (no path or credentials).
    if (
      parsed.origin !== origin ||
      !["http:", "https:"].includes(parsed.protocol)
    )
      return false;
    if (origin === new URL(appOrigin).origin) return true;
    return (
      !production &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
