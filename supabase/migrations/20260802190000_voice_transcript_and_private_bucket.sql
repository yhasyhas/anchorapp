/*
  # Voice transcription: check_ins.voice_transcript + private voice-notes bucket

  1. Changes
    - `check_ins.voice_transcript` (text, nullable) — Groq Whisper transcript
      of the recorded voice note (voice_note_url), populated client-side at
      save time via api/transcribe.ts. Nullable/absent transcription never
      blocks saving the check-in itself (graceful fallback).

  2. Storage security
    - Ensures the `voice-notes` bucket exists and is explicitly private
      (public = false). Voice recordings are intimate personal data —
      playback must go through short-lived signed URLs generated on demand
      (see checkin.tsx), never a permanent public URL.
    - Adds owner-scoped RLS policies on storage.objects for this bucket:
      SELECT/INSERT/UPDATE/DELETE restricted to the authenticated user whose
      id matches the first path segment (checkin.tsx uploads to
      `${user.id}/${date}.webm`, i.e. one folder per user — same convention
      as every other user-scoped table in this schema).
    - DROP POLICY IF EXISTS before each CREATE for idempotency. Note: if the
      `voice-notes` bucket was originally set up by hand in the dashboard
      with its own differently-named policies, those aren't touched by this
      migration (unknown names can't be dropped blindly) — worth a manual
      check in Storage → Policies to confirm nothing broader than this
      remains.
*/

ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS voice_transcript text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-notes', 'voice-notes', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Users can upload own voice notes" ON storage.objects;
CREATE POLICY "Users can upload own voice notes"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can read own voice notes" ON storage.objects;
CREATE POLICY "Users can read own voice notes"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can update own voice notes" ON storage.objects;
CREATE POLICY "Users can update own voice notes"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete own voice notes" ON storage.objects;
CREATE POLICY "Users can delete own voice notes"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);
