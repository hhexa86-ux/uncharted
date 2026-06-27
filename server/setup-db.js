'use strict';

/**
 * setup-db.js — Uncharted Database & Storage Setup Script
 *
 * Run with: node setup-db.js
 *
 * This script will:
 *  1. Create all Supabase Storage buckets (public)
 *  2. Execute the full SQL schema via Supabase JS admin client (supabase.rpc / raw SQL)
 *  3. Disable email confirmation
 *  4. Print a pass/fail summary
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const { URL } = require('url');

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://iynmyhckxnnyttdvjedp.supabase.co';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5bm15aGNreG5ueXR0ZHZqZWRwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjM3MjY1NywiZXhwIjoyMDk3OTQ4NjU3fQ.KHZvQky4v2equq_jXYVQHI3Cq7FQeC6-Yv0MvE2lABg';

// Supabase Admin JS client (service role)
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------
const results = { buckets: [], sql: [], auth: null };

// ---------------------------------------------------------------------------
// Minimal HTTPS helper (no extra deps)
// ---------------------------------------------------------------------------
function httpRequest(urlStr, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 1. Create Storage Buckets
// ---------------------------------------------------------------------------
const BUCKETS = [
  // fileSizeLimit in bytes. Videos bucket omits limit to avoid 413 on bucket creation API;
  // the actual upload size limit is enforced by the upload middleware.
  { id: 'videos',        name: 'videos',        fileSizeLimit: null        }, // enforced in middleware
  { id: 'reports',       name: 'reports',       fileSizeLimit: 52428800    }, // 50 MB
  { id: 'presentations', name: 'presentations', fileSizeLimit: 52428800    }, // 50 MB
  { id: 'images',        name: 'images',        fileSizeLimit: 10485760    }, // 10 MB
  { id: 'avatars',       name: 'avatars',       fileSizeLimit: 5242880     }, // 5 MB
];

async function createBuckets() {
  console.log('\n📦 Step 1: Creating Storage Buckets...\n');

  for (const bucket of BUCKETS) {
    try {
      // Use supabase-js storage admin API
      const bucketOptions = { public: true };
      if (bucket.fileSizeLimit !== null) {
        bucketOptions.fileSizeLimit = bucket.fileSizeLimit;
      }
      const { data, error } = await supabase.storage.createBucket(bucket.id, bucketOptions);

      if (!error) {
        console.log(`  ✅ Bucket "${bucket.name}" created.`);
        results.buckets.push({ name: bucket.name, status: 'created' });
      } else if (error.message && error.message.toLowerCase().includes('already exists')) {
        console.log(`  ℹ️  Bucket "${bucket.name}" already exists — skipping.`);
        results.buckets.push({ name: bucket.name, status: 'already_exists' });
      } else {
        console.log(`  ❌ Bucket "${bucket.name}" failed: ${error.message}`);
        results.buckets.push({ name: bucket.name, status: 'failed', error: error.message });
      }
    } catch (err) {
      console.log(`  ❌ Bucket "${bucket.name}" error: ${err.message}`);
      results.buckets.push({ name: bucket.name, status: 'error', error: err.message });
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Run SQL via Supabase project REST endpoint
//
//    The Supabase cloud Management API (api.supabase.com) requires a separate
//    personal access token. Instead, we POST directly to the project's
//    pgMeta-compatible endpoint exposed at:
//    POST {SUPABASE_URL}/rest/v1/rpc/exec_sql
//
//    This requires a stored procedure to exist. As a fallback we provide
//    the schema.sql file for manual execution in the Supabase SQL Editor.
//
//    We also try the pg-meta path with the service key used as both
//    Authorization and apikey headers.
// ---------------------------------------------------------------------------

const PROJECT_REF = SUPABASE_URL.replace('https://', '').split('.')[0];

/**
 * Attempt to run SQL via multiple strategies:
 * 1. POST to {SUPABASE_URL}/rest/v1/rpc/exec_sql (requires exec_sql RPC to exist)
 * 2. POST to the pgMeta query endpoint with service key
 */
