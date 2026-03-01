-- ================================================================
--  NeverVideoChat — Profiles Table
--  Esegui nell'SQL Editor di Supabase:
--  Dashboard → SQL Editor → New query → incolla → Run
--
--  Prerequisito: aver già eseguito supabase_schema.sql
-- ================================================================

-- ── Tabella profili utenti registrati ────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id           TEXT        PRIMARY KEY,   -- Supabase Auth UUID
  username     TEXT        UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  is_guest     BOOLEAN     DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read profiles"  ON public.profiles;
DROP POLICY IF EXISTS "Any insert profile"    ON public.profiles;
DROP POLICY IF EXISTS "Any update profile"    ON public.profiles;

-- Chiunque può leggere i profili
CREATE POLICY "Public read profiles"
  ON public.profiles FOR SELECT
  USING (true);

-- Chiunque può creare il proprio profilo (autenticazione gestita lato app)
CREATE POLICY "Any insert profile"
  ON public.profiles FOR INSERT
  WITH CHECK (true);

-- Chiunque può aggiornare il proprio profilo
CREATE POLICY "Any update profile"
  ON public.profiles FOR UPDATE
  USING (true);

-- ── Indice per ricerche rapide per username ───────────────────
DROP INDEX IF EXISTS profiles_username_idx;
CREATE INDEX IF NOT EXISTS profiles_username_idx
  ON public.profiles (username);
