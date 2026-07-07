'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// PUT /api/profiles/me — update own profile  (must be before /:id)
// ---------------------------------------------------------------------------
router.put('/me', requireAuth, async (req, res) => {
  try {
    const allowedFields = [
      'full_name', 'bio', 'skills', 'areas_of_interest',
      'city', 'country', 'location', 'avatar_url', 'organization', 'user_role',
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'No valid fields to update.' });
    updates.updated_at = new Date().toISOString();
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: req.user.id, ...updates }, { onConflict: 'id' })
      .select().single();
    if (error) { console.error('[PUT /profiles/me]', error); return res.status(500).json({ error: 'Failed to update profile.' }); }
    return res.json({ data: profile });
  } catch (err) {
    console.error('[PUT /profiles/me] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Also support POST /me for org dashboard convenience
router.post('/me', requireAuth, async (req, res) => {
  try {
    const allowedFields = [
      'full_name', 'bio', 'skills', 'areas_of_interest',
      'city', 'country', 'location', 'avatar_url', 'organization', 'user_role',
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    updates.updated_at = new Date().toISOString();
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: req.user.id, ...updates }, { onConflict: 'id' })
      .select().single();
    if (error) return res.status(500).json({ error: 'Failed to update profile.' });
    return res.json({ data: profile });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/profiles/me/stats — get own stats  (must be before /:id)
// ---------------------------------------------------------------------------
router.get('/me/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { count: totalIdeas, error: ideasErr } = await supabaseAdmin
      .from('ideas').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'active');
    const { data: ideasStats, error: statsErr } = await supabaseAdmin
      .from('ideas').select('view_count, bookmark_count')
      .eq('user_id', userId).eq('status', 'active');
    let totalViews = 0, totalBookmarks = 0;
    if (!statsErr && ideasStats) {
      for (const idea of ideasStats) {
        totalViews += idea.view_count || 0;
        totalBookmarks += idea.bookmark_count || 0;
      }
    }
    const { count: totalContacts } = await supabaseAdmin
      .from('contacts').select('id', { count: 'exact', head: true })
      .eq('receiver_id', userId);
    const payload = {
      idea_count: ideasErr ? 0 : (totalIdeas || 0),
      total_ideas: ideasErr ? 0 : (totalIdeas || 0),
      total_views: totalViews,
      total_bookmarks: totalBookmarks,
      total_bookmarks_received: totalBookmarks,
      total_contacts_received: totalContacts || 0,
    };
    return res.json({ data: payload, ...payload });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/profiles/me — get own profile (must be before /:id)
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    return res.json({ data: profile, profile, ...profile });
  } catch (err) {
    console.error('[GET /profiles/me] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/profiles/:id — get public profile by user_id
// ---------------------------------------------------------------------------
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select(
        'id, full_name, avatar_url, user_role, city, country, organization, bio, skills, areas_of_interest, account_type, created_at'
      )
      .eq('id', id)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    // Count public ideas by this user
    const { count: ideasCount, error: countError } = await supabaseAdmin
      .from('ideas')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id)
      .eq('visibility', 'public')
      .eq('status', 'active');

    const payload = {
      ...profile,
      public_ideas_count: countError ? 0 : (ideasCount || 0),
    };
    return res.json({ data: payload, profile: payload, ...payload });
  } catch (err) {
    console.error('[GET /profiles/:id] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});


module.exports = router;
