# NeverVideoChat — Setup Firebase

## 1. Console Firebase

1. Vai su [Firebase Console](https://console.firebase.google.com/) e apri il progetto **nevervideochat** (o creane uno e sostituisci i dati in `js/firebase-config.js` e in `setup-firebase.html`).
2. **Authentication** → Abilita **Email/Password** (e, se serve, Anonymous per gli ospiti).
3. **Firestore Database** → Crea database in modalità **production** (poi applica le rules da `firebase/firestore.rules`).
4. **Storage** → Abilita Storage; opzionale: crea una cartella/prefix `chat-media` per i file (le rules in `firebase/storage.rules` usano il path `chat-media/`).

## 2. Installazione dati iniziali (tabelle/collezioni)

1. Apri **setup-firebase.html** in un browser (stesso dominio del sito o da `file://` se Firestore lo consente; in produzione servilo dal tuo hosting).
2. Clicca **«Crea collezioni e dati iniziali»**.
3. Verranno creati:
   - stanza **General** (id `1`) in `rooms`
   - temi **dark**, **light**, **blue**, **purple** in `themes`
   - ruoli **owner**, **admin**, **moderator**, **user**, **guest** in `custom_roles`

## 3. Regole di sicurezza

- **Firestore**: copia il contenuto di `firebase/firestore.rules` in Firestore → Regole (o usa `firebase deploy --only firestore:rules` se usi Firebase CLI).
- **Realtime Database**: in Firebase Console → Realtime Database → Regole, incolla il contenuto di `firebase/database.rules.json` (sostituisci l’intero blocco `rules`). Serve per permettere lettura/scrittura su `broadcast` e `presence` agli utenti autenticati; altrimenti vedrai `permission_denied` su `/broadcast/`.
- **Storage**: in Storage → Regole incolla `firebase/storage.rules` (adatta il path se non usi `chat-media`).

### CORS su Storage (upload da dominio esterno, es. GitHub Pages)

Se l'app è hostata su un altro dominio (es. `https://alexand83.github.io`) e vedi **CORS** quando carichi avatar o file su Firebase Storage, devi applicare CORS al bucket con **gsutil** (Google Cloud SDK):

1. Installa [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) e autenticati: `gcloud auth login` e `gcloud config set project nevervideochat`.
2. Applica il file CORS incluso nel repo:
   ```bash
   gsutil cors set firebase/storage-cors.json gs://nevervideochat.firebasestorage.app
   ```
3. In `firebase/storage-cors.json` sono già presenti `https://alexand83.github.io` e alcune origini locali. Se usi un altro dominio, aggiungilo nell'array `"origin"`.

**Alternativa:** da [Google Cloud Console](https://console.cloud.google.com/) → Cloud Shell, carica `firebase/storage-cors.json` e lancia lo stesso comando `gsutil cors set ...`.

## 4. Configurazione nell’app

La config è in **js/firebase-config.js**. L’app attualmente usa ancora **Supabase**; la conversione completa a Firebase (Auth, Firestore, Realtime/Realtime DB, Storage) richiederà la modifica di:

- `js/supabase-client.js` → sostituzione con un client Firebase (Auth + Firestore + Realtime DB per presenza/broadcast)
- `js/auth.js`, `js/chat.js`, `js/rooms.js`, `js/admin.js`, ecc. per usare le API Firebase al posto di `state.supa.from(...)` e `state.supa.channel(...)`.

## 5. Indici Firestore (obbligatori)

Se in console vedi **"The query requires an index"**, apri il link indicato nell’errore e clicca **Crea indice**. Gli indici necessari sono:

| Errore / Collezione | Link per creare l’indice |
|---------------------|---------------------------|
| **rooms** (`is_open`, `created_at`) | [Crea indice rooms](https://console.firebase.google.com/v1/r/project/nevervideochat/firestore/indexes?create_composite=Ckxwcm9qZWN0cy9uZXZlcnZpZGVvY2hhdC9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvcm9vbXMvaW5kZXhlcy9fEAEaCwoHaXNfb3BlbhABGg4KCmNyZWF0ZWRfYXQQARoMCghfX25hbWVfXxAB) |
| **active_games** (`is_active`, `room_id`, `started_at`) | [Crea indice active_games](https://console.firebase.google.com/v1/r/project/nevervideochat/firestore/indexes?create_composite=ClNwcm9qZWN0cy9uZXZlcnZpZGVvY2hhdC9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvYWN0aXZlX2dhbWVzL2luZGV4ZXMvXxABGg0KCWlzX2FjdGl2ZRABGgsKB3Jvb21faWQQARoOCgpzdGFydGVkX2F0EAIaDAoIX19uYW1lX18QAg) |

Per altre query (es. `messages`), Firestore mostrerà un link simile nel messaggio d’errore: aprilo e crea l’indice.

## 6. Errori comuni e come risolverli

| Messaggio | Cosa fare |
|-----------|-----------|
| **[Announcements] Missing or insufficient permissions** | In Firebase Console → Firestore → Regole, verifica che ci sia `allow read: if true` per `announcements` e **Pubblica** le regole. |
| **[Rooms] The query requires an index** | Vai alla sezione **Indici Firestore** sopra e crea l’indice per `rooms` (link nella tabella). |
| **[Games] The query requires an index** | Crea l’indice per `active_games` (link nella tabella sopra). |
| **set at /broadcast/... failed: permission_denied** | Imposta le regole del **Realtime Database** come in **Regole di sicurezza** (file `firebase/database.rules.json`). Gli utenti devono essere autenticati (Email/Password o Anonymous). |
| **[Chat] addMessage: Room not found general** | Di solito è conseguenza delle stanze non caricate: crea l’indice per `rooms` e pubblica le regole Firestore; poi ricarica la pagina. |

Vedi **FIRESTORE_COLLECTIONS.md** per la mappatura Supabase → Firestore.
