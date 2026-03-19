/* ================================================================
   Firebase Functions — Metered TURN credentials proxy + moderate
   - Params/secrets via firebase-functions/params (no deprecated config())
================================================================ */

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { defineSecret, defineString } = require("firebase-functions/params");
const cors = require("cors");

const meteredApiKey = defineSecret("METERED_API_KEY");
const nvcAllowedOrigins = defineString("NVC_ALLOWED_ORIGINS", { default: "" });

const corsMiddleware = cors({
  origin(origin, cb) {
    try {
      if (!origin) return cb(null, true);
      const raw = String(nvcAllowedOrigins.value() || "").trim();
      if (!raw) return cb(null, true);
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

const corsPost = cors({
  origin: true,
  methods: ["POST", "OPTIONS"],
  credentials: false,
  maxAge: 86400,
  allowedHeaders: ["Content-Type", "Authorization"]
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
    timeoutSeconds: 10,
    memory: "128MiB",
    secrets: [meteredApiKey]
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

        const apiKey = String(meteredApiKey.value() || "").trim();
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

// --- AI Moderation: endpoint attivo ma senza ML (build falliva con tfjs-node).
//    Per riattivare ML: ripristina dipendenze e logica da backup / moderate-full.
exports.moderate = onRequest(
  { region: "europe-west1", timeoutSeconds: 30, memory: "256MiB" },
  (req, res) => {
    corsPost(req, res, async () => {
      try {
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
        return res.status(200).json({ allowed: true });
      } catch (err) {
        logger.error("moderate error", err);
        return res.status(200).json({ allowed: true });
      }
    });
  }
);

