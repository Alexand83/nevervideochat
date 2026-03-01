-- ================================================================
--  NeverVideoChat — Storage policies per il bucket "chat-media"
--
--  REQUISITO: il bucket "chat-media" deve esistere già.
--  Se non l'hai ancora creato:
--    Dashboard → Storage → New Bucket
--    Name: chat-media   |   Public: ✅ ON   → Save
--
--  Poi incolla QUESTO file nell'SQL Editor → Run
-- ================================================================

DROP POLICY IF EXISTS "Public read chat-media"   ON storage.objects;
DROP POLICY IF EXISTS "Public upload chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Owner delete chat-media"  ON storage.objects;

-- Lettura pubblica (SELECT): chiunque può scaricare i file
CREATE POLICY "Public read chat-media"
  ON storage.objects FOR SELECT
  TO public
  USING ( bucket_id = 'chat-media' );

-- Upload anonimo (INSERT): chiunque può caricare con la anon key
CREATE POLICY "Public upload chat-media"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK ( bucket_id = 'chat-media' );

-- Cancellazione (DELETE): chi ha caricato può eliminare
CREATE POLICY "Owner delete chat-media"
  ON storage.objects FOR DELETE
  TO anon, authenticated
  USING ( bucket_id = 'chat-media' );