async function runSQLStatement(sql) {
  // Strategy: POST to the Supabase project's pgMeta endpoint
  // The correct path used by Supabase Studio is:
  // POST /pg-meta/v1/query with Authorization: Bearer <service_key>
  // and the apikey header
  return httpRequest(
    `${SUPABASE_URL}/pg-meta/v1/query`,
    'POST',
    {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    { query: sql }
  );
}

const SQL_STATEMENTS = [
  {
    label: 'Enable uuid-ossp extension',
    sql: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,
  },
  {
    label: 'Create industries table',
    sql: `CREATE TABLE IF NOT EXISTS industries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  },
  {
    label: 'Create tags table',
    sql: `CREATE TABLE IF NOT EXISTS tags (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  },
  {
    label: 'Create profiles table',
    sql: `CREATE TABLE IF NOT EXISTS profiles (
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
);`,
  },
  {
    label: 'Create organizations table',
    sql: `CREATE TABLE IF NOT EXISTS organizations (
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
);`,
  },
  {
    label: 'Create ideas table',
    sql: `CREATE TABLE IF NOT EXISTS ideas (
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
);`,
  },
  {
    label: 'Create idea_files table',
    sql: `CREATE TABLE IF NOT EXISTS idea_files (
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
);`,
  },
  {
    label: 'Create idea_tags junction table',
    sql: `CREATE TABLE IF NOT EXISTS idea_tags (
  idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (idea_id, tag_id)
);`,
  },
  {
    label: 'Create bookmarks table',
    sql: `CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, idea_id)
);`,
  },
  {
    label: 'Create views table',
    sql: `CREATE TABLE IF NOT EXISTS views (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  viewer_ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  },
  {
    label: 'Create contacts table',
    sql: `CREATE TABLE IF NOT EXISTS contacts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL,
  message TEXT,
  contact_type TEXT DEFAULT 'general',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  },
  {
    label: 'Create notifications table',
    sql: `CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT,
  title TEXT,
  body TEXT,
  data JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  },
  {
    label: 'Create messages table',
    sql: `CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  },
  {
    label: 'Create activity_logs table',
    sql: `CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);`,
  },
  {
    label: 'Create generate_slug function',
    sql: `CREATE OR REPLACE FUNCTION generate_slug(title TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  slug TEXT;
BEGIN
  base_slug := lower(regexp_replace(regexp_replace(title, '[^a-zA-Z0-9\\s]', '', 'g'), '\\s+', '-', 'g'));
  base_slug := left(base_slug, 50);
  slug := base_slug || '-' || substr(md5(random()::text), 1, 6);
  RETURN slug;
END;
$$ LANGUAGE plpgsql;`,
  },
  {
    label: 'Create set_idea_slug trigger function',
    sql: `CREATE OR REPLACE FUNCTION set_idea_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_slug(NEW.title);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
  },
  {
    label: 'Create idea_slug_trigger',
    sql: `DROP TRIGGER IF EXISTS idea_slug_trigger ON ideas;
CREATE TRIGGER idea_slug_trigger BEFORE INSERT ON ideas FOR EACH ROW EXECUTE FUNCTION set_idea_slug();`,
  },
  {
    label: 'Create increment_view_count function',
    sql: `CREATE OR REPLACE FUNCTION increment_view_count(p_idea_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE ideas SET view_count = view_count + 1 WHERE id = p_idea_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`,
  },
  { label: 'Enable RLS on profiles',       sql: `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on organizations',  sql: `ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on ideas',          sql: `ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on idea_files',     sql: `ALTER TABLE idea_files ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on idea_tags',      sql: `ALTER TABLE idea_tags ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on bookmarks',      sql: `ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on views',          sql: `ALTER TABLE views ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on contacts',       sql: `ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on notifications',  sql: `ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on messages',       sql: `ALTER TABLE messages ENABLE ROW LEVEL SECURITY;` },
  { label: 'Enable RLS on activity_logs',  sql: `ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;` },
  {
    label: 'RLS: Public profiles viewable',
    sql: `DROP POLICY IF EXISTS "Public profiles viewable" ON profiles;
CREATE POLICY "Public profiles viewable" ON profiles FOR SELECT USING (true);`,
  },
  {
    label: 'RLS: Users update own profile',
    sql: `DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);`,
  },
  {
    label: 'RLS: Users insert own profile',
    sql: `DROP POLICY IF EXISTS "Users insert own profile" ON profiles;
CREATE POLICY "Users insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);`,
  },
  {
    label: 'RLS: Public ideas viewable',
    sql: `DROP POLICY IF EXISTS "Public ideas viewable" ON ideas;
CREATE POLICY "Public ideas viewable" ON ideas FOR SELECT USING (visibility = 'public' OR auth.uid() = user_id);`,
  },
  {
    label: 'RLS: Users insert ideas',
    sql: `DROP POLICY IF EXISTS "Users insert ideas" ON ideas;
CREATE POLICY "Users insert ideas" ON ideas FOR INSERT WITH CHECK (auth.uid() = user_id);`,
  },
  {
    label: 'RLS: Users update own ideas',
    sql: `DROP POLICY IF EXISTS "Users update own ideas" ON ideas;
CREATE POLICY "Users update own ideas" ON ideas FOR UPDATE USING (auth.uid() = user_id);`,
  },
  {
    label: 'RLS: Users delete own ideas',
    sql: `DROP POLICY IF EXISTS "Users delete own ideas" ON ideas;
CREATE POLICY "Users delete own ideas" ON ideas FOR DELETE USING (auth.uid() = user_id);`,
  },
  {
    label: 'RLS: Files viewable',
    sql: `DROP POLICY IF EXISTS "Files viewable" ON idea_files;
CREATE POLICY "Files viewable" ON idea_files FOR SELECT USING (true);`,
  },
  {
    label: 'RLS: Users manage files',
    sql: `DROP POLICY IF EXISTS "Users manage files" ON idea_files;
CREATE POLICY "Users manage files" ON idea_files FOR ALL USING (auth.uid() = user_id);`,
  },
  {
    label: 'RLS: Idea tags viewable',
    sql: `DROP POLICY IF EXISTS "Idea tags viewable" ON idea_tags;
CREATE POLICY "Idea tags viewable" ON idea_tags FOR SELECT USING (true);`,
  },
  {
    label: 'RLS: Users manage idea tags',
    sql: `DROP POLICY IF EXISTS "Users manage idea tags" ON idea_tags;
CREATE POLICY "Users manage idea tags" ON idea_tags FOR ALL USING (EXISTS (SELECT 1 FROM ideas WHERE ideas.id = idea_tags.idea_id AND ideas.user_id = auth.uid()));`,
  },
  {
    label: 'RLS: Users manage bookmarks',
    sql: `DROP POLICY IF EXISTS "Users manage bookmarks" ON bookmarks;
CREATE POLICY "Users manage bookmarks" ON bookmarks FOR ALL USING (auth.uid() = user_id);`,
  },
  {
    label: 'RLS: Users see contacts',
    sql: `DROP POLICY IF EXISTS "Users see contacts" ON contacts;
CREATE POLICY "Users see contacts" ON contacts FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);`,
  },
  {
    label: 'RLS: Users insert contacts',
    sql: `DROP POLICY IF EXISTS "Users insert contacts" ON contacts;
CREATE POLICY "Users insert contacts" ON contacts FOR INSERT WITH CHECK (auth.uid() = sender_id);`,
  },
  {
    label: 'RLS: Users update contacts',
    sql: `DROP POLICY IF EXISTS "Users update contacts" ON contacts;
CREATE POLICY "Users update contacts" ON contacts FOR UPDATE USING (auth.uid() = receiver_id);`,
  },
  {
    label: 'RLS: Users see notifications',
    sql: `DROP POLICY IF EXISTS "Users see notifications" ON notifications;
CREATE POLICY "Users see notifications" ON notifications FOR ALL USING (auth.uid() = user_id);`,
  },
  {
    label: 'RLS: Users see messages',
    sql: `DROP POLICY IF EXISTS "Users see messages" ON messages;
CREATE POLICY "Users see messages" ON messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);`,
  },
  {
    label: 'RLS: Users send messages',
    sql: `DROP POLICY IF EXISTS "Users send messages" ON messages;
CREATE POLICY "Users send messages" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);`,
  },
  {
    label: 'Seed: Insert industries',
    sql: `INSERT INTO industries (name) VALUES
('Agriculture & Food'), ('Biotechnology'), ('Clean Energy'), ('Climate Tech'),
('Construction & Infrastructure'), ('Consumer Goods'), ('Cybersecurity'),
('Defense & Aerospace'), ('Education & EdTech'), ('Environment & Sustainability'),
('Finance & FinTech'), ('Government & Public Policy'), ('Healthcare & MedTech'),
('Housing & Real Estate'), ('Manufacturing'), ('Media & Entertainment'),
('Mobility & Transportation'), ('Retail & E-commerce'), ('Robotics & Automation'),
('Social Impact'), ('Space Technology'), ('Supply Chain & Logistics'),
('Telecommunications'), ('Water & Sanitation'), ('Other')
ON CONFLICT (name) DO NOTHING;`,
  },
  {
    label: 'Seed: Insert tags',
    sql: `INSERT INTO tags (name, slug) VALUES
('Artificial Intelligence', 'ai'), ('Machine Learning', 'ml'), ('IoT', 'iot'),
('Blockchain', 'blockchain'), ('Open Source', 'open-source'), ('Mobile', 'mobile'),
('Web', 'web'), ('Hardware', 'hardware'), ('Software', 'software'),
('Sustainability', 'sustainability'), ('Social Good', 'social-good'),
('Low Cost', 'low-cost'), ('Scalable', 'scalable'), ('No-code', 'no-code'),
('Data Science', 'data-science'), ('Cloud', 'cloud'), ('Renewable Energy', 'renewable-energy'),
('Community', 'community'), ('Health', 'health'), ('Education', 'education')
ON CONFLICT (name) DO NOTHING;`,
  },
  {
    label: 'Create FTS index on ideas',
    sql: `CREATE INDEX IF NOT EXISTS ideas_fts_idx ON ideas USING gin(
  to_tsvector('english',
    coalesce(title,'') || ' ' ||
    coalesce(short_description,'') || ' ' ||
    coalesce(problem,'') || ' ' ||
    coalesce(solution,'') || ' ' ||
    coalesce(technology,'') || ' ' ||
    coalesce(industry,'')
  )
);`,
  },
  { label: 'Index: ideas_user_id_idx',    sql: `CREATE INDEX IF NOT EXISTS ideas_user_id_idx ON ideas(user_id);` },
  { label: 'Index: ideas_industry_idx',   sql: `CREATE INDEX IF NOT EXISTS ideas_industry_idx ON ideas(industry);` },
  { label: 'Index: ideas_created_at_idx', sql: `CREATE INDEX IF NOT EXISTS ideas_created_at_idx ON ideas(created_at DESC);` },
  { label: 'Index: ideas_view_count_idx', sql: `CREATE INDEX IF NOT EXISTS ideas_view_count_idx ON ideas(view_count DESC);` },
];

async function runSQL() {
  console.log(`\n🗄️  Step 2: Executing SQL Schema (${SQL_STATEMENTS.length} statements)...\n`);
  console.log(`    Project ref: ${PROJECT_REF}`);
  console.log(`    Endpoint: https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query\n`);

  for (const statement of SQL_STATEMENTS) {
    try {
      const res = await runSQLStatement(statement.sql);

      if (res.status === 200 || res.status === 201) {
        // Check for error inside the body
        if (res.body && res.body.error) {
          console.log(`  ❌ [${statement.label}]: ${res.body.error}`);
          results.sql.push({ label: statement.label, status: 'failed', error: res.body.error });
        } else {
          console.log(`  ✅ [${statement.label}]`);
          results.sql.push({ label: statement.label, status: 'ok' });
        }
      } else if (res.status === 401 || res.status === 403 || res.status === 404) {
        const msg = `HTTP ${res.status} — pgMeta endpoint not accessible with service key. See schema.sql for manual setup.`;
        console.log(`  ⚠️  [${statement.label}] ${msg}`);
        results.sql.push({ label: statement.label, status: 'unauthorized', error: msg });
        console.log('\n  ℹ️  Remaining SQL statements skipped — use schema.sql instead.\n');
        break;
      } else {
        const msg =
          typeof res.body === 'object'
            ? res.body.message || res.body.error || JSON.stringify(res.body)
            : res.body;
        console.log(`  ❌ [${statement.label}] HTTP ${res.status}: ${msg}`);
        results.sql.push({ label: statement.label, status: 'failed', error: `HTTP ${res.status}: ${msg}` });
      }
    } catch (err) {
      console.log(`  ❌ [${statement.label}] Error: ${err.message}`);
      results.sql.push({ label: statement.label, status: 'error', error: err.message });
    }

    await new Promise((r) => setTimeout(r, 80));
  }
}

// ---------------------------------------------------------------------------
// 3. Disable email confirmation
// ---------------------------------------------------------------------------
async function disableEmailConfirmation() {
  console.log('\n✉️  Step 3: Disabling Email Confirmation...\n');

  try {
    // Supabase Auth Admin API: PATCH /auth/v1/settings
    // Requires service_role key as both Authorization and apikey header
    const res = await httpRequest(
      `${SUPABASE_URL}/auth/v1/settings`,
      'PATCH',
      {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      { mailer_autoconfirm: true }
    );

    if (res.status === 200) {
      console.log('  ✅ Email auto-confirmation enabled — users confirmed immediately on signup.');
      results.auth = { status: 'ok' };
    } else {
      const msg = typeof res.body === 'object' ? JSON.stringify(res.body) : res.body;
      console.log(`  ⚠️  Could not update auth settings [${res.status}]: ${msg}`);
      console.log(
        '      → Manually disable in Supabase Dashboard: Auth → Settings → Email confirmation.'
      );
      results.auth = { status: 'warning', message: msg };
    }
  } catch (err) {
    console.log(`  ❌ Auth settings error: ${err.message}`);
    results.auth = { status: 'error', error: err.message };
  }
}

// ---------------------------------------------------------------------------
// 4. Print summary
// ---------------------------------------------------------------------------
function printSummary() {
  const line = '═'.repeat(60);
  const thin = '─'.repeat(60);
  console.log('\n' + line);
  console.log('  📊  SETUP SUMMARY');
  console.log(line);

  // Buckets
  const bucketOk   = results.buckets.filter((b) => ['created', 'already_exists'].includes(b.status));
  const bucketFail  = results.buckets.filter((b) => !['created', 'already_exists'].includes(b.status));
  console.log(`\n  Storage Buckets : ${bucketOk.length}/${BUCKETS.length} ready`);
  bucketFail.forEach((b) => console.log(`    ⚠️  ${b.name}: ${b.error}`));

  // SQL
  const sqlOk   = results.sql.filter((s) => s.status === 'ok');
  const sqlFail  = results.sql.filter((s) => s.status !== 'ok');
  const sqlUnauth = results.sql.filter((s) => s.status === 'unauthorized');
  console.log(`\n  SQL Statements  : ${sqlOk.length}/${SQL_STATEMENTS.length} succeeded`);

  if (sqlUnauth.length > 0) {
    console.log('\n  ⚠️  SQL BLOCKED BY AUTH — Management API token required.');
    console.log('     The Supabase Management API (api.supabase.com) requires a personal');
    console.log('     access token, NOT the service_role key. To run the SQL schema:');
    console.log('');
    console.log('     OPTION A (Recommended): Use the Supabase SQL Editor in the Dashboard:');
    console.log(`     → https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
    console.log('     → Paste the contents of schema.sql and run it there.');
    console.log('');
    console.log('     OPTION B: Create a schema.sql file and run it via the Supabase CLI:');
    console.log('     → npx supabase db push');
    console.log('');
  } else if (sqlFail.length > 0) {
    console.log('\n  Failed SQL statements:');
    sqlFail.forEach((s) => console.log(`    ❌ ${s.label}: ${s.error}`));
  }

  // Auth
  console.log(`\n  Auth Settings   : ${results.auth ? results.auth.status : 'not run'}`);

  // Overall
  const bucketsGood = bucketFail.length === 0;
  const sqlGood = sqlFail.length === 0;
  console.log('\n' + thin);

  if (bucketsGood && sqlGood) {
    console.log('  🎉  Setup complete! Your database and storage are ready.');
  } else if (bucketsGood && sqlUnauth.length > 0) {
    console.log('  ✅  Storage buckets ready.');
    console.log('  ⚠️  Run the SQL schema manually in the Supabase SQL Editor (see above).');
  } else {
    console.log('  ⚠️  Setup completed with issues. Review messages above.');
  }

  // Print the SQL schema file hint
  console.log('\n  📄  Full SQL schema is also saved to: schema.sql');
  console.log(line + '\n');
}

// ---------------------------------------------------------------------------
// Save the full SQL schema to a file for manual execution
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

function saveSchemaFile() {
  const allSQL = SQL_STATEMENTS.map((s) => `-- ${s.label}\n${s.sql}`).join('\n\n');
  const schemaPath = path.join(__dirname, 'schema.sql');
  fs.writeFileSync(schemaPath, allSQL, 'utf8');
  console.log(`\n  📄  Schema saved to: ${schemaPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🚀  Uncharted — Database & Storage Setup');
  console.log(`  Project : ${SUPABASE_URL}`);
  console.log(`  Ref     : ${PROJECT_REF}`);
  console.log('═'.repeat(60));

  await createBuckets();
  await runSQL();
  await disableEmailConfirmation();

  // Always save schema.sql for manual fallback
  saveSchemaFile();

  printSummary();
}

main().catch((err) => {
  console.error('\n[FATAL] Setup script crashed:', err);
  process.exit(1);
});
