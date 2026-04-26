import * as net from "node:net";
import * as tls from "node:tls";

interface ElectrumHeadersResult {
  height: number;
  hex?: string;
}

interface ElectrumResponse<T> {
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

export interface FetchNavcoinTipOptions {
  host: string;
  port: number;
  ssl: boolean;
  timeoutMs?: number;
}

/**
 * Open a one-shot Electrum connection (TCP or TLS) and request the current
 * chain tip via `blockchain.headers.subscribe`. Used to read the live Navcoin
 * mainnet height for the swap-activation countdown without pulling in a heavy
 * Electrum client dependency.
 */
export async function fetchNavcoinTipHeight(
  opts: FetchNavcoinTipOptions
): Promise<number> {
  const { host, port, ssl, timeoutMs = 6000 } = opts;

  return new Promise<number>((resolve, reject) => {
    const payload =
      JSON.stringify({
        id: 1,
        method: "blockchain.headers.subscribe",
        params: [],
      }) + "\n";

    let buf = "";
    let settled = false;

    const finish = (err: Error | null, height?: number) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore — best-effort close.
      }
      if (err) reject(err);
      else if (typeof height === "number") resolve(height);
      else reject(new Error("Electrum returned no height"));
    };

    const socket: net.Socket = ssl
      ? tls.connect(
          {
            host,
            port,
            servername: host,
            // Public Electrum servers commonly use self-signed certs; we only
            // need the height so cert validation isn't worth a hard failure.
            rejectUnauthorized: false,
          },
          () => socket.write(payload)
        )
      : net.connect({ host, port }, () => socket.write(payload));

    socket.setTimeout(timeoutMs, () =>
      finish(new Error(`Electrum request to ${host}:${port} timed out`))
    );
    socket.on("error", (err) => finish(err));
    socket.on("end", () =>
      finish(new Error("Electrum connection closed before response"))
    );
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const newlineIdx = buf.indexOf("\n");
      if (newlineIdx === -1) return;
      const line = buf.slice(0, newlineIdx).trim();
      if (!line) return;
      try {
        const parsed = JSON.parse(line) as ElectrumResponse<
          ElectrumHeadersResult | number
        >;
        if (parsed.error) {
          finish(new Error(`Electrum error: ${parsed.error.message}`));
          return;
        }
        const result = parsed.result;
        const height =
          typeof result === "number"
            ? result
            : typeof result?.height === "number"
              ? result.height
              : undefined;
        if (typeof height !== "number" || !Number.isFinite(height)) {
          finish(new Error("Electrum response missing numeric height"));
          return;
        }
        finish(null, height);
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}
