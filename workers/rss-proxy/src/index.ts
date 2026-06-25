export interface Env {
  ALLOWED_ORIGINS?: string;
  MAX_BYTES?: string;
  TIMEOUT_MS?: string;
  MAX_REDIRECTS?: string;
}

const XML_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
  "application/rdf+xml"
];

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin") ?? "";
  const configured = (env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowOrigin = configured.length === 0 ? "*" : configured.includes(origin) ? origin : configured[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function jsonError(message: string, status: number, request: Request, env: Env): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function isPrivateIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "0.0.0.0" || host.endsWith(".local")) return true;
  if (isPrivateIpv4(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  return false;
}

function validateTarget(rawUrl: string | null): URL {
  if (!rawUrl) throw new Error("urlパラメータがありません。");
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("URL形式が正しくありません。");
  }
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("http/httpsのみ取得できます。");
  if (isBlockedHost(target.hostname)) throw new Error("ローカルまたはプライベートアドレスは取得できません。");
  target.username = "";
  target.password = "";
  return target;
}

function looksLikeXml(contentType: string, text: string): boolean {
  const normalizedType = contentType.split(";")[0].trim().toLowerCase();
  const typeOk = XML_TYPES.includes(normalizedType) || normalizedType.endsWith("+xml") || normalizedType === "";
  const head = text.slice(0, 500).trim().toLowerCase();
  const bodyOk =
    head.startsWith("<?xml") ||
    head.includes("<rss") ||
    head.includes("<feed") ||
    head.includes("<rdf:rdf");
  return typeOk && bodyOk;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const length = response.headers.get("Content-Length");
  if (length && Number(length) > maxBytes) throw new Error("レスポンスが大きすぎます。");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("レスポンス本文を読めませんでした。");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("レスポンスが大きすぎます。");
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

async function fetchWithRedirects(target: URL, env: Env): Promise<Response> {
  const maxRedirects = Number(env.MAX_REDIRECTS ?? "3");
  const timeoutMs = Number(env.TIMEOUT_MS ?? "12000");
  let current = target;

  for (let i = 0; i <= maxRedirects; i += 1) {
    if (isBlockedHost(current.hostname)) throw new Error("リダイレクト先が許可されていません。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Accept": XML_TYPES.join(", ")
        }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        if (!location) throw new Error("リダイレクト先がありません。");
        current = validateTarget(new URL(location, current).toString());
        continue;
      }
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("取得が時間切れになりました。");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("リダイレクト回数が上限を超えました。");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== "GET") {
      return jsonError("GETのみ利用できます。", 405, request, env);
    }

    let target: URL;
    try {
      target = validateTarget(new URL(request.url).searchParams.get("url"));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "URLを検証できませんでした。", 400, request, env);
    }

    try {
      const response = await fetchWithRedirects(target, env);
      if (!response.ok) {
        return jsonError(`取得先がHTTP ${response.status}を返しました。`, 502, request, env);
      }
      const maxBytes = Number(env.MAX_BYTES ?? "1048576");
      const text = await readLimited(response, maxBytes);
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!looksLikeXml(contentType, text)) {
        return jsonError("RSS/Atom/XMLらしいレスポンスではありません。", 415, request, env);
      }
      return new Response(text, {
        status: 200,
        headers: {
          ...corsHeaders(request, env),
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=300"
        }
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "不明な取得エラーです。", 502, request, env);
    }
  }
};
