/* ================================================================
   Firebase Functions — Metered TURN credentials proxy
   - Keeps Metered API key server-side (Runtime Config)
   - Returns ICE servers array to the client
   - Basic CORS + rate limit + short cache
   NOTE: functions.config() / Runtime Config is deprecated (Mar 2027).
         This is a temporary workaround when Secret Manager (Blaze)
         isn't available. Migrate to Params/Secrets when possible.
================================================================ */

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const functions = require("firebase-functions");

const cors = require("cors");

function getRuntimeConfig() {
  try { return functions.config() || {}; } catch { return {}; }
}

const corsMiddleware = cors({
  origin(origin, cb) {
    try {
      // No Origin header (same-origin / curl) → allow
      if (!origin) return cb(null, true);

      const cfg = getRuntimeConfig();
      const raw = String(cfg?.nvc?.allowed_origins || "").trim();
      if (!raw) {
        // If allow-list is not configured, allow the request but DO NOT reflect '*'
        // We just let CORS middleware set permissive headers for simple usage.
        return cb(null, true);
      }
      const allowed = raw.split(",").map(s => s.trim()).filter(Boolean);
      return cb(null, allowed.includes(origin));
    } catch (_) {
      return cb(null, false);
    }
  },
  methods: ["GET", "OPTIONS"],
  credentials: false,
  maxAge: 86400
});

// In-memory cache: keep response for 10 minutes
let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 10 * 60 * 1000;

// Very simple in-memory rate limit per IP
const ipBuckets = new Map(); // ip -> { count, resetAt }
const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_MAX = 60; // 60 requests per 10 minutes per IP

function getClientIp(req) {
  const xf = (req.get("x-forwarded-for") || "").split(",")[0].trim();
  return xf || req.ip || "unknown";
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

exports.getIceServers = onRequest(
  {
    region: "europe-west1",
    // keep this low; it should be fast
    timeoutSeconds: 10,
    memory: "128MiB"
  },
  (req, res) => {
    corsMiddleware(req, res, async () => {
      try {
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

        const ip = getClientIp(req);
        if (!rateLimitOk(ip)) return res.status(429).json({ error: "rate_limited" });

        const now = Date.now();
        if (_cache && (now - _cacheAt) < CACHE_MS) {
          return res.status(200).json(_cache);
        }

        const cfg = getRuntimeConfig();
        const apiKey = String(cfg?.metered?.apikey || "").trim();
        if (!apiKey) return res.status(500).json({ error: "missing_metered_api_key" });

        const url = `https://djconsole.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
        const r = await fetch(url, { method: "GET" });
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          logger.warn("Metered credentials fetch failed", { status: r.status, body: txt.slice(0, 200) });
          return res.status(502).json({ error: "metered_fetch_failed" });
        }
        const iceServers = await r.json();
        if (!Array.isArray(iceServers) || iceServers.length === 0) {
          return res.status(502).json({ error: "metered_invalid_response" });
        }

        const payload = {
          iceServers,
          iceCandidatePoolSize: 10,
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require",
          fetchedAt: new Date().toISOString()
        };

        _cache = payload;
        _cacheAt = now;

        return res.status(200).json(payload);
      } catch (err) {
        logger.error("getIceServers error", err);
        return res.status(500).json({ error: "internal_error" });
      }
    });
  }
);

