-- ================================================================
--  NeverVideoChat — Active Sessions Table
--  Traccia la sessione attiva per ogni utente
--  Solo la sessione più recente può scrivere/operare
-- ================================================================

-- ── Tabella sessioni attive ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.active_sessions (
  user_id     TEXT        NOT NULL PRIMARY KEY,
  session_id  TEXT        NOT NULL,  -- JWT token ID o hash univoco della sessione
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indice per ricerche rapide
CREATE INDEX IF NOT EXISTS active_sessions_user_id_idx ON public.active_sessions (user_id);
CREATE INDEX IF NOT EXISTS active_sessions_session_id_idx ON public.active_sessions (session_id);

-- RLS per active_sessions
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active sessions" ON public.active_sessions;
DROP POLICY IF EXISTS "Public upsert own session" ON public.active_sessions;

-- Chiunque può leggere (per verificare se la propria sessione è valida)
CREATE POLICY "Public read active sessions"
  ON public.active_sessions FOR SELECT
  USING (true);

-- Chiunque può aggiornare la propria sessione (upsert)
CREATE POLICY "Public upsert own session"
  ON public.active_sessions FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- ── Funzione per aggiornare/creare sessione attiva ────────────
-- Questa funzione sovrascrive automaticamente la vecchia sessione
-- SECURITY DEFINER permette di bypassare RLS per garantire che funzioni sempre
CREATE OR REPLACE FUNCTION public.upsert_active_session(p_user_id TEXT, p_session_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Inserisci o aggiorna la sessione attiva
  -- Se esiste già una sessione per questo utente, viene sovrascritta
  INSERT INTO public.active_sessions (user_id, session_id, updated_at)
  VALUES (p_user_id, p_session_id, NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET
    session_id = p_session_id,
    updated_at = NOW();
END;
$$;

-- ── Funzione per verificare se una sessione è valida ──────────
CREATE OR REPLACE FUNCTION public.is_session_valid(p_user_id TEXT, p_session_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_valid_session_id TEXT;
BEGIN
  SELECT session_id INTO v_valid_session_id
  FROM public.active_sessions
  WHERE user_id = p_user_id;
  
  IF v_valid_session_id IS NULL THEN
    -- Nessuna sessione registrata, considera valida (primo login)
    RETURN TRUE;
  END IF;
  
  -- La sessione è valida solo se corrisponde a quella registrata
  RETURN v_valid_session_id = p_session_id;
END;
$$;

-- ── Trigger per aggiornare updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION public.update_active_sessions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS active_sessions_updated_at_trigger ON public.active_sessions;
CREATE TRIGGER active_sessions_updated_at_trigger
  BEFORE UPDATE ON public.active_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_active_sessions_updated_at();
