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

DROP POLICY IF EXISTS "Public read messages"    ON public.messages;
DROP POLICY IF EXISTS "Public insert messages"  ON public.messages;
DROP POLICY IF EXISTS "Public update messages"  ON public.messages;

CREATE POLICY "Public read messages"
  ON public.messages FOR SELECT
  USING (true);

CREATE POLICY "Public insert messages"
  ON public.messages FOR INSERT
  WITH CHECK (true);

-- Needed for reaction updates (toggleReaction writes back the reactions JSONB column)
CREATE POLICY "Public update messages"
  ON public.messages FOR UPDATE
  USING (true)
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
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'it'; -- 'it', 'en', 'es', 'de'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS theme_id TEXT DEFAULT 'dark'; -- Reference to themes table

-- ── Tabella stanze (gestite da admin) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.rooms (
  id          SERIAL      PRIMARY KEY,
  name        TEXT        NOT NULL,
  icon        TEXT        DEFAULT '💬',
  is_open     BOOLEAN     DEFAULT true,
  password    TEXT,       -- NULL = no password, TEXT = hashed password
  max_cams    INTEGER     DEFAULT NULL, -- NULL = no limit, 1-8 for special rooms like "Eventi"
  created_by  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Migrazione: Se la tabella esiste già con id TEXT, convertila a SERIAL ──
DO $$
DECLARE
  col_type TEXT;
  row_count INTEGER;
  max_id_val INTEGER;
BEGIN
  -- Verifica il tipo della colonna id
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' 
    AND table_name = 'rooms' 
    AND column_name = 'id';
  
  -- Se esiste ed è TEXT, convertila a INTEGER (SERIAL)
  IF col_type = 'text' THEN
    -- Conta le righe esistenti
    SELECT COUNT(*) INTO row_count FROM public.rooms;
    
    -- Se ci sono dati, dobbiamo fare una migrazione più complessa
    IF row_count > 0 THEN
      -- 1. Aggiungi colonna temporanea id_new INTEGER
      ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS id_new INTEGER;
      
      -- 2. Popola id_new con valori sequenziali basati sull'ordine di creazione
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as new_id
        FROM public.rooms
      )
      UPDATE public.rooms r
      SET id_new = n.new_id
      FROM numbered n
      WHERE r.id = n.id;
      
      -- 3. Ottieni il valore massimo per la sequenza
      SELECT COALESCE(MAX(id_new), 0) INTO max_id_val FROM public.rooms;
      
      -- 4. Crea sequenza e imposta il prossimo valore
      DROP SEQUENCE IF EXISTS rooms_id_seq;
      EXECUTE format('CREATE SEQUENCE rooms_id_seq START WITH %s', max_id_val + 1);
      
      -- 5. Rimuovi constraint e colonna vecchia
      ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_pkey;
      ALTER TABLE public.rooms DROP COLUMN id;
      
      -- 6. Rinomina id_new a id e imposta come PRIMARY KEY
      ALTER TABLE public.rooms RENAME COLUMN id_new TO id;
      ALTER TABLE public.rooms ALTER COLUMN id SET NOT NULL;
      ALTER TABLE public.rooms ADD PRIMARY KEY (id);
      
      -- 7. Collega la sequenza alla colonna
      ALTER TABLE public.rooms ALTER COLUMN id SET DEFAULT nextval('rooms_id_seq');
      ALTER SEQUENCE rooms_id_seq OWNED BY public.rooms.id;
    ELSE
      -- Se non ci sono dati, è più semplice: elimina e ricrea
      DROP TABLE IF EXISTS public.rooms CASCADE;
      CREATE TABLE public.rooms (
        id          SERIAL      PRIMARY KEY,
        name        TEXT        NOT NULL,
        icon        TEXT        DEFAULT '💬',
        is_open     BOOLEAN     DEFAULT true,
        password    TEXT,
        created_by  TEXT        NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    END IF;
  END IF;
END $$;

-- RLS for rooms
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read rooms" ON public.rooms;
DROP POLICY IF EXISTS "Admin manage rooms" ON public.rooms;
CREATE POLICY "Public read rooms" ON public.rooms FOR SELECT USING (true);
CREATE POLICY "Admin manage rooms" ON public.rooms FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin'))
);

