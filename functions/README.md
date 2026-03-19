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

3) Configurazione (params/secrets, niente più `functions.config()`):

- **METERED_API_KEY** (secret): la key Metered va in Secret Manager:
  ```bash
  firebase functions:secrets:set METERED_API_KEY
  ```
  (incolla il valore quando richiesto)

- **NVC_ALLOWED_ORIGINS** (param string, opzionale): lista domini CORS permessi, es. `https://nevervideochat.com,https://www.nevervideochat.com`. Se non impostato (default `""`) l’endpoint accetta qualsiasi origin. Puoi impostarlo in `functions/.env.<projectId>` dopo il primo deploy, o lasciare il default.

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

