# Cloudflare Worker — Metered ICE proxy

Questo Worker espone un endpoint **sicuro** per ottenere `iceServers` da Metered senza mettere la API key nel client.

## Prerequisiti

- Account Cloudflare
- `wrangler` installato (Node)

## Setup

1) Entra nella cartella:

```bash
cd worker
```

2) Login Cloudflare (una volta):

```bash
npx wrangler login
```

3) Imposta i secrets:

```bash
npx wrangler secret put METERED_API_KEY
npx wrangler secret put ALLOWED_ORIGINS
```

Valori:
- `METERED_API_KEY`: la tua Metered API key (djconsole)
- `ALLOWED_ORIGINS`: es. `https://alexand83.github.io`

4) Deploy:

```bash
npx wrangler deploy
```

Otterrai un URL tipo:
- `https://nvc-ice-proxy.<tuo-account>.workers.dev`

L'endpoint ICE è:
- `GET <WORKER_URL>/ice`

## Collegamento nell'app

Imposta `ICE_ENDPOINT_URL` in `js/config.js` a:

```js
export const ICE_ENDPOINT_URL = 'https://...workers.dev/ice';
```

Su GitHub Pages, l'app proverà prima questo endpoint, poi eventuali fallback.

