'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helper: build slug from title
// ---------------------------------------------------------------------------
function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 50) +
    '-' +
    Math.random().toString(36).slice(2, 8)
  );
}

// ---------------------------------------------------------------------------
// Helper: enrich ideas with creator profile data (two-step: no FK join needed)
// ---------------------------------------------------------------------------
async function enrichWithProfiles(ideas) {
  if (!ideas || ideas.length === 0) return ideas;
  const userIds = [...new Set(ideas.map(i => i.user_id).filter(Boolean))];
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, avatar_url, user_role, city, country, organization, bio, location')
    .in('id', userIds);
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });
  return ideas.map(idea => ({
    ...idea,
    profiles: profileMap[idea.user_id] || null,
    creator_name: profileMap[idea.user_id]?.full_name || null,
    creator_role: profileMap[idea.user_id]?.user_role || null,
    creator_location: profileMap[idea.user_id]?.country || profileMap[idea.user_id]?.location || null,
    tags: (idea.idea_tags || []).map(it => it.tags).filter(Boolean),
    idea_tags: undefined,
  }));
}

// ---------------------------------------------------------------------------
// Helper: base ideas select (no profile join — done separately)
// ---------------------------------------------------------------------------
function baseIdeaSelect() {
  return `id, user_id, title, slug, short_description, industry, technology,
    development_stage, patent_status, visibility, view_count, bookmark_count,
    video_url, report_url, presentation_url, prototype_images, external_links,
    status, created_at, updated_at,
    idea_tags ( tags ( id, name, slug ) )`;
}

function baseIdeaFullSelect() {
  return `id, user_id, title, slug, short_description, problem, solution,
    industry, technology, development_stage, patent_status, visibility,
    view_count, bookmark_count, video_url, report_url, presentation_url,
    prototype_images, external_links, status, created_at, updated_at,
    idea_tags ( tags ( id, name, slug ) )`;
}


