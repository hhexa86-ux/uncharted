'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/solutions/received — get solutions for challenges owned by user
// ---------------------------------------------------------------------------
router.get('/received', requireAuth, async (req, res) => {
  try {
    const { data: solutions, error } = await supabaseAdmin
      .from('solutions')
      .select(`
        *,
        challenges!inner (
          id,
          title,
          user_id
        )
      `)
      .eq('challenges.user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /solutions/received]', error);
      return res.status(500).json({ error: 'Failed to fetch received solutions.' });
    }

    return res.json({ data: solutions, solutions });
  } catch (err) {
    console.error('[GET /solutions/received] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/solutions/user/me — get solutions submitted by current user
// ---------------------------------------------------------------------------
router.get('/user/me', requireAuth, async (req, res) => {
  try {
    const { data: solutions, error } = await supabaseAdmin
      .from('solutions')
      .select(`
        *,
        challenges!inner (
          id,
          title
        )
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /solutions/user/me]', error);
      return res.status(500).json({ error: 'Failed to fetch your solutions.' });
    }

    return res.json({ data: solutions, solutions });
  } catch (err) {
    console.error('[GET /solutions/user/me] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/solutions/:id — get single solution by ID
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: solution, error } = await supabaseAdmin
      .from('solutions')
      .select(`
        *,
        challenges!inner (
          id,
          title,
          user_id
        )
      `)
      .eq('id', id)
      .single();

    if (error || !solution) {
      return res.status(404).json({ error: 'Solution not found.' });
    }

    return res.json({ data: solution, solution });
  } catch (err) {
    console.error('[GET /solutions/:id] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/solutions — create new solution
// ---------------------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      challenge_id,
      title,
      executive_summary,
      full_description,
      presentation_file,
      report_file,
      video_file,
      image_files,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }

    if (!challenge_id) {
      return res.status(400).json({ error: 'Challenge ID is required.' });
    }

    const solutionPayload = {
      user_id: req.user.id,
      challenge_id: challenge_id,
      title: title.trim(),
      executive_summary: executive_summary || null,
      full_description: full_description || null,
      presentation_file: presentation_file || null,
      report_file: report_file || null,
      video_file: video_file || null,
      image_files: Array.isArray(image_files) ? image_files : [],
      status: 'submitted',
    };

    const { data: solution, error: solutionError } = await supabaseAdmin
      .from('solutions')
      .insert(solutionPayload)
      .select()
      .single();

    if (solutionError) {
      console.error('[POST /solutions] Insert solution:', solutionError);
      return res.status(500).json({ error: 'Failed to create solution.' });
    }

    return res.status(201).json({ data: solution, solution, id: solution.id });
  } catch (err) {
    console.error('[POST /solutions] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
