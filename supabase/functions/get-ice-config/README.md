# get-ice-config Edge Function

Restituisce la configurazione ICE (STUN + TURN) al client WebRTC.
Le credenziali TURN non sono mai esposte nel bundle JS del frontend.

## Env vars da impostare in Supabase Dashboard → Settings → Edge Functions → Secrets

| Variabile        | Descrizione                              | Esempio                     |
|------------------|------------------------------------------|-----------------------------|
| `TURN_USERNAME`  | Username per il server TURN              | `openrelayproject`          |
| `TURN_CREDENTIAL`| Password per il server TURN              | `openrelayproject`          |
| `TURN_HOST`      | Hostname del server TURN (opzionale)     | `openrelay.metered.ca`      |

Se `TURN_USERNAME` o `TURN_CREDENTIAL` sono vuoti, la funzione restituisce
solo i server STUN pubblici (nessun relay — connessioni dirette via host/srflx).

## Deploy

```bash
supabase functions deploy get-ice-config
```