// ---------------------------------------------------------------------------
// GET /api/ideas — list ideas with pagination, filters, sorting
// ---------------------------------------------------------------------------
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const countOnly = req.query.count === 'true';

    const { industry, country, stage, patent, role, sort, file_type } = req.query;

    let query = supabaseAdmin
      .from('ideas')
      .select(baseIdeaSelect())
      .eq('status', 'active');

    // Visibility: public ideas OR own ideas if authenticated
    if (req.user) {
      query = query.or(`visibility.eq.public,user_id.eq.${req.user.id}`);
    } else {
      query = query.eq('visibility', 'public');
    }

    // Filters
    if (industry) query = query.eq('industry', industry);
    if (stage) query = query.eq('development_stage', stage);
    if (patent) query = query.eq('patent_status', patent);

    // File type filter — return only ideas that have the specific file uploaded
    if (file_type === 'video')        query = query.not('video_url', 'is', null);
    else if (file_type === 'report')  query = query.not('report_url', 'is', null);
    else if (file_type === 'presentation') query = query.not('presentation_url', 'is', null);

    // Sorting
    switch (sort) {
      case 'most_viewed':      query = query.order('view_count',     { ascending: false }); break;
      case 'most_bookmarked':  query = query.order('bookmark_count', { ascending: false }); break;
      default:                 query = query.order('created_at',     { ascending: false }); break;
    }

    // Count query
    let countQuery = supabaseAdmin
      .from('ideas')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    if (req.user) countQuery = countQuery.or(`visibility.eq.public,user_id.eq.${req.user.id}`);
    else countQuery = countQuery.eq('visibility', 'public');
    if (industry)  countQuery = countQuery.eq('industry', industry);
    if (stage)     countQuery = countQuery.eq('development_stage', stage);
    if (patent)    countQuery = countQuery.eq('patent_status', patent);
    if (file_type === 'video')             countQuery = countQuery.not('video_url', 'is', null);
    else if (file_type === 'report')       countQuery = countQuery.not('report_url', 'is', null);
    else if (file_type === 'presentation') countQuery = countQuery.not('presentation_url', 'is', null);

    const [{ data: ideas, error }, { count }] = await Promise.all([
      countOnly ? query.range(0, 999) : query.range(offset, offset + limit - 1),
      countQuery,
    ]);

    if (error) {
      console.error('[GET /ideas]', error);
      return res.status(500).json({ error: 'Failed to fetch ideas.' });
    }

    // Enrich with profiles (separate query)
    let results = await enrichWithProfiles(ideas || []);

    // Post-process: filter by country if requested
    if (country) {
      results = results.filter(idea => idea.profiles?.country === country || idea.profiles?.location?.toLowerCase().includes(country.toLowerCase()));
    }

    const pagination = { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) };
    const uniqueCountries = new Set(
      results
        .map((idea) => idea.profiles?.country || idea.profiles?.location || null)
        .filter(Boolean)
    );
    const uniqueOrganizations = new Set(
      results.map((idea) => idea.profiles?.organization || null).filter(Boolean)
    );

    return res.json({
      data: results,
      ideas: results,
      pagination,
      total: pagination.total,
      count: pagination.total,
      total_ideas: count || results.length,
      countries: uniqueCountries.size,
      organizations: uniqueOrganizations.size,
    });
  } catch (err) {
    console.error('[GET /ideas] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ideas/user/me — get current user's ideas
// ---------------------------------------------------------------------------
router.get('/user/me', requireAuth, async (req, res) => {
  try {
    const { data: ideas, error } = await supabaseAdmin
      .from('ideas')
      .select(baseIdeaSelect())
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /ideas/user/me]', error);
      return res.status(500).json({ error: 'Failed to fetch your ideas.' });
    }

    const results = await enrichWithProfiles(ideas || []);
    return res.json({ data: results, ideas: results });
  } catch (err) {
    console.error('[GET /ideas/user/me] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ideas — create new idea
// ---------------------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      title,
      short_description,
      problem,
      solution,
      industry,
      technology,
      development_stage,
      patent_status,
      visibility,
      external_links,
      tags,
      video_url,
      report_url,
      presentation_url,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }

    const slug = slugify(title.trim());

    const ideaPayload = {
      user_id: req.user.id,
      title: title.trim(),
      slug,
      short_description: short_description || null,
      problem: problem || null,
      solution: solution || null,
      industry: industry || null,
      technology: technology || null,
      development_stage: development_stage || null,
      patent_status: patent_status || 'none',
      visibility: visibility || 'public',
      external_links: Array.isArray(external_links) ? external_links : [],
      video_url: video_url || null,
      report_url: report_url || null,
      presentation_url: presentation_url || null,
    };

    const { data: idea, error: ideaError } = await supabaseAdmin
      .from('ideas')
      .insert(ideaPayload)
      .select()
      .single();

    if (ideaError) {
      console.error('[POST /ideas] Insert idea:', ideaError);
      return res.status(500).json({ error: 'Failed to create idea.' });
    }

    // Handle tags: tags can be array of tag IDs or tag name strings
    if (Array.isArray(tags) && tags.length > 0) {
      await _upsertIdeaTags(idea.id, tags);
    }

    return res.status(201).json({ data: idea, idea, id: idea.id, slug: idea.slug });
  } catch (err) {
    console.error('[POST /ideas] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ideas/:idOrSlug — get single idea
// ---------------------------------------------------------------------------
router.get('/:idOrSlug', optionalAuth, async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    // Try UUID pattern first, then slug
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);

    let query = supabaseAdmin
      .from('ideas')
      .select(baseIdeaFullSelect())
      .eq('status', 'active');

    if (isUuid) query = query.eq('id', idOrSlug);
    else        query = query.eq('slug', idOrSlug);

    const { data: idea, error } = await query.maybeSingle();

    if (error || !idea) {
      return res.status(404).json({ error: 'Idea not found.' });
    }

    // Visibility check for private ideas
    if (idea.visibility !== 'public') {
      if (!req.user || req.user.id !== idea.user_id) {
        return res.status(403).json({ error: 'This idea is private.' });
      }
    }

    // Increment view count (fire and forget)
    supabaseAdmin.rpc('increment_view_count', { p_idea_id: idea.id }).then(({ error: rpcErr }) => {
      if (rpcErr) console.warn('[view_count RPC]', rpcErr.message);
    });

    // Record view
    supabaseAdmin
      .from('views')
      .insert({
        idea_id: idea.id,
        viewer_id: req.user ? req.user.id : null,
        viewer_ip: req.ip || null,
      })
      .then(({ error: viewErr }) => {
        if (viewErr) console.warn('[record view]', viewErr.message);
      });

    // Check bookmark status for authenticated users
    let isBookmarked = false;
    if (req.user) {
      const { data: bookmark } = await supabaseAdmin
        .from('bookmarks')
        .select('id')
        .eq('user_id', req.user.id)
        .eq('idea_id', idea.id)
        .maybeSingle();
      isBookmarked = !!bookmark;
    }

    // Enrich with profile
    const [enriched] = await enrichWithProfiles([idea]);

    const result = {
      ...enriched,
      is_bookmarked: isBookmarked,
    };

    return res.json({ data: result, idea: result, ...result });
  } catch (err) {
    console.error('[GET /ideas/:idOrSlug] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/ideas/:id — update idea (owner only)
// ---------------------------------------------------------------------------
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch existing idea
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('ideas')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Idea not found.' });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this idea.' });
    }

    const allowedFields = [
      'title',
      'short_description',
      'problem',
      'solution',
      'industry',
      'technology',
      'development_stage',
      'patent_status',
      'visibility',
      'video_url',
      'report_url',
      'presentation_url',
      'prototype_images',
      'external_links',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (updates.title) {
      updates.slug = slugify(updates.title.trim());
    }

    updates.updated_at = new Date().toISOString();

    const { data: updatedIdea, error: updateError } = await supabaseAdmin
      .from('ideas')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[PUT /ideas/:id]', updateError);
      return res.status(500).json({ error: 'Failed to update idea.' });
    }

    // Update tags if provided
    if (Array.isArray(req.body.tags)) {
      // Remove existing tags then re-insert
      await supabaseAdmin.from('idea_tags').delete().eq('idea_id', id);
      if (req.body.tags.length > 0) {
        await _upsertIdeaTags(id, req.body.tags);
      }
    }

    return res.json({ data: updatedIdea, idea: updatedIdea, ...updatedIdea });
  } catch (err) {
    console.error('[PUT /ideas/:id] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/ideas/:id — delete idea (owner only)
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('ideas')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Idea not found.' });
    }

    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this idea.' });
    }

    // Soft delete — set status to 'deleted'
    const { error: deleteError } = await supabaseAdmin
      .from('ideas')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (deleteError) {
      console.error('[DELETE /ideas/:id]', deleteError);
      return res.status(500).json({ error: 'Failed to delete idea.' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[DELETE /ideas/:id] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// Internal helper: upsert idea tags by ID or name
// ---------------------------------------------------------------------------
async function _upsertIdeaTags(ideaId, tags) {
  try {
    const tagIds = [];

    for (const tag of tags) {
      if (typeof tag === 'string' && /^[0-9a-f-]{36}$/i.test(tag)) {
        // It's a UUID
        tagIds.push(tag);
      } else if (typeof tag === 'string') {
        // It's a name — upsert and get ID
        const slug = tag.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const { data: existing } = await supabaseAdmin
          .from('tags')
          .select('id')
          .eq('name', tag)
          .maybeSingle();

        if (existing) {
          tagIds.push(existing.id);
        } else {
          const { data: newTag } = await supabaseAdmin
            .from('tags')
            .insert({ name: tag, slug })
            .select('id')
            .single();
          if (newTag) tagIds.push(newTag.id);
        }
      } else if (tag && tag.id) {
        tagIds.push(tag.id);
      }
    }

    if (tagIds.length > 0) {
      const rows = tagIds.map((tagId) => ({ idea_id: ideaId, tag_id: tagId }));
      await supabaseAdmin.from('idea_tags').upsert(rows, { ignoreDuplicates: true });
    }
  } catch (err) {
    console.error('[_upsertIdeaTags]', err.message);
  }
}

module.exports = router;
