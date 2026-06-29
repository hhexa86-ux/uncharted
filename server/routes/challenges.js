'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

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
// GET /api/challenges — list challenges
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { data: challenges, error } = await supabaseAdmin
      .from('challenges')
      .select('id, title, industry, country, deadline, opportunity_types, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /challenges] Fetch challenges:', error);
      return res.status(500).json({ error: 'Failed to fetch challenges.' });
    }

    return res.json({
      data: challenges || [],
      challenges: challenges || [],
      total: (challenges || []).length,
    });
  } catch (err) {
    console.error('[GET /challenges] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/challenges â€” create new challenge
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /api/challenges/:id — get single challenge
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: challenge, error } = await supabaseAdmin
      .from('challenges')
      .select(`
        id, user_id, title, short_description, problem_statement, industry, country,
        technology, current_situation, expected_outcome, opportunity_types,
        opportunity_details, deadline, presentation_file, report_file, video_file,
        image_files, created_at, updated_at
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[GET /challenges/:id] Fetch challenge:', error);
      return res.status(500).json({ error: 'Failed to fetch challenge.' });
    }

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found.' });
    }

    return res.json({
      data: challenge,
      challenge,
      id: challenge.id,
      creator_id: challenge.user_id,
    });
  } catch (err) {
    console.error('[GET /challenges/:id] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      title,
      short_description,
      problem_statement,
      industry,
      country,
      technology,
      current_situation,
      expected_outcome,
      opportunity_types,
      opportunity_details,
      deadline,
      presentation_file,
      report_file,
      video_file,
      image_files,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }

    const challengePayload = {
      user_id: req.user.id,
      title: title.trim(),
      short_description: short_description || null,
      problem_statement: problem_statement || null,
      industry: industry || null,
      country: country || null,
      technology: technology || null,
      current_situation: current_situation || null,
      expected_outcome: expected_outcome || null,
      opportunity_types: Array.isArray(opportunity_types) ? opportunity_types : [],
      opportunity_details: opportunity_details || null,
      deadline: deadline || null,
      presentation_file: presentation_file || null,
      report_file: report_file || null,
      video_file: video_file || null,
      image_files: Array.isArray(image_files) ? image_files : [],
    };

    const { data: challenge, error: challengeError } = await supabaseAdmin
      .from('challenges')
      .insert(challengePayload)
      .select()
      .single();

    if (challengeError) {
      console.error('[POST /challenges] Insert challenge:', challengeError);
      return res.status(500).json({ error: 'Failed to create challenge.' });
    }

    return res.status(201).json({ data: challenge, challenge, id: challenge.id });
  } catch (err) {
    console.error('[POST /challenges] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
