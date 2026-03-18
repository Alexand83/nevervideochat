/**
 * Cloudflare Worker — Metered TURN credentials proxy
 * - Keeps Metered API key server-side (Worker secret)
 * - Returns { iceServers, ... } to the client
 * - CORS allowlist + simple rate limit + short cache (per isolate)
 *
 * Secrets:
 * - METERED_API_KEY: Metered API key (djconsole)
 * - ALLOWED_ORIGINS: comma-separated origins, e.g. "https://alexand83.github.io"
 */

const CACHE_MS = 10 * 60 * 1000;
let cachePayload = null;
let cacheAt = 0;

const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_MAX = 60;
const ipBuckets = new Map(); // ip -> { count, resetAt }

function getIp(req) {
  const cf = req.headers.get('cf-connecting-ip');
  const xff = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return cf || xff || 'unknown';
}

function rateLimitOk(ip) {
  const now = Date.now();
  const b = ipBuckets.get(ip);
  if (!b || now > b.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return true;
  }
  b.count += 1;
  return b.count <= RL_MAX;
}

function corsHeaders(origin, allowedOriginsRaw) {
  const h = {
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (!origin) return h;
  const allowed = String(allowedOriginsRaw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) {
    // permissive fallback (not ideal, but avoids breaking if not configured)
    h['Access-Control-Allow-Origin'] = origin;
    return h;
  }
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(resBody, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const ch = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: ch });
    if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, { status: 405, headers: ch });

    if (url.pathname !== '/ice') return json({ error: 'not_found' }, { status: 404, headers: ch });

    const ip = getIp(req);
    if (!rateLimitOk(ip)) return json({ error: 'rate_limited' }, { status: 429, headers: ch });

    const now = Date.now();
    if (cachePayload && (now - cacheAt) < CACHE_MS) return json(cachePayload, { headers: ch });

    const apiKey = String(env.METERED_API_KEY || '').trim();
    if (!apiKey) return json({ error: 'missing_metered_api_key' }, { status: 500, headers: ch });

    const meteredUrl = `https://djconsole.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
    const r = await fetch(meteredUrl, { method: 'GET' });
    if (!r.ok) return json({ error: 'metered_fetch_failed' }, { status: 502, headers: ch });

    const iceServers = await r.json().catch(() => null);
    if (!Array.isArray(iceServers) || iceServers.length === 0) {
      return json({ error: 'metered_invalid_response' }, { status: 502, headers: ch });
    }

    const payload = {
      iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      fetchedAt: new Date().toISOString(),
    };
    cachePayload = payload;
    cacheAt = now;

    return json(payload, { headers: ch });
  }
};

