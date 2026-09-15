/*
  # Daily awe thought — one small fact/perspective per day, on Home

  A single short, factual, wonder-inducing thought shown once per day per
  user (Today's Awe, reduced from the original Discover concept into one
  simple, unbrowseable thing rather than a content library). Never a
  library to scroll: one thought, one day, no "next" affordance.

  1. New Tables
    - `awe_thoughts` — the shared, curated catalog. Not user-owned data —
      every authenticated user reads the same rows (see Security below) —
      so this is a reference/content table, not per-user like the rest of
      this schema.
      - `id` (uuid, primary key)
      - `category` (text) — one of a small fixed set (psychology, nature,
        philosophy, art, space, people), CHECK-constrained rather than a
        real Postgres ENUM — same convention as mood_logs.mood,
        daily_suggestions.status, move_suggestions.category/intensity
        elsewhere in this schema (a CHECK is trivially extendable without
        an ALTER TYPE migration).
      - `content_en` / `content_sw` (text) — both languages stored side by
        side on the same row, same convention as custom_intentions'
        label_en/label_sw. Static seed content in this app is otherwise
        kept as hardcoded i18n-driven arrays (see checkin-questions.ts,
        journal-questions.ts, Move's static pool) rather than DB rows, but
        this content needs a stable DB id for awe_thought_shown to
        reference and for the catalog to grow later without an app
        release — so it's a real table, translated the same way
        custom_intentions is.
      - `source_note` (text, nullable) — short attribution when relevant;
        most seed rows have none, the fact speaks for itself.
      - `created_at` (timestamptz)

    - `awe_thought_shown` — one row per user per day (UNIQUE on
      user_id,date), same upserted-daily-row shape as daily_suggestions.
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, ON DELETE CASCADE)
      - `awe_thought_id` (uuid, references awe_thoughts, ON DELETE CASCADE
        — if a seed row is ever removed, her history entry for that day
        simply goes with it; there's no separate "text snapshot" column
        here since, unlike daily_suggestions, this catalog is admin-curated
        and not expected to be edited/deleted out from under existing rows)
      - `date` (date, default CURRENT_DATE)
      - `opened` (boolean, default false) — set true as soon as the card
        is seen (component mount), whether or not she lingers on it; there
        is nothing further to "open" since the thought is shown in full
        directly on the card, so this is a lightweight seen-flag rather
        than a real open/detail action.
      - `created_at` (timestamptz)

  2. Security
    - `awe_thoughts`: RLS enabled, one SELECT policy open to any
      authenticated user (true) — it's shared reference content, the same
      shape a public content catalog would take. No INSERT/UPDATE/DELETE
      policy: the catalog is managed via migrations only, never from the
      client.
    - `awe_thought_shown`: RLS enabled, standard per-user SELECT/INSERT/
      UPDATE (auth.uid() = user_id) — the usual shape used throughout this
      schema. UPDATE is needed to flip opened to true after the day's row
      already exists. No DELETE policy, same as daily_suggestions.
*/

