// Chiamate al server. Ogni modifica porta l'intestazione X-Plancia (protezione dalle richieste di altri siti).

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
export class ServerUnreachable extends Error {}

let onUnauthorized = () => {};
let onUnreachable = () => {};
export function setHandlers({ unauthorized, unreachable }) {
  if (unauthorized) onUnauthorized = unauthorized;
  if (unreachable) onUnreachable = unreachable;
}

async function request(method, url, body, { raw = false, rawType } = {}) {
  const opts = { method, headers: { "X-Plancia": "1" }, credentials: "same-origin", cache: "no-store" };
  if (body !== undefined) {
    if (raw) {
      opts.headers["Content-Type"] = rawType || "application/octet-stream";
      opts.body = body;
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    onUnreachable();
    throw new ServerUnreachable("Server non raggiungibile");
  }
  if (res.status === 204) return null;
  const ctype = res.headers.get("Content-Type") || "";
  const data = ctype.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    throw new ApiError((data && data.error) || `Errore ${res.status}`, res.status, data);
  }
  return data;
}

export const get = (url) => request("GET", url);
export const post = (url, body = {}) => request("POST", url, body);
export const put = (url, body = {}) => request("PUT", url, body);
export const del = (url) => request("DELETE", url);
export const upload = (url, blob) => request("POST", url, blob, { raw: true });

/** Querystring dai filtri non vuoti. */
export function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
