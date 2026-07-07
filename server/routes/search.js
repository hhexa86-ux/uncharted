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

async function enrichChallengesWithProfiles(challenges) {
  if (!challenges || challenges.length === 0) return challenges;
  const userIds = [...new Set(challenges.map((c) => c.user_id).filter(Boolean))];
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, avatar_url, user_role, city, country, organization, bio, location')
    .in('id', userIds);
  const profileMap = {};
  (profiles || []).forEach((profile) => {
    profileMap[profile.id] = profile;
  });
  return challenges.map((challenge) => ({
    ...challenge,
    profiles: profileMap[challenge.user_id] || null,
    creator_name: profileMap[challenge.user_id]?.full_name || null,
    creator_role: profileMap[challenge.user_id]?.user_role || null,
    creator_location: profileMap[challenge.user_id]?.country || profileMap[challenge.user_id]?.location || null,
  }));
}

// ---------------------------------------------------------------------------
// GET /api/search — full-text search with filters and pagination
// ---------------------------------------------------------------------------
router.get('/', optionalAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const type = req.query.type || 'ideas';

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { industry, country, stage, patent, date_range, sort } = req.query;

    if (type === 'challenges') {
      const { data: challenges, error } = await supabaseAdmin
        .from('challenges')
        .select(`
          id, user_id, title, short_description, problem_statement, industry, country,
          technology, current_situation, expected_outcome, opportunity_types,
          opportunity_details, deadline, presentation_file, report_file, video_file,
          image_files, created_at, updated_at
        `);

      if (error) {
        console.error('[GET /search] Fetch challenges error:', error);
        return res.status(500).json({ error: 'Search challenges failed.' });
      }

      let results = await enrichChallengesWithProfiles(challenges || []);

      if (q) {
        const qLower = q.toLowerCase();
        results = results.filter((c) => {
          const title = (c.title || '').toLowerCase();
          const shortSummary = (c.short_description || '').toLowerCase();
          const fullDesc = `${c.problem_statement || ''} ${c.current_situation || ''} ${c.expected_outcome || ''} ${c.opportunity_details || ''}`.toLowerCase();
          const industryVal = (c.industry || '').toLowerCase();
          const countryVal = `${c.country || ''} ${c.profiles?.country || ''} ${c.profiles?.location || ''}`.toLowerCase();
          const keywords = (c.opportunity_types || []).join(' ').toLowerCase();
          const innovatorName = (c.profiles?.full_name || '').toLowerCase();
          const organizationName = (c.profiles?.organization || '').toLowerCase();

          return title.includes(qLower) ||
                 shortSummary.includes(qLower) ||
                 fullDesc.includes(qLower) ||
                 industryVal.includes(qLower) ||
                 countryVal.includes(qLower) ||
                 keywords.includes(qLower) ||
                 innovatorName.includes(qLower) ||
                 organizationName.includes(qLower);
        });
      }

      results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const total = results.length;
      const paginatedResults = results.slice(offset, offset + limit);

      return res.json({
        data: paginatedResults,
        challenges: paginatedResults,
        pagination: { page, limit, total, query: q },
        total,
        count: total,
      });
    }

    // Default: Search Ideas
    let query = supabaseAdmin
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
      .eq('status', 'active');

    if (req.user) {
      // Correct visibility filter syntax and include user's own ideas
      query = query.or(`visibility.eq.public,visibility.eq.authenticated,visibility.eq.protected,user_id.eq.${req.user.id}`);
    } else {
      query = query.in('visibility', ['public', 'authenticated', 'protected']);
    }

    const { data: ideas, error } = await query;

    if (error) {
      console.error('[GET /search] Fetch ideas error:', error);
      return res.status(500).json({ error: 'Search failed.' });
    }

    // Load access requests to check authorization for protected ideas
    let accessStatusMap = {};
    if (req.user) {
      const { data: contacts } = await supabaseAdmin
        .from('contacts')
        .select('idea_id, status')
        .eq('sender_id', req.user.id)
        .eq('contact_type', 'request_access');
      if (contacts) {
        contacts.forEach(c => {
          if (c.idea_id) accessStatusMap[c.idea_id] = c.status;
        });
      }
    }

    // Sanitize ideas based on visibility and authorization
    const sanitizedIdeas = (ideas || []).map(idea => {
      let accessStatus = 'accepted';
      if (idea.visibility === 'protected') {
        if (req.user && req.user.id === idea.user_id) {
          accessStatus = 'accepted';
        } else {
          accessStatus = (req.user && accessStatusMap[idea.id]) || 'none';
        }

        if (accessStatus !== 'accepted') {
          idea.problem = null;
          idea.solution = null;
          idea.video_url = null;
          idea.report_url = null;
          idea.presentation_url = null;
          idea.prototype_images = [];
          idea.external_links = [];
        }
      } else if (idea.visibility === 'authenticated') {
        if (!req.user) {
          accessStatus = 'none';
          idea.problem = null;
          idea.solution = null;
          idea.video_url = null;
          idea.report_url = null;
          idea.presentation_url = null;
          idea.prototype_images = [];
          idea.external_links = [];
        }
      }
      
      return {
        ...idea,
        access_status: accessStatus
      };
    });

    let results = await enrichWithProfiles(sanitizedIdeas);

    if (q) {
      const qLower = q.toLowerCase();
      results = results.filter((idea) => {
        const title = (idea.title || '').toLowerCase();
        const shortSummary = (idea.short_description || '').toLowerCase();
        const fullDesc = `${idea.problem || ''} ${idea.solution || ''}`.toLowerCase();
        const industryVal = (idea.industry || '').toLowerCase();
        const countryVal = `${idea.profiles?.country || ''} ${idea.profiles?.location || ''}`.toLowerCase();
        const tags = (idea.tags || []).map(t => t.name || '').join(' ').toLowerCase();
        const keywords = (idea.technology || '').toLowerCase();
        const innovatorName = (idea.profiles?.full_name || '').toLowerCase();
        const organizationName = (idea.profiles?.organization || '').toLowerCase();

        return title.includes(qLower) ||
               shortSummary.includes(qLower) ||
               fullDesc.includes(qLower) ||
               industryVal.includes(qLower) ||
               countryVal.includes(qLower) ||
               tags.includes(qLower) ||
               keywords.includes(qLower) ||
               innovatorName.includes(qLower) ||
               organizationName.includes(qLower);
      });
    }

    if (industry) {
      results = results.filter(idea => idea.industry && idea.industry.toLowerCase() === industry.toLowerCase());
    }
    if (stage) {
      const stageList = stage.split(',').map(s => s.trim().toLowerCase());
      results = results.filter(idea => idea.development_stage && stageList.includes(idea.development_stage.toLowerCase()));
    }
    if (patent) {
      const patentList = patent.split(',').map(p => p.trim().toLowerCase());
      results = results.filter(idea => idea.patent_status && patentList.includes(idea.patent_status.toLowerCase()));
    }
    if (country) {
      const cLower = country.toLowerCase();
      results = results.filter(idea => 
        (idea.profiles?.country && idea.profiles.country.toLowerCase().includes(cLower)) ||
        (idea.profiles?.location && idea.profiles.location.toLowerCase().includes(cLower))
      );
    }
    if (date_range) {
      const now = new Date();
      let minDate = new Date();
      if (date_range === 'week') minDate.setDate(now.getDate() - 7);
      else if (date_range === 'month') minDate.setMonth(now.getMonth() - 1);
      else if (date_range === 'year') minDate.setFullYear(now.getFullYear() - 1);
      
      results = results.filter(idea => new Date(idea.created_at) >= minDate);
    }

    if (sort === 'most_viewed') {
      results.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    } else if (sort === 'most_bookmarked') {
      results.sort((a, b) => (b.bookmark_count || 0) - (a.bookmark_count || 0));
    } else {
      results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);

    return res.json({
      data: paginatedResults,
      ideas: paginatedResults,
      pagination: { page, limit, total, query: q },
      total,
      count: total,
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
