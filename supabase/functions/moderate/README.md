# Edge Function: moderate (Supabase — opzionale)

**Questo progetto usa solo Firebase.** La moderazione AI è implementata in **Firebase Cloud Functions** (`functions/index.js` → `moderate`). Questo modulo Supabase non viene usato se usi solo Firebase.

---

AI moderation for chat: **text** (offensive/hate) and **images** (explicit/pornographic).

- **Text**: OpenAI Moderation API. Set `OPENAI_API_KEY` in Supabase → Project Settings → Edge Functions → Secrets.
- **Images**: Google Cloud Vision Safe Search. Set `GOOGLE_VISION_API_KEY` (Vision API key from Google Cloud Console). Enable the [Vision API](https://console.cloud.google.com/apis/library/vision.googleapis.com) and create an API key.

If a secret is missing, that check is skipped (content is allowed). This avoids blocking when the owner has not yet configured keys.

## Deploy

```bash
supabase functions deploy moderate --no-verify-jwt
```

Then add secrets in the dashboard or:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set GOOGLE_VISION_API_KEY=...
```
