/*
  # Create Anchor App Schema

  1. New Tables
    - `profiles` - User profile with name and language preference
      - `id` (uuid, primary key, references auth.users)
      - `full_name` (text)
      - `preferred_language` (text, default 'en')
      - `created_at` (timestamptz)
    - `daily_anchors` - Daily tasks and intentions
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `date` (date)
      - `future_task` (text)
      - `future_completed` (boolean, default false)
      - `mindbody_task` (text)
      - `mindbody_completed` (boolean, default false)
      - `life_task` (text)
      - `life_completed` (boolean, default false)
      - `daily_intention` (text)
      - `created_at` (timestamptz)
    - `mood_logs` - Daily mood tracking
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `date` (date)
      - `mood` (text)
      - `timestamp` (timestamptz)
    - `check_ins` - Reflection journal entries
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `date` (date)
      - `what_matters` (text)
      - `what_avoiding` (text)
      - `what_felt_real` (text)
      - `voice_note_url` (text, nullable)
      - `evening_release` (text)
      - `created_at` (timestamptz)
    - `move_suggestions` - Movement/action suggestions
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `title` (text)
      - `category` (text)
      - `is_custom` (boolean, default false)
      - `created_at` (timestamptz)
    - `ai_insights` - Rule-based insight cache
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `insight_text` (text)
      - `category` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Users can only access their own data
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  preferred_language text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Daily Anchors table
CREATE TABLE IF NOT EXISTS daily_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  future_task text NOT NULL DEFAULT '',
  future_completed boolean NOT NULL DEFAULT false,
  mindbody_task text NOT NULL DEFAULT '',
  mindbody_completed boolean NOT NULL DEFAULT false,
  life_task text NOT NULL DEFAULT '',
  life_completed boolean NOT NULL DEFAULT false,
  daily_intention text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE daily_anchors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own anchors"
  ON daily_anchors FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own anchors"
  ON daily_anchors FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own anchors"
  ON daily_anchors FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Mood Logs table
CREATE TABLE IF NOT EXISTS mood_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  mood text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mood_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own mood logs"
  ON mood_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mood logs"
  ON mood_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mood logs"
  ON mood_logs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Check-Ins table
CREATE TABLE IF NOT EXISTS check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  what_matters text NOT NULL DEFAULT '',
  what_avoiding text NOT NULL DEFAULT '',
  what_felt_real text NOT NULL DEFAULT '',
  voice_note_url text,
  evening_release text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own check-ins"
  ON check_ins FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own check-ins"
  ON check_ins FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own check-ins"
  ON check_ins FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Move Suggestions table
CREATE TABLE IF NOT EXISTS move_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE move_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own move suggestions"
  ON move_suggestions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own move suggestions"
  ON move_suggestions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own move suggestions"
  ON move_suggestions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- AI Insights table
CREATE TABLE IF NOT EXISTS ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_text text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own insights"
  ON ai_insights FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insights"
  ON ai_insights FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own insights"
  ON ai_insights FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
