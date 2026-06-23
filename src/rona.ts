/**
 * RONA HTTP transport.
 *
 * rona.ca sits behind Cloudflare, which gates requests on both the HTTP version
 * and the client's TLS (JA3) fingerprint. Node's native HTTP stack (fetch/undici)
 * is rejected with 403; only curl's fingerprint over HTTP/2 is allowlisted. So
 * every request to rona.ca shells out to `curl --http2`. The Constructor.io search
 * host (cnstrc.com) is open, but we route it through the same transport for
 * consistency. No cookies are required for the public endpoints used here.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

/** rona.ca app + WCS commerce backend. */
export const BASE = "https://www.rona.ca";
/** WCS REST store id (online catalog/inventory backend). */
export const WCS_STORE = "10151";
/** Constructor.io search host + public index key for RONA. */
export const CNSTRC_BASE = "https://tvbajuset-zone.cnstrc.com";
export const CNSTRC_KEY = "key_hAK9oT4Sj3Dnme0L";
/** Stable per-process Constructor.io client id (any UUID is accepted). */
export const CNSTRC_CLIENT_ID = randomUUID();

/** Browser-like headers that Cloudflare accepts (Firefox profile). */
const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
  Origin: "https://www.rona.ca",
  Referer: "https://www.rona.ca/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

export class RonaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RonaError";
  }
}

/** GET a URL (or a www.rona.ca-relative path starting with "/") and parse JSON. */
export async function ronaGet<T = unknown>(
  pathOrUrl: string,
  { timeoutMs = 25_000 }: { timeoutMs?: number } = {},
): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : BASE + pathOrUrl;

  const args = [
    "--http2",
    "--compressed",
    "--silent",
    "--show-error",
    "--max-time",
    String(Math.ceil(timeoutMs / 1000)),
    // Write the HTTP status code on its own trailing line after the body.
    "--write-out",
    "\n%{http_code}",
  ];
  for (const [k, v] of Object.entries(HEADERS)) {
    args.push("-H", `${k}: ${v}`);
  }
  args.push(url);

  const { stdout } = await execFileAsync("curl", args, {
    timeoutMs: timeoutMs + 5_000,
    maxBuffer: 32 * 1024 * 1024,
  });

  // Split off the status code we appended via --write-out.
  const nl = stdout.lastIndexOf("\n");
  const body = nl >= 0 ? stdout.slice(0, nl) : stdout;
  const status = parseInt(nl >= 0 ? stdout.slice(nl + 1).trim() : "0", 10);

  if (status < 200 || status >= 300) {
    const snippet = body.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new RonaError(
      `RONA API returned HTTP ${status}${snippet ? `: ${snippet}` : ""}`,
      status,
    );
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new RonaError(
      `Failed to parse JSON from ${url} (HTTP ${status}, ${body.length} bytes)`,
      status,
    );
  }
}

function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; maxBuffer: number },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer, encoding: "utf8" },
      (err, stdout) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new RonaError("`curl` not found on PATH — it is required to reach the RONA API."));
          } else {
            reject(new RonaError(`curl failed: ${err.message}`));
          }
          return;
        }
        resolve({ stdout });
      },
    );
  });
}

/**
 * Build a query string from a params object, skipping undefined/empty values.
 * Values are URL-encoded; keys are passed through (so bracketed Constructor.io
 * keys like "filters[brand]" survive).
 */
export function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join("&");
}
