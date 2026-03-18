# Firebase Functions — Metered TURN (secure)

Questa Function espone un endpoint **sicuro** per ottenere `iceServers` da Metered **senza** mettere la API key nel client.

## Setup (una volta)

1) Installa dipendenze:

```bash
cd functions
npm install
```

2) Login Firebase (se non già):

```bash
firebase login
```

3) Imposta i secrets (server-side):

```bash
firebase functions:secrets:set METERED_API_KEY
firebase functions:secrets:set NVC_ALLOWED_ORIGINS
```

- `METERED_API_KEY`: la tua key Metered (djconsole).
- `NVC_ALLOWED_ORIGINS`: lista separata da virgole dei domini permessi, es:
  - `https://nevervideochat.com,https://www.nevervideochat.com`
  - Se lasci vuoto/non impostato, l'endpoint resta più permissivo (sconsigliato in produzione).

4) Deploy:

```bash
firebase deploy --only functions
firebase deploy --only hosting
```

## Endpoint

- `GET /api/ice` (via Hosting rewrite) → `getIceServers`

Risposta:

```json
{
  "iceServers": [ { "urls": "stun:..." }, { "urls": "turn:...", "username": "...", "credential": "..." } ],
  "iceCandidatePoolSize": 10,
  "bundlePolicy": "max-bundle",
  "rtcpMuxPolicy": "require",
  "fetchedAt": "..."
}
```