CREATE TABLE IF NOT EXISTS awe_thoughts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('psychology', 'nature', 'philosophy', 'art', 'space', 'people')),
  content_en text NOT NULL,
  content_sw text NOT NULL,
  source_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE awe_thoughts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any authenticated user can read the awe thoughts catalog"
  ON awe_thoughts FOR SELECT
  TO authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS awe_thought_shown (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  awe_thought_id uuid NOT NULL REFERENCES awe_thoughts(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  opened boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE awe_thought_shown ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own shown awe thoughts"
  ON awe_thought_shown FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own shown awe thoughts"
  ON awe_thought_shown FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shown awe thoughts"
  ON awe_thought_shown FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ==================== SEED: 30 thoughts, 5 per category ====================
-- Factual and verifiable, not pseudo-science, not generic motivational
-- copy — each one is a real, checkable fact chosen for a small jolt of
-- perspective or wonder.

INSERT INTO awe_thoughts (category, content_en, content_sw) VALUES
-- Psychology
('psychology', 'The brain uses about 20% of the body''s energy despite being only 2% of its weight.', 'Ubongo hutumia karibu 20% ya nishati ya mwili ingawa ni 2% tu ya uzito wake.'),
('psychology', 'Every time you recall a memory, your brain reconstructs it slightly differently than the last time.', 'Kila unapokumbuka kumbukumbu, ubongo wako huijenga upya kwa tofauti kidogo kuliko mara iliyopita.'),
('psychology', 'Newborns can recognize their mother''s voice within hours of being born.', 'Watoto wachanga wanaweza kutambua sauti ya mama yao ndani ya masaa machache tangu kuzaliwa.'),
('psychology', 'People tend to remember interrupted tasks better than completed ones — psychologists call it the Zeigarnik effect.', 'Watu huwa wanakumbuka kazi zilizokatizwa vizuri zaidi kuliko zilizokamilika — wanasaikolojia huita hili "athari ya Zeigarnik".'),
('psychology', 'Yawning is contagious even across species — dogs often yawn when they see their owners yawn.', 'Kupiga miayo huambukiza hata kati ya viumbe tofauti — mbwa mara nyingi hupiga miayo wanapoona wamiliki wao wakipiga miayo.'),
-- Nature
('nature', 'Trees can communicate and share nutrients through underground fungal networks.', 'Miti inaweza kuwasiliana na kugawana virutubisho kupitia mitandao ya fangasi chini ya ardhi.'),
('nature', 'Octopuses have three hearts and blue blood.', 'Pweza wana mioyo mitatu na damu ya bluu.'),
('nature', 'A teaspoon of healthy soil can contain billions of microorganisms — more than there are people on Earth.', 'Kijiko kimoja cha udongo wenye afya kinaweza kuwa na mabilioni ya viumbe vidogo — zaidi ya idadi ya watu duniani.'),
('nature', 'Some jellyfish are biologically immortal — they can reverse their aging process under stress.', 'Baadhi ya jellyfish hawafi kwa uzee kibiolojia — wanaweza kurudisha nyuma mchakato wao wa kuzeeka wanapokabiliwa na msongo.'),
('nature', 'Honey found in ancient Egyptian tombs thousands of years old is still edible.', 'Asali iliyopatikana kwenye makaburi ya kale ya Misri, yenye maelfu ya miaka, bado inalika.'),
-- Philosophy
('philosophy', 'The Ship of Theseus asks whether an object that has had all its parts replaced remains the same object.', 'Fumbo la "Meli ya Theseus" linauliza kama kitu ambacho sehemu zake zote zimebadilishwa bado ni kile kile kitu.'),
('philosophy', 'Socrates claimed to know nothing, yet he was called the wisest man in Athens for admitting it.', 'Socrates alidai kutojua chochote, lakini aliitwa mtu mwenye hekima zaidi Athens kwa kukubali hilo.'),
('philosophy', 'Stoic philosophers taught that we suffer more in imagination than in reality.', 'Wanafalsafa wa Stoiki walifundisha kwamba tunateseka zaidi kwa mawazo kuliko uhalisia wenyewe.'),
('philosophy', 'The word "philosophy" comes from the Greek for "love of wisdom."', 'Neno "falsafa" linatokana na neno la Kigiriki lenye maana ya "kupenda hekima".'),
('philosophy', 'Descartes tried to doubt everything he could, and found that the very act of doubting proved he existed.', 'Descartes alijaribu kutilia shaka kila kitu alichoweza, na akagundua kwamba kitendo cha kutilia shaka chenyewe kilithibitisha kuwa alikuwepo.'),
-- Art
('art', 'Leonardo da Vinci''s notebooks contain more scientific observation than finished paintings.', 'Madaftari ya Leonardo da Vinci yana maelezo mengi zaidi ya kisayansi kuliko michoro iliyokamilika.'),
('art', 'The Mona Lisa has no eyebrows — it was fashionable in Renaissance Florence to shave them.', 'Mona Lisa hana nyusi — ilikuwa mtindo huko Florence wakati wa Renaissance kunyoa nyusi.'),
('art', 'Vincent van Gogh sold only one painting during his lifetime.', 'Vincent van Gogh aliuza mchoro mmoja tu katika maisha yake yote.'),
('art', 'Japanese kintsugi repairs broken pottery with gold, treating the break as part of the object''s history.', 'Sanaa ya kintsugi ya Kijapani hutengeneza vyombo vilivyovunjika kwa dhahabu, ikichukulia mvunjiko kama sehemu ya historia ya kitu hicho.'),
('art', 'The oldest known cave paintings are over 40,000 years old.', 'Michoro ya kale zaidi iliyojulikana kwenye mapango ina zaidi ya miaka 40,000.'),
-- Space
('space', 'The atoms in your body were forged inside stars that exploded billions of years ago.', 'Atomi zilizoko mwilini mwako ziliundwa ndani ya nyota zilizolipuka mabilioni ya miaka iliyopita.'),
('space', 'A day on Venus is longer than its year.', 'Siku moja kwenye sayari ya Venus ni ndefu kuliko mwaka wake mzima.'),
('space', 'There are more stars in the observable universe than grains of sand on every beach on Earth.', 'Kuna nyota nyingi zaidi katika ulimwengu unaoonekana kuliko chembe za mchanga kwenye fukwe zote duniani.'),
('space', 'Neutron stars are so dense that a teaspoon of their material would weigh billions of tons.', 'Nyota za neutroni zina uzito mkubwa sana hivi kwamba kijiko kimoja cha kile kinachozijenga kingekuwa na uzito wa mabilioni ya tani.'),
('space', 'Saturn''s density is low enough that it would float in water, if there were an ocean big enough.', 'Uzito wa Sayari ya Zohali ni mdogo kiasi kwamba ingeelea juu ya maji, kama kungekuwa na bahari kubwa ya kutosha.'),
-- People
('people', 'Every person on Earth shares at least 99.9% of their DNA with every other person.', 'Kila mtu duniani anashiriki angalau 99.9% ya DNA yake na kila mtu mwingine.'),
('people', 'The concept of "zero" as a number was developed independently by several ancient civilizations.', 'Dhana ya "sifuri" kama namba ilibuniwa kwa kujitegemea na ustaarabu kadhaa wa kale.'),
('people', 'Handshakes are believed to have originated as a way to show you weren''t holding a weapon.', 'Inaaminika kuwa mikono ya kupeana ilianza kama njia ya kuonyesha kuwa haukuwa umeshika silaha.'),
('people', 'Humans are the only species known to blush.', 'Binadamu ndio kiumbe pekee kinachojulikana kubadilika rangi ya uso kwa haya (kuwa na wekundu wa uso).'),
('people', 'On average, people spend about a third of their life asleep.', 'Kwa wastani, watu hutumia karibu theluthi moja ya maisha yao wakiwa wamelala.');
