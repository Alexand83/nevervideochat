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

-- ── Aggiungi colonna role a profiles (già esistente) ───────────
-- La tabella profiles esiste già (vedi supabase_profiles.sql)
-- Aggiungiamo solo la colonna role per i permessi admin
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── Tabella stanze (gestite da admin) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.rooms (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  icon        TEXT        DEFAULT '💬',
  is_open     BOOLEAN     DEFAULT true,
  password    TEXT,       -- NULL = no password, TEXT = hashed password
  created_by  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for rooms
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read rooms" ON public.rooms;
DROP POLICY IF EXISTS "Admin manage rooms" ON public.rooms;
CREATE POLICY "Public read rooms" ON public.rooms FOR SELECT USING (true);
CREATE POLICY "Admin manage rooms" ON public.rooms FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin'))
);

-- ── Crea stanza "general" di default ─────────────────────────
INSERT INTO public.rooms (id, name, icon, is_open, created_by)
VALUES ('general', 'General', '💬', true, 'system')
ON CONFLICT (id) DO NOTHING;

-- ── Tabella ruoli/gruppi personalizzati ──────────────────────
CREATE TABLE IF NOT EXISTS public.custom_roles (
  id          TEXT        PRIMARY KEY,  -- 'moderator', 'vip', etc.
  name        TEXT        NOT NULL,
  color       TEXT        DEFAULT '#8b949e',  -- Badge color
  permissions JSONB       DEFAULT '{}'::jsonb,  -- { "can_ban": true, "can_mute": true, "can_kick": true, "can_delete_messages": false }
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for custom_roles
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read custom_roles" ON public.custom_roles;
DROP POLICY IF EXISTS "Admin manage custom_roles" ON public.custom_roles;

CREATE POLICY "Public read custom_roles" ON public.custom_roles FOR SELECT USING (true);
CREATE POLICY "Admin manage custom_roles" ON public.custom_roles FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin'))
);

-- ── Aggiungi colonna custom_role_id a profiles ────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS custom_role_id TEXT REFERENCES public.custom_roles(id) ON DELETE SET NULL;

-- ── Tabella utenti bannati (global ban - da tutte le stanze) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banned_users (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  username    TEXT        NOT NULL,
  reason      TEXT,
  banned_by   TEXT        NOT NULL,
  banned_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,  -- NULL = permanent ban
  UNIQUE(user_id)
);

-- ── Tabella utenti kickati (per stanza, temporaneo) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kicked_users (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  room_id     TEXT        NOT NULL,
  kicked_by   TEXT        NOT NULL,
  kicked_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,  -- Quando può rientrare (obbligatorio)
  UNIQUE(user_id, room_id)
);

-- RLS for banned_users
ALTER TABLE public.banned_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read banned users" ON public.banned_users;
DROP POLICY IF EXISTS "Admin manage banned users" ON public.banned_users;
CREATE POLICY "Public read banned users" ON public.banned_users FOR SELECT USING (true);
CREATE POLICY "Admin manage banned users" ON public.banned_users FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin', 'moderator'))
);

-- ── Tabella IP bannati ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banned_ips (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ip          TEXT        NOT NULL,  -- Single IP or CIDR range (e.g., "192.168.1.0/24")
  reason      TEXT,
  banned_by   TEXT        NOT NULL,
  banned_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,  -- NULL = permanent ban
  UNIQUE(ip)
);

-- RLS for banned_ips
ALTER TABLE public.banned_ips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin read banned ips" ON public.banned_ips;
DROP POLICY IF EXISTS "Admin manage banned ips" ON public.banned_ips;
CREATE POLICY "Admin read banned ips" ON public.banned_ips FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin'))
);
CREATE POLICY "Admin manage banned ips" ON public.banned_ips FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin'))
);

-- ── Tabella utenti silenziati (muted) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.muted_users (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  room_id     TEXT        NULL,  -- NULL = global mute (tutte le stanze), TEXT = mute solo in quella stanza
  muted_by    TEXT        NOT NULL,
  muted_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,  -- NULL = permanent mute
  UNIQUE(user_id, room_id)  -- Un utente può essere mutato globalmente O per stanza
);

-- Add room_id column to existing muted_users table (safe to run on already-created tables)
ALTER TABLE public.muted_users ADD COLUMN IF NOT EXISTS room_id TEXT NULL;

-- Drop old unique constraint if exists and recreate with room_id
DO $$
BEGIN
  -- Drop old unique constraint on user_id if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'muted_users_user_id_key' 
    AND conrelid = 'public.muted_users'::regclass
  ) THEN
    ALTER TABLE public.muted_users DROP CONSTRAINT muted_users_user_id_key;
  END IF;
  
  -- Add new unique constraint on (user_id, room_id) if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'muted_users_user_id_room_id_key' 
    AND conrelid = 'public.muted_users'::regclass
  ) THEN
    ALTER TABLE public.muted_users ADD CONSTRAINT muted_users_user_id_room_id_key UNIQUE (user_id, room_id);
  END IF;
END $$;

-- RLS for muted_users
ALTER TABLE public.muted_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read muted users" ON public.muted_users;
DROP POLICY IF EXISTS "Admin manage muted users" ON public.muted_users;
CREATE POLICY "Public read muted users" ON public.muted_users FOR SELECT USING (true);
CREATE POLICY "Admin manage muted users" ON public.muted_users FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin', 'moderator'))
);

-- ── Indici ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);
CREATE INDEX IF NOT EXISTS banned_users_user_id_idx ON public.banned_users (user_id);
CREATE INDEX IF NOT EXISTS banned_users_expires_at_idx ON public.banned_users (expires_at);
CREATE INDEX IF NOT EXISTS kicked_users_user_id_idx ON public.kicked_users (user_id);
CREATE INDEX IF NOT EXISTS kicked_users_room_id_idx ON public.kicked_users (room_id);
CREATE INDEX IF NOT EXISTS kicked_users_expires_at_idx ON public.kicked_users (expires_at);
CREATE INDEX IF NOT EXISTS muted_users_user_id_idx ON public.muted_users (user_id);
CREATE INDEX IF NOT EXISTS muted_users_room_id_idx ON public.muted_users (room_id);
CREATE INDEX IF NOT EXISTS muted_users_expires_at_idx ON public.muted_users (expires_at);

-- ── Funzione per verificare se un IP è bannato ────────────────
CREATE OR REPLACE FUNCTION public.is_ip_banned(ip_to_check TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.banned_ips
    WHERE (expires_at IS NULL OR expires_at > NOW())
      AND (
        ip_to_check = ip  -- Exact match
        OR ip_to_check LIKE ip || '%'  -- CIDR range match (simplified)
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
