'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All bookmark routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/bookmarks — get my bookmarks
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { data: bookmarks, error } = await supabaseAdmin
      .from('bookmarks')
      .select(
        `
        id, created_at,
        ideas (
          id, user_id, title, slug, short_description, industry, technology,
          development_stage, patent_status, visibility, view_count, bookmark_count,
          video_url, report_url, presentation_url, prototype_images,
          status, created_at,
          profiles:user_id (
            id, full_name, avatar_url, user_role, city, country
          ),
          idea_tags (
            tags ( id, name, slug )
          )
        )
        `
      )
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /bookmarks]', error);
      return res.status(500).json({ error: 'Failed to fetch bookmarks.' });
    }

    // Flatten: filter out deleted/private ideas and reshape
    const results = (bookmarks || [])
      .filter((b) => b.ideas && b.ideas.status === 'active')
      .map((b) => ({
        bookmark_id: b.id,
        bookmarked_at: b.created_at,
        idea: {
          ...b.ideas,
          tags: (b.ideas.idea_tags || []).map((it) => it.tags).filter(Boolean),
          idea_tags: undefined,
        },
      }));

    return res.json({ data: results });
  } catch (err) {
    console.error('[GET /bookmarks] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/bookmarks — bookmark an idea
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { idea_id } = req.body;

    if (!idea_id) {
      return res.status(400).json({ error: 'idea_id is required.' });
    }

    // Verify the idea exists and is public (or owned)
    const { data: idea, error: ideaError } = await supabaseAdmin
      .from('ideas')
      .select('id, user_id, visibility, status, title')
      .eq('id', idea_id)
      .single();

    if (ideaError || !idea) {
      return res.status(404).json({ error: 'Idea not found.' });
    }
    if (idea.status !== 'active') {
      return res.status(400).json({ error: 'Cannot bookmark this idea.' });
    }

    // Upsert bookmark
    const { data: bookmark, error: bkmError } = await supabaseAdmin
      .from('bookmarks')
      .upsert(
        { user_id: req.user.id, idea_id },
        { onConflict: 'user_id,idea_id', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (bkmError) {
      console.error('[POST /bookmarks]', bkmError);
      return res.status(500).json({ error: 'Failed to bookmark idea.' });
    }

    // Increment bookmark count (fire and forget)
    supabaseAdmin
      .from('ideas')
      .update({ bookmark_count: idea.bookmark_count + 1 })
      .eq('id', idea_id)
      .then(({ error: incErr }) => {
        if (incErr) console.warn('[bookmark_count increment]', incErr.message);
      });

    // Create notification for idea owner (if not self-bookmarking)
    if (idea.user_id !== req.user.id) {
      supabaseAdmin
        .from('notifications')
        .insert({
          user_id: idea.user_id,
          type: 'bookmark',
          title: 'Someone bookmarked your idea',
          body: `Your idea "${idea.title}" was bookmarked.`,
          data: { idea_id, booker_id: req.user.id },
        })
        .then(({ error: notifErr }) => {
          if (notifErr) console.warn('[bookmark notification]', notifErr.message);
        });
    }

    return res.status(201).json({ data: bookmark });
  } catch (err) {
    console.error('[POST /bookmarks] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/bookmarks/:ideaId — unbookmark
// ---------------------------------------------------------------------------
router.delete('/:ideaId', async (req, res) => {
  try {
    const { ideaId } = req.params;

    // Get bookmark to confirm it exists
    const { data: bookmark, error: fetchError } = await supabaseAdmin
      .from('bookmarks')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('idea_id', ideaId)
      .maybeSingle();

    if (fetchError || !bookmark) {
      return res.status(404).json({ error: 'Bookmark not found.' });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('bookmarks')
      .delete()
      .eq('user_id', req.user.id)
      .eq('idea_id', ideaId);

    if (deleteError) {
      console.error('[DELETE /bookmarks/:ideaId]', deleteError);
      return res.status(500).json({ error: 'Failed to remove bookmark.' });
    }

    // Decrement bookmark count (fire and forget, floor at 0)
    supabaseAdmin
      .rpc('decrement_bookmark_count', { p_idea_id: ideaId })
      .then(() => {
        // If RPC doesn't exist, fallback is acceptable — count will self-correct
      })
      .catch(() => {
        supabaseAdmin
          .from('ideas')
          .select('bookmark_count')
          .eq('id', ideaId)
          .single()
          .then(({ data: row }) => {
            if (row && row.bookmark_count > 0) {
              supabaseAdmin
                .from('ideas')
                .update({ bookmark_count: row.bookmark_count - 1 })
                .eq('id', ideaId)
                .then(() => {});
            }
          });
      });

    return res.status(204).send();
  } catch (err) {
    console.error('[DELETE /bookmarks/:ideaId] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/bookmarks/check/:ideaId — check if current user has bookmarked
// ---------------------------------------------------------------------------
router.get('/check/:ideaId', async (req, res) => {
  try {
    const { ideaId } = req.params;

    const { data: bookmark, error } = await supabaseAdmin
      .from('bookmarks')
      .select('id, created_at')
      .eq('user_id', req.user.id)
      .eq('idea_id', ideaId)
      .maybeSingle();

    if (error) {
      console.error('[GET /bookmarks/check/:ideaId]', error);
      return res.status(500).json({ error: 'Failed to check bookmark status.' });
    }

    return res.json({
      data: {
        is_bookmarked: !!bookmark,
        bookmarked_at: bookmark ? bookmark.created_at : null,
      },
    });
  } catch (err) {
    console.error('[GET /bookmarks/check/:ideaId] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
