-- ── SEO : slug unique par médecin ────────────────────────────────────────────

-- Fonction utilitaire : normalise un texte en slug URL-safe
CREATE OR REPLACE FUNCTION slugify(v text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  result text;
BEGIN
  result := lower(v);
  -- Translittération des caractères accentués courants (FR + AR latin)
  result := translate(result,
    'àáâãäåæçèéêëìíîïðñòóôõöùúûüýÿ',
    'aaaaaaeceeeeiiiidnoooooouuuuyy');
  -- Garder uniquement alphanum + tirets
  result := regexp_replace(result, '[^a-z0-9\s-]', '', 'g');
  result := regexp_replace(result, '\s+', '-', 'g');
  result := regexp_replace(result, '-+', '-', 'g');
  result := trim(both '-' from result);
  RETURN result;
END;
$$;

-- Colonne slug sur profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS slug text UNIQUE;

-- Générer les slugs manquants pour les profils existants
DO $$
DECLARE
  rec RECORD;
  base_slug text;
  candidate text;
  counter int;
BEGIN
  FOR rec IN
    SELECT id, full_name, clinic_name, is_clinic, wilaya
    FROM profiles
    WHERE slug IS NULL
      AND (full_name IS NOT NULL OR clinic_name IS NOT NULL)
  LOOP
    base_slug := slugify(
      COALESCE(
        CASE WHEN rec.is_clinic THEN rec.clinic_name ELSE rec.full_name END,
        rec.full_name,
        rec.clinic_name
      )
    );
    IF rec.wilaya IS NOT NULL THEN
      base_slug := base_slug || '-' || slugify(rec.wilaya);
    END IF;

    -- Dédoublonnage
    candidate := base_slug;
    counter := 1;
    WHILE EXISTS (SELECT 1 FROM profiles WHERE slug = candidate) LOOP
      candidate := base_slug || '-' || counter;
      counter := counter + 1;
    END LOOP;

    UPDATE profiles SET slug = candidate WHERE id = rec.id;
  END LOOP;
END;
$$;

-- Trigger : auto-slug à l'insertion si null
CREATE OR REPLACE FUNCTION profiles_auto_slug()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  base_slug text;
  candidate text;
  counter int;
BEGIN
  IF NEW.slug IS NOT NULL THEN
    RETURN NEW;
  END IF;

  base_slug := slugify(
    COALESCE(
      CASE WHEN NEW.is_clinic THEN NEW.clinic_name ELSE NEW.full_name END,
      NEW.full_name,
      NEW.clinic_name,
      NEW.id::text
    )
  );
  IF NEW.wilaya IS NOT NULL THEN
    base_slug := base_slug || '-' || slugify(NEW.wilaya);
  END IF;

  candidate := base_slug;
  counter := 1;
  WHILE EXISTS (SELECT 1 FROM profiles WHERE slug = candidate AND id <> NEW.id) LOOP
    candidate := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;

  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_auto_slug ON profiles;
CREATE TRIGGER trg_profiles_auto_slug
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_auto_slug();

-- Index pour les lookups SEO
CREATE INDEX IF NOT EXISTS idx_profiles_slug ON profiles (slug);
CREATE INDEX IF NOT EXISTS idx_profiles_seo ON profiles (is_active, accepts_rdv, specialty, wilaya)
  WHERE slug IS NOT NULL;

-- Politique RLS : lecture publique des profils actifs avec slug
DROP POLICY IF EXISTS "public can read active profiles" ON profiles;
CREATE POLICY "public can read active profiles" ON profiles
  FOR SELECT
  USING (is_active = true AND slug IS NOT NULL);
