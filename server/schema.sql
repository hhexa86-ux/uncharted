-- Enable uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create industries table
CREATE TABLE IF NOT EXISTS industries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  location TEXT,
  city TEXT,
  country TEXT,
  user_role TEXT,
  organization TEXT,
  bio TEXT,
  skills TEXT[],
  areas_of_interest TEXT[],
  account_type TEXT DEFAULT 'innovator',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  org_name TEXT NOT NULL,
  org_type TEXT,
  website TEXT,
  description TEXT,
  country TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create ideas table
CREATE TABLE IF NOT EXISTS ideas (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  short_description TEXT,
  problem TEXT,
  solution TEXT,
  industry TEXT,
  technology TEXT,
  development_stage TEXT,
  patent_status TEXT DEFAULT 'none',
  visibility TEXT DEFAULT 'public',
  view_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  video_url TEXT,
  report_url TEXT,
  presentation_url TEXT,
  prototype_images JSONB DEFAULT '[]',
  external_links JSONB DEFAULT '[]',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create idea_files table
CREATE TABLE IF NOT EXISTS idea_files (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  file_type TEXT,
  file_name TEXT,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  bucket TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create idea_tags junction table
CREATE TABLE IF NOT EXISTS idea_tags (
  idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (idea_id, tag_id)
);

-- Create bookmarks table
CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, idea_id)
);

