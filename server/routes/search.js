'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

async function enrichWithProfiles(ideas) {
  if (!ideas || ideas.length === 0) return ideas;
  const userIds = [...new Set(ideas.map((i) => i.user_id).filter(Boolean))];
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, avatar_url, user_role, city, country, organization, bio, location')
    .in('id', userIds);
  const profileMap = {};
  (profiles || []).forEach((profile) => {
    profileMap[profile.id] = profile;
  });
  return ideas.map((idea) => ({
    ...idea,
    profiles: profileMap[idea.user_id] || null,
    creator_name: profileMap[idea.user_id]?.full_name || null,
    creator_role: profileMap[idea.user_id]?.user_role || null,
    creator_location: profileMap[idea.user_id]?.country || profileMap[idea.user_id]?.location || null,
    tags: (idea.idea_tags || []).map((item) => item.tags).filter(Boolean),
    idea_tags: undefined,
  }));
}

// ---------------------------------------------------------------------------
// GET /api/search — full-text search with filters and pagination
// ---------------------------------------------------------------------------
router.get('/', optionalAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { industry, country, stage } = req.query;

    const { data: ideas, error } = await supabaseAdmin
      .from('ideas')
      .select(
        `
        id, user_id, title, slug, short_description, problem, solution,
        industry, technology, development_stage, patent_status, visibility,
        view_count, bookmark_count, video_url, report_url, presentation_url,
        prototype_images, external_links, status, created_at, updated_at,
        idea_tags (
          tags ( id, name, slug )
        )
        `
      )
      .eq('status', 'active')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET /search] Query error:', error);
      return res.status(500).json({ error: 'Search failed.' });
    }

    const qLower = q.toLowerCase();
    let results = (ideas || []).filter((idea) => {
      const haystack = [
        idea.title,
        idea.short_description,
        idea.problem,
        idea.solution,
        idea.technology,
        idea.industry,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(qLower);
    });

    if (industry) {
      results = results.filter((idea) => idea.industry === industry);
    }
    if (stage) {
      results = results.filter((idea) => idea.development_stage === stage);
    }

    results = await enrichWithProfiles(results);

    // Post-filter by country (on joined profile)
    if (country) {
      results = results.filter(
        (idea) => idea.profiles && idea.profiles.country === country
      );
    }

    // Flatten tags
    results = results.map((idea) => ({
      ...idea,
      tags: (idea.idea_tags || []).map((it) => it.tags).filter(Boolean),
      idea_tags: undefined,
    }));

    return res.json({
      data: results,
      ideas: results,
      pagination: {
        page,
        limit,
        total: results.length,
        query: q,
      },
      total: results.length,
      count: results.length,
    });
  } catch (err) {
    console.error('[GET /search] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/search/industries — return all industries
// ---------------------------------------------------------------------------
router.get('/industries', async (req, res) => {
  try {
    const { data: industries, error } = await supabaseAdmin
      .from('industries')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      console.error('[GET /search/industries]', error);
      return res.status(500).json({ error: 'Failed to fetch industries.' });
    }

    return res.json({ data: industries || [] });
  } catch (err) {
    console.error('[GET /search/industries] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/search/tags — return all tags (for autocomplete)
// ---------------------------------------------------------------------------
router.get('/tags', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();

    let query = supabaseAdmin
      .from('tags')
      .select('id, name, slug')
      .order('name', { ascending: true })
      .limit(100);

    if (q.length >= 1) {
      query = query.ilike('name', `%${q}%`);
    }

    const { data: tags, error } = await query;

    if (error) {
      console.error('[GET /search/tags]', error);
      return res.status(500).json({ error: 'Failed to fetch tags.' });
    }

    return res.json({ data: tags || [] });
  } catch (err) {
    console.error('[GET /search/tags] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
