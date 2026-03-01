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
  room_id     TEXT        NOT NULL DEFAULT 'general',
  reactions   JSONB       DEFAULT '{}'::jsonb,  -- { "emoji": [userId1, userId2, ...] }
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add room_id column to existing tables (safe to run on already-created tables)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS room_id TEXT NOT NULL DEFAULT 'general';

-- Add reactions column to existing tables (safe to run on already-created tables)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'::jsonb;

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

-- ── Indici per caricare i messaggi in ordine e per stanza ──────
CREATE INDEX IF NOT EXISTS messages_created_at_idx
  ON public.messages (created_at ASC);

CREATE INDEX IF NOT EXISTS messages_room_id_idx
  ON public.messages (room_id, created_at ASC);

-- ── Abilita Realtime sulla tabella messages ────────────────────
-- (ignora se la tabella è già nella publication)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- ================================================================
--  STORAGE — bucket "chat-media"
--
--  ⚠️  NON eseguire via SQL — fallo dalla Dashboard:
--
--  1. Supabase Dashboard → Storage → New Bucket
--     • Name:   chat-media
--     • Public: ✅  ON  (spunta "Make bucket public")
--     → Save
--
--  2. Clic sul bucket "chat-media" → Policies → New policy
--     Crea queste tre policy (usa "Custom policy"):
--
--     ┌─ Policy 1 ──────────────────────────────────────────┐
--     │ Name:       Public read chat-media                  │
--     │ Operation:  SELECT                                  │
--     │ USING:      bucket_id = 'chat-media'                │
--     └─────────────────────────────────────────────────────┘
--
--     ┌─ Policy 2 ──────────────────────────────────────────┐
--     │ Name:       Public upload chat-media                │
--     │ Operation:  INSERT                                  │
--     │ WITH CHECK: bucket_id = 'chat-media'                │
--     └─────────────────────────────────────────────────────┘
--
--     ┌─ Policy 3 ──────────────────────────────────────────┐
--     │ Name:       Owner delete chat-media                 │
--     │ Operation:  DELETE                                  │
--     │ USING:      bucket_id = 'chat-media'                │
--     └─────────────────────────────────────────────────────┘
-- ================================================================