-- ── Crea stanza "general" di default ─────────────────────────
-- Note: Se la tabella è nuova, inserisce general con id=1
-- Se esiste già, usa INSERT ... ON CONFLICT per evitare duplicati
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE name = 'General' AND created_by = 'system') THEN
    INSERT INTO public.rooms (name, icon, is_open, created_by)
    VALUES ('General', '💬', true, 'system');
  END IF;
END $$;

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

-- Migrate existing data: set room_id to NULL for existing records (they become global mutes)
UPDATE public.muted_users SET room_id = NULL WHERE room_id IS NULL;

-- Drop old unique constraint on user_id if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'muted_users_user_id_key' 
    AND conrelid = 'public.muted_users'::regclass
  ) THEN
    ALTER TABLE public.muted_users DROP CONSTRAINT muted_users_user_id_key;
  END IF;
END $$;

-- Add new unique constraint on (user_id, room_id) if it doesn't exist
-- Note: This allows one global mute (room_id = NULL) and multiple room-specific mutes per user
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'muted_users_user_id_room_id_key' 
    AND conrelid = 'public.muted_users'::regclass
  ) THEN
    -- First, handle any duplicates by keeping only one
    DELETE FROM public.muted_users a
    USING public.muted_users b
    WHERE a.id < b.id 
      AND a.user_id = b.user_id 
      AND (a.room_id = b.room_id OR (a.room_id IS NULL AND b.room_id IS NULL));
    
    -- Now add the constraint
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

-- ── Tabella temi (themes) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.themes (
  id          TEXT        PRIMARY KEY,  -- 'dark', 'light', 'blue', 'purple'
  name        TEXT        NOT NULL,
  display_name TEXT       NOT NULL,     -- Nome visualizzato
  colors      JSONB       NOT NULL,     -- { "bg0": "#0d1117", "bg1": "#161b22", ... }
  is_default  BOOLEAN     DEFAULT false,
  is_custom   BOOLEAN     DEFAULT false, -- true = uploaded by admin
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default themes
INSERT INTO public.themes (id, name, display_name, colors, is_default) VALUES
  ('dark', 'Dark', 'Dark Theme', '{
    "bg0": "#0d1117", "bg1": "#161b22", "bg2": "#21262d", "bg3": "#2d333b", "bg-hover": "#30363d",
    "border": "#30363d", "border-subtle": "#21262d",
    "tx0": "#e6edf3", "tx1": "#8b949e", "tx2": "#484f58", "tx-link": "#58a6ff",
    "accent": "#1f6feb", "accent-h": "#388bfd", "accent-dim": "rgba(31,111,235,.18)",
    "clr-danger": "#da3633", "clr-danger-h": "#f85149",
    "clr-success": "#238636", "clr-success-h": "#2ea043",
    "clr-online": "#3fb950", "clr-offline": "#484f58",
    "bubble-own": "#1a3f6f", "bubble-other": "#21262d"
  }'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.themes (id, name, display_name, colors, is_default) VALUES
  ('light', 'Light', 'Light Theme', '{
    "bg0": "#ffffff", "bg1": "#f6f8fa", "bg2": "#e1e4e8", "bg3": "#d1d5da", "bg-hover": "#c6cbd1",
    "border": "#d1d5da", "border-subtle": "#e1e4e8",
    "tx0": "#24292e", "tx1": "#586069", "tx2": "#959da5", "tx-link": "#0366d6",
    "accent": "#0366d6", "accent-h": "#005cc5", "accent-dim": "rgba(3,102,214,.1)",
    "clr-danger": "#d73a49", "clr-danger-h": "#cb2431",
    "clr-success": "#28a745", "clr-success-h": "#22863a",
    "clr-online": "#28a745", "clr-offline": "#959da5",
    "bubble-own": "#c8e1ff", "bubble-other": "#f1f3f5"
  }'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.themes (id, name, display_name, colors, is_default) VALUES
  ('blue', 'Blue', 'Blue Theme', '{
    "bg0": "#0a1929", "bg1": "#132f4c", "bg2": "#1e4976", "bg3": "#2a5a8a", "bg-hover": "#35699e",
    "border": "#2a5a8a", "border-subtle": "#1e4976",
    "tx0": "#e3f2fd", "tx1": "#90caf9", "tx2": "#64b5f6", "tx-link": "#42a5f5",
    "accent": "#2196f3", "accent-h": "#1e88e5", "accent-dim": "rgba(33,150,243,.2)",
    "clr-danger": "#f44336", "clr-danger-h": "#e53935",
    "clr-success": "#4caf50", "clr-success-h": "#43a047",
    "clr-online": "#4caf50", "clr-offline": "#64b5f6",
    "bubble-own": "#1565c0", "bubble-other": "#1e4976"
  }'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.themes (id, name, display_name, colors, is_default) VALUES
  ('purple', 'Purple', 'Purple Theme', '{
    "bg0": "#1a1a2e", "bg1": "#16213e", "bg2": "#0f3460", "bg3": "#533483", "bg-hover": "#6a4c93",
    "border": "#533483", "border-subtle": "#0f3460",
    "tx0": "#e8eaf6", "tx1": "#c5cae9", "tx2": "#9fa8da", "tx-link": "#7986cb",
    "accent": "#9c27b0", "accent-h": "#8e24aa", "accent-dim": "rgba(156,39,176,.2)",
    "clr-danger": "#e91e63", "clr-danger-h": "#c2185b",
    "clr-success": "#4caf50", "clr-success-h": "#43a047",
    "clr-online": "#4caf50", "clr-offline": "#9fa8da",
    "bubble-own": "#6a1b9a", "bubble-other": "#0f3460"
  }'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

-- RLS for themes
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read themes" ON public.themes;
DROP POLICY IF EXISTS "Admin manage themes" ON public.themes;
CREATE POLICY "Public read themes" ON public.themes FOR SELECT USING (true);
CREATE POLICY "Admin manage themes" ON public.themes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin'))
);

