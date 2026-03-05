-- ================================================================
--  NeverVideoChat — Admin Extensions Schema
--  Esegui nell'SQL Editor di Supabase dopo supabase_schema.sql
-- ================================================================

-- ── Tabella log azioni admin ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id    TEXT        NOT NULL,
  admin_name  TEXT        NOT NULL,
  action      TEXT        NOT NULL,  -- 'ban', 'mute', 'kick', 'delete_message', 'edit_message', 'create_room', etc.
  target_type TEXT,                   -- 'user', 'message', 'room', 'role', etc.
  target_id   TEXT,                   -- ID dell'oggetto target
  target_name TEXT,                    -- Nome/descrizione del target
  details     JSONB       DEFAULT '{}'::jsonb,  -- Dettagli aggiuntivi
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_logs_admin_id_idx ON public.admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS admin_logs_action_idx ON public.admin_logs(action);
CREATE INDEX IF NOT EXISTS admin_logs_created_at_idx ON public.admin_logs(created_at DESC);

-- RLS for admin_logs
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read admin_logs" ON public.admin_logs;
DROP POLICY IF EXISTS "Admin insert admin_logs" ON public.admin_logs;

CREATE POLICY "Public read admin_logs" ON public.admin_logs FOR SELECT USING (true);
CREATE POLICY "Admin insert admin_logs" ON public.admin_logs FOR INSERT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin'))
);

-- ── Tabella annunci globali ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  type        TEXT        DEFAULT 'info',  -- 'info', 'warning', 'success', 'error'
  is_active   BOOLEAN     DEFAULT true,
  is_persistent BOOLEAN   DEFAULT false,   -- Se true, mostra sempre come banner
  priority    INTEGER     DEFAULT 0,       -- Ordine di visualizzazione
  created_by  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ                  -- NULL = non scade mai
);

CREATE INDEX IF NOT EXISTS announcements_is_active_idx ON public.announcements(is_active, priority DESC);
CREATE INDEX IF NOT EXISTS announcements_expires_at_idx ON public.announcements(expires_at);

-- RLS for announcements
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admin manage announcements" ON public.announcements;

CREATE POLICY "Public read announcements" ON public.announcements FOR SELECT USING (
  is_active = true AND (expires_at IS NULL OR expires_at > NOW())
);
CREATE POLICY "Admin manage announcements" ON public.announcements FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin'))
);

-- ── Tabella messaggi segnalati ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reported_messages (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id  UUID        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  reported_by TEXT        NOT NULL,
  reason      TEXT,
  status      TEXT        DEFAULT 'pending',  -- 'pending', 'reviewed', 'resolved', 'dismissed'
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reported_messages_message_id_idx ON public.reported_messages(message_id);
CREATE INDEX IF NOT EXISTS reported_messages_status_idx ON public.reported_messages(status);
CREATE INDEX IF NOT EXISTS reported_messages_created_at_idx ON public.reported_messages(created_at DESC);

-- RLS for reported_messages
ALTER TABLE public.reported_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public insert reported_messages" ON public.reported_messages;
DROP POLICY IF EXISTS "Admin read reported_messages" ON public.reported_messages;
DROP POLICY IF EXISTS "Admin update reported_messages" ON public.reported_messages;

CREATE POLICY "Public insert reported_messages" ON public.reported_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin read reported_messages" ON public.reported_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin', 'moderator'))
);
CREATE POLICY "Admin update reported_messages" ON public.reported_messages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role IN ('owner', 'admin', 'moderator'))
);

-- ── Aggiungi colonne per moderazione messaggi ─────────────────
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_by TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS original_content TEXT;  -- Per edit history

-- ── Crea ruoli predefiniti se non esistono ──────────────────────
INSERT INTO public.custom_roles (id, name, color, permissions) VALUES
  ('owner', 'Owner', '#ff6b6b', '{
    "can_ban": true,
    "can_mute": true,
    "can_kick": true,
    "can_delete_messages": true,
    "can_edit_messages": true,
    "can_manage_rooms": true,
    "can_manage_users": true,
    "can_manage_roles": true,
    "can_view_logs": true,
    "can_manage_announcements": true,
    "can_view_statistics": true,
    "can_post_messages": true
  }'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.custom_roles (id, name, color, permissions) VALUES
  ('admin', 'Admin', '#4ecdc4', '{
    "can_ban": true,
    "can_mute": true,
    "can_kick": true,
    "can_delete_messages": true,
    "can_edit_messages": true,
    "can_manage_rooms": true,
    "can_manage_users": true,
    "can_manage_roles": false,
    "can_view_logs": true,
    "can_manage_announcements": true,
    "can_view_statistics": true,
    "can_post_messages": true
  }'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.custom_roles (id, name, color, permissions) VALUES
  ('moderator', 'Moderator', '#95e1d3', '{
    "can_ban": false,
    "can_mute": true,
    "can_kick": true,
    "can_delete_messages": true,
    "can_edit_messages": false,
    "can_manage_rooms": false,
    "can_manage_users": false,
    "can_manage_roles": false,
    "can_view_logs": true,
    "can_manage_announcements": false,
    "can_view_statistics": true,
    "can_post_messages": true
  }'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.custom_roles (id, name, color, permissions) VALUES
  ('user', 'User', '#8b949e', '{
    "can_ban": false,
    "can_mute": false,
    "can_kick": false,
    "can_delete_messages": false,
    "can_edit_messages": false,
    "can_manage_rooms": false,
    "can_manage_users": false,
    "can_manage_roles": false,
    "can_view_logs": false,
    "can_manage_announcements": false,
    "can_view_statistics": false,
    "can_post_messages": true
  }'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── Abilita Realtime per le nuove tabelle ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'announcements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
  END IF;
END $$;
