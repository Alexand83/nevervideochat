-- ================================================================
--  NeverVideoChat — Supabase Schema
--  Incolla questo intero file nell'SQL Editor di Supabase:
--  Dashboard → SQL Editor → New query → incolla → Run
--  (sicuro da rieseguire: usa IF NOT EXISTS / IF EXISTS ovunque)
-- ================================================================

-- ── Tabella messaggi pubblici ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  username    TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read messages"   ON public.messages;
DROP POLICY IF EXISTS "Public insert messages" ON public.messages;

CREATE POLICY "Public read messages"
  ON public.messages FOR SELECT
  USING (true);

CREATE POLICY "Public insert messages"
  ON public.messages FOR INSERT
  WITH CHECK (true);

-- ── Indice per caricare i messaggi in ordine ───────────────────
CREATE INDEX IF NOT EXISTS messages_created_at_idx
  ON public.messages (created_at ASC);

-- ── Abilita Realtime sulla tabella messages ────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- ================================================================
--  STORAGE — bucket "chat-media" per immagini e vocali
--
--  PRIMA di eseguire questo blocco:
--  Storage → New Bucket → Name: chat-media → Public: ✅ ON
--  (se il bucket esiste già, la INSERT fa ON CONFLICT e aggiorna)
-- ================================================================

INSERT INTO storage.buckets (id, name, public)
  VALUES ('chat-media', 'chat-media', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

-- Abilita RLS sul bucket
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read chat-media"   ON storage.objects;
DROP POLICY IF EXISTS "Public upload chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Owner delete chat-media"  ON storage.objects;

-- Lettura pubblica: chiunque può ascoltare/vedere i file
CREATE POLICY "Public read chat-media"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'chat-media' );

-- Upload anonimo: chiunque può caricare (anon key sufficiente)
CREATE POLICY "Public upload chat-media"
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'chat-media' );

-- Delete facoltativo (chi ha caricato può eliminare)
CREATE POLICY "Owner delete chat-media"
  ON storage.objects FOR DELETE
  USING ( bucket_id = 'chat-media' );