-- Create views table
CREATE TABLE IF NOT EXISTS views (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  viewer_ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL,
  message TEXT,
  contact_type TEXT DEFAULT 'general',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT,
  title TEXT,
  body TEXT,
  data JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create activity_logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create generate_slug function
CREATE OR REPLACE FUNCTION generate_slug(title TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  slug TEXT;
BEGIN
  base_slug := lower(regexp_replace(regexp_replace(title, '[^a-zA-Z0-9\s]', '', 'g'), '\s+', '-', 'g'));
  base_slug := left(base_slug, 50);
  slug := base_slug || '-' || substr(md5(random()::text), 1, 6);
  RETURN slug;
END;
$$ LANGUAGE plpgsql;

-- Create set_idea_slug trigger function
CREATE OR REPLACE FUNCTION set_idea_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_slug(NEW.title);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create idea_slug_trigger
DROP TRIGGER IF EXISTS idea_slug_trigger ON ideas;
CREATE TRIGGER idea_slug_trigger BEFORE INSERT ON ideas FOR EACH ROW EXECUTE FUNCTION set_idea_slug();

-- Create increment_view_count function
CREATE OR REPLACE FUNCTION increment_view_count(p_idea_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE ideas SET view_count = view_count + 1 WHERE id = p_idea_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Enable RLS on organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Enable RLS on ideas
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;

-- Enable RLS on idea_files
ALTER TABLE idea_files ENABLE ROW LEVEL SECURITY;

-- Enable RLS on idea_tags
ALTER TABLE idea_tags ENABLE ROW LEVEL SECURITY;

-- Enable RLS on bookmarks
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

-- Enable RLS on views
ALTER TABLE views ENABLE ROW LEVEL SECURITY;

-- Enable RLS on contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Enable RLS on notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Enable RLS on messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Enable RLS on activity_logs
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS: Public profiles viewable
DROP POLICY IF EXISTS "Public profiles viewable" ON profiles;
CREATE POLICY "Public profiles viewable" ON profiles FOR SELECT USING (true);

-- RLS: Users update own profile
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- RLS: Users insert own profile
DROP POLICY IF EXISTS "Users insert own profile" ON profiles;
CREATE POLICY "Users insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- RLS: Public ideas viewable
DROP POLICY IF EXISTS "Public ideas viewable" ON ideas;
CREATE POLICY "Public ideas viewable" ON ideas FOR SELECT USING (visibility = 'public' OR auth.uid() = user_id);

-- RLS: Users insert ideas
DROP POLICY IF EXISTS "Users insert ideas" ON ideas;
CREATE POLICY "Users insert ideas" ON ideas FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS: Users update own ideas
DROP POLICY IF EXISTS "Users update own ideas" ON ideas;
CREATE POLICY "Users update own ideas" ON ideas FOR UPDATE USING (auth.uid() = user_id);

-- RLS: Users delete own ideas
DROP POLICY IF EXISTS "Users delete own ideas" ON ideas;
CREATE POLICY "Users delete own ideas" ON ideas FOR DELETE USING (auth.uid() = user_id);

-- RLS: Files viewable
DROP POLICY IF EXISTS "Files viewable" ON idea_files;
CREATE POLICY "Files viewable" ON idea_files FOR SELECT USING (true);

-- RLS: Users manage files
DROP POLICY IF EXISTS "Users manage files" ON idea_files;
CREATE POLICY "Users manage files" ON idea_files FOR ALL USING (auth.uid() = user_id);

-- RLS: Idea tags viewable
DROP POLICY IF EXISTS "Idea tags viewable" ON idea_tags;
CREATE POLICY "Idea tags viewable" ON idea_tags FOR SELECT USING (true);

-- RLS: Users manage idea tags
DROP POLICY IF EXISTS "Users manage idea tags" ON idea_tags;
CREATE POLICY "Users manage idea tags" ON idea_tags FOR ALL USING (EXISTS (SELECT 1 FROM ideas WHERE ideas.id = idea_tags.idea_id AND ideas.user_id = auth.uid()));

-- RLS: Users manage bookmarks
DROP POLICY IF EXISTS "Users manage bookmarks" ON bookmarks;
CREATE POLICY "Users manage bookmarks" ON bookmarks FOR ALL USING (auth.uid() = user_id);

-- RLS: Users see contacts
DROP POLICY IF EXISTS "Users see contacts" ON contacts;
CREATE POLICY "Users see contacts" ON contacts FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- RLS: Users insert contacts
DROP POLICY IF EXISTS "Users insert contacts" ON contacts;
CREATE POLICY "Users insert contacts" ON contacts FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- RLS: Users update contacts
DROP POLICY IF EXISTS "Users update contacts" ON contacts;
CREATE POLICY "Users update contacts" ON contacts FOR UPDATE USING (auth.uid() = receiver_id);

-- RLS: Users see notifications
DROP POLICY IF EXISTS "Users see notifications" ON notifications;
CREATE POLICY "Users see notifications" ON notifications FOR ALL USING (auth.uid() = user_id);

-- RLS: Users see messages
DROP POLICY IF EXISTS "Users see messages" ON messages;
CREATE POLICY "Users see messages" ON messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- RLS: Users send messages
DROP POLICY IF EXISTS "Users send messages" ON messages;
CREATE POLICY "Users send messages" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Seed: Insert industries
INSERT INTO industries (name) VALUES
('Agriculture & Food'), ('Biotechnology'), ('Clean Energy'), ('Climate Tech'),
('Construction & Infrastructure'), ('Consumer Goods'), ('Cybersecurity'),
('Defense & Aerospace'), ('Education & EdTech'), ('Environment & Sustainability'),
('Finance & FinTech'), ('Government & Public Policy'), ('Healthcare & MedTech'),
('Housing & Real Estate'), ('Manufacturing'), ('Media & Entertainment'),
('Mobility & Transportation'), ('Retail & E-commerce'), ('Robotics & Automation'),
('Social Impact'), ('Space Technology'), ('Supply Chain & Logistics'),
('Telecommunications'), ('Water & Sanitation'), ('Other')
ON CONFLICT (name) DO NOTHING;

-- Seed: Insert tags
INSERT INTO tags (name, slug) VALUES
('Artificial Intelligence', 'ai'), ('Machine Learning', 'ml'), ('IoT', 'iot'),
('Blockchain', 'blockchain'), ('Open Source', 'open-source'), ('Mobile', 'mobile'),
('Web', 'web'), ('Hardware', 'hardware'), ('Software', 'software'),
('Sustainability', 'sustainability'), ('Social Good', 'social-good'),
('Low Cost', 'low-cost'), ('Scalable', 'scalable'), ('No-code', 'no-code'),
('Data Science', 'data-science'), ('Cloud', 'cloud'), ('Renewable Energy', 'renewable-energy'),
('Community', 'community'), ('Health', 'health'), ('Education', 'education')
ON CONFLICT (name) DO NOTHING;

-- Create FTS index on ideas
CREATE INDEX IF NOT EXISTS ideas_fts_idx ON ideas USING gin(
  to_tsvector('english',
    coalesce(title,'') || ' ' ||
    coalesce(short_description,'') || ' ' ||
    coalesce(problem,'') || ' ' ||
    coalesce(solution,'') || ' ' ||
    coalesce(technology,'') || ' ' ||
    coalesce(industry,'')
  )
);

-- Index: ideas_user_id_idx
CREATE INDEX IF NOT EXISTS ideas_user_id_idx ON ideas(user_id);

-- Index: ideas_industry_idx
CREATE INDEX IF NOT EXISTS ideas_industry_idx ON ideas(industry);

-- Index: ideas_created_at_idx
CREATE INDEX IF NOT EXISTS ideas_created_at_idx ON ideas(created_at DESC);

-- Index: ideas_view_count_idx
CREATE INDEX IF NOT EXISTS ideas_view_count_idx ON ideas(view_count DESC);