-- Add column to rooms for max_cams
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS max_cams INTEGER DEFAULT NULL;

-- Add column to rooms for is_games_room
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS is_games_room BOOLEAN DEFAULT FALSE;

-- ── Tabella giochi attivi ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.active_games (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id     TEXT        NOT NULL UNIQUE,  -- UNIQUE: una stanza può avere solo un gioco attivo
  game_type   TEXT        NOT NULL,  -- 'song', 'truth_lie', 'quiz'
  game_state  JSONB       DEFAULT '{}'::jsonb,  -- stato del gioco (domande, risposte, timer, etc.)
  host_id     TEXT        NOT NULL,  -- chi ha avviato il gioco
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  ended_at    TIMESTAMPTZ DEFAULT NULL,
  is_active   BOOLEAN     DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS active_games_room_id_idx ON public.active_games (room_id);
CREATE INDEX IF NOT EXISTS active_games_is_active_idx ON public.active_games (is_active);

-- RLS for active_games
ALTER TABLE public.active_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read active games" ON public.active_games;
DROP POLICY IF EXISTS "Public insert active games" ON public.active_games;
DROP POLICY IF EXISTS "Public update active games" ON public.active_games;

CREATE POLICY "Public read active games" ON public.active_games FOR SELECT USING (true);
CREATE POLICY "Public insert active games" ON public.active_games FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update active games" ON public.active_games FOR UPDATE USING (true) WITH CHECK (true);

-- ── Tabella punteggi giochi ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_scores (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  username    TEXT        NOT NULL,
  room_id     TEXT        NOT NULL,
  game_type   TEXT        NOT NULL,  -- 'song', 'truth_lie', 'quiz'
  score       INTEGER     DEFAULT 0,
  games_played INTEGER    DEFAULT 0,
  wins        INTEGER     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, room_id, game_type)
);

CREATE INDEX IF NOT EXISTS game_scores_user_id_idx ON public.game_scores (user_id);
CREATE INDEX IF NOT EXISTS game_scores_room_id_idx ON public.game_scores (room_id);
CREATE INDEX IF NOT EXISTS game_scores_game_type_idx ON public.game_scores (game_type);
CREATE INDEX IF NOT EXISTS game_scores_score_idx ON public.game_scores (score DESC);

-- RLS for game_scores
ALTER TABLE public.game_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read game scores" ON public.game_scores;
DROP POLICY IF EXISTS "Public insert game scores" ON public.game_scores;
DROP POLICY IF EXISTS "Public update game scores" ON public.game_scores;

CREATE POLICY "Public read game scores" ON public.game_scores FOR SELECT USING (true);
CREATE POLICY "Public insert game scores" ON public.game_scores FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update game scores" ON public.game_scores FOR UPDATE USING (true) WITH CHECK (true);

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
