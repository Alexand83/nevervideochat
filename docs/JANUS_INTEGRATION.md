# Integrazione Janus per le webcam NVC

Cosa ti serve per usare Janus come SFU al posto del WebRTC P2P attuale (e poter bypassare il TURN in molti casi).

---

## 1. Server Janus

- **Dove:** VPS con IP pubblico (es. Hetzner, DigitalOcean, AWS) oppure servizio hosted.
- **Come:** Docker è il modo più semplice:
  - Immagine ufficiale: `canyan/janus-gateway`
  - Serve **HTTPS** e **WSS** (WebSocket Secure) perché i browser richiedono secure context per `getUserMedia` e WebRTC.
- **Plugin da abilitare:**
  - **VideoRoom** → per la cam in stanza (più partecipanti nella stessa room).
  - **VideoCall** (opzionale) → per le videochiamate private 1-to-1, se vuoi gestirle con un plugin dedicato; altrimenti puoi usare una VideoRoom con 2 partecipanti.

**Esempio run Docker (solo per test locale):**
```bash
docker run -d -p 8088:8088 -p 8188:8188 -p 7088:7088 -p 7889:7889 canyan/janus-gateway
```
In produzione servono certificato SSL e proxy (nginx/caddy) per HTTPS/WSS verso la porta HTTP/WS di Janus.

---

## 2. Configurazione rete

- **Porte:** Janus usa tipicamente:
  - 8088 (HTTP)
  - 8188 (WebSocket)
  - 7088 (HTTPS)
  - 7889 (WSS)
- **Firewall:** Apri le porte che espongono (di solito 80/443 verso nginx, che fa proxy a Janus).
- **STUN:** Per la connessione **browser ↔ Janus** basta di solito STUN (es. `stun:stun.l.google.com:19302`). TURN separato spesso non serve perché il media passa già da Janus.

---

## 3. Cosa hai ora (NVC) vs Janus

| NVC (attuale) | Janus |
|---------------|--------|
| Signaling: broadcast `webrtc` (offer/answer/ice) su canale Supabase/Firebase | Signaling: API Janus (HTTP/WebSocket) – join room, configure, start, eventi (publisher/subscriber) |
| P2P: una `RTCPeerConnection` per ogni altro peer | SFU: una connessione verso Janus (publish) + una per ogni stream remoto (subscribe) |
| Contesti: **public** (cam in stanza), **private** (videochiamata 1-to-1) | **VideoRoom:** una room id = stanza NVC oppure “private-{uidA}-{uidB}” per la chiamata privata |
| `cam-req` / `cam-accepted` / `cam-rejected` (chi chiede, chi accetta) | Restano utili: decidono “chi entra in quale Janus room” e quando mostrare la finestra cam; il media poi va su Janus |

---

## 4. Cosa ti serve in codice

### 4.1 Config

- **URL Janus** (HTTPS + WSS), es.:
  - `JANUS_URL = 'https://janus.tuodominio.com'`
  - `JANUS_WS_URL = 'wss://janus.tuodominio.com'`
- Eventuale **secret** per creare room (se usi token/API lato server).

### 4.2 Libreria Janus (frontend)

- **janus.js** (JavaScript adapter ufficiale):  
  https://github.com/meetecho/janus-gateway/blob/master/npm/janus.js  
  Lo includi come script o modulo e lo usi per:
  - connessione alla gateway (`Janus.init`, `new Janus(...)`),
  - attach al plugin VideoRoom,
  - join room, publish (stream locale), subscribe (stream remoti).

### 4.3 Flusso logico (da sostituire / affiancare a `camera.js`)

- **Cam in stanza (public):**
  - Utente attiva la cam → come ora ottieni `getUserMedia` → invece di creare offer P2P verso ogni peer:
    - connetti a Janus, attach VideoRoom, join room (id = `state.activeRoom` o simile),
    - “publish” con lo stream locale,
    - ascolti gli eventi “new participant” e fai “subscribe” per ogni publisher remoto → attacchi lo stream al `<video>` (come ora con `createCameraWindow`).
- **Videochiamata privata:**
  - Stesso flusso ma la room Janus può essere una sola per la coppia, es. `private-${uidA}-${uidB}` (ordinando gli id per avere sempre lo stesso nome). Chi accetta fa join della stessa room + publish + subscribe.

### 4.4 Signaling attuale vs Janus

- **Da tenere (invariato):**
  - `cam-req`, `cam-accepted`, `cam-rejected`, `cam-revoked`, presenza “hasCamera”, ecc. Servono per “chi vede chi” e per aprire/chiudere le finestre cam.
- **Da sostituire (solo per il media):**
  - Tutto il flusso `webrtc` (offer / answer / ice) in `handleWebRTCSignal` e le `RTCPeerConnection` in `camera.js` vanno sostituiti con:
    - connessione a Janus,
    - join room (id stanza o id chiamata privata),
    - publish / subscribe tramite API Janus.
- **Dove si usa:** `camera.js` (creazione offer/answer, ICE, gestione `state.outgoingPCs` / `state.incomingPCs`) e i punti in cui si fa `broadcast('webrtc', ...)`.

Quindi: **no**, non devi più mandare offer/answer/ICE sul canale broadcast; quei messaggi saranno sostituiti da chiamate alla gateway Janus (join, configure, start, trickle ICE verso Janus, ecc.).

---

## 5. Backend (opzionale ma consigliato)

- **Senza backend:** il frontend può usare l’API Janus (HTTP/WebSocket) per creare room e join (se Janus è configurato per permetterlo).
- **Con backend:** un piccolo servizio (Node/ Supabase Edge Function, ecc.):
  - crea la room Janus (o ne gestisce l’id),
  - eventualmente emette un token per il join,
  - restituisce al client l’URL Janus e il room id (e il token se usi auth).

Così eviti che chiunque possa creare/entrare in qualsiasi room.

---

## 6. Riassunto checklist

| Cosa | Stato |
|------|--------|
| Server con Janus (Docker o nativo) | Da fare |
| HTTPS + WSS esposti (proxy nginx/caddy) | Da fare |
| Plugin VideoRoom (e opz. VideoCall) abilitati | Da fare |
| Inclusione `janus.js` nel frontend | Da fare |
| Config `JANUS_URL` / `JANUS_WS_URL` in NVC | Da fare |
| Sostituzione flusso P2P in `camera.js` con join/publish/subscribe Janus | Da fare |
| Mappatura room NVC / private call → room id Janus | Da fare |
| Tenere cam-req/cam-accepted; rimuovere/sostituire webrtc offer/answer/ice | Da fare |
| (Opz.) Backend per creare room / token | Da fare |

Con Janus attivo puoi **bypassare un server TURN separato** per il media: il traffico passa già da Janus. Resta utile STUN per la connessione browser ↔ Janus (es. quello che hai già in `config.js`).
