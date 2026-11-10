import { MTProxyTransport } from "teleproto";

/** Resolve the transport locally; never include the proxy URL or secret in errors. */
export function telegramProxy(value: string) {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      !(
        (url.protocol === "tg:" && url.hostname === "proxy") ||
        (url.protocol === "https:" && url.hostname === "t.me" && url.pathname === "/proxy")
      )
    ) throw new Error();
    const host = url.searchParams.get("server") || "";
    const portText = url.searchParams.get("port") || "";
    const port = Number(portText);
    const secret = url.searchParams.get("secret") || "";
    if (!host || /[\s/?#@]/.test(host) || !/^\d+$/.test(portText) || port < 1 || port > 65535)
      throw new Error();
    const transport = new MTProxyTransport({ host, port, secret });
    transport.resolve(); // Validate secret format without opening a connection.
    return transport;
  } catch {
    throw new Error("TELEGRAM_PROXY_URL: нужна ссылка tg://proxy?server=…&port=…&secret=… или https://t.me/proxy?server=…&port=…&secret=…");
  }
}
