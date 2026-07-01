'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All contact-requests routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/contact-requests — send a contact request for a solution
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { solution_id, subject, message, meeting_link } = req.body;

    if (!solution_id) {
      return res.status(400).json({ error: 'solution_id is required.' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required.' });
    }

    // Verify solution exists and get innovator_id and challenge_id
    const { data: solution, error: solutionError } = await supabaseAdmin
      .from('solutions')
      .select('id, user_id, challenge_id')
      .eq('id', solution_id)
      .single();

    if (solutionError || !solution) {
      return res.status(404).json({ error: 'Solution not found.' });
    }

    const innovator_id = solution.user_id;
    const challenge_id = solution.challenge_id;

    // Verify user is not sending to themselves
    if (innovator_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot send a contact request to yourself.' });
    }

    // Check if a request already exists for this solution
    const { data: existing } = await supabaseAdmin
      .from('contact_requests')
      .select('id, status')
      .eq('organization_id', req.user.id)
      .eq('innovator_id', innovator_id)
      .eq('solution_id', solution_id)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'pending') {
        return res.status(400).json({ error: 'A contact request for this solution is already pending.' });
      }
      // If accepted or rejected, allow re-sending
    }

    const { data: contact, error: contactError } = await supabaseAdmin
      .from('contact_requests')
      .insert({
        organization_id: req.user.id,
        innovator_id,
        solution_id,
        challenge_id,
        subject: subject || null,
        message: message.trim(),
        meeting_link: meeting_link || null,
        status: 'pending',
      })
      .select()
      .single();

    if (contactError) {
      console.error('[POST /contact-requests]', contactError);
      return res.status(500).json({ error: 'Failed to send contact request.' });
    }

    return res.status(201).json({ data: contact, contact });
  } catch (err) {
    console.error('[POST /contact-requests] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/contact-requests/incoming — get contact requests received (innovator)
// ---------------------------------------------------------------------------
router.get('/incoming', async (req, res) => {
  try {
    const { data: requests, error } = await supabaseAdmin
      .from('contact_requests')
      .select(
        `
        id, organization_id, innovator_id, solution_id, challenge_id, subject, message, meeting_link, status, created_at, updated_at,
        solution:solution_id (
          id, title
        ),
        challenge:challenge_id (
          id, title
        )
        `
      )
      .eq('innovator_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /contact-requests/incoming]', error);
      return res.status(500).json({ error: 'Failed to fetch incoming contact requests.' });
    }

    if (!requests || requests.length === 0) {
      return res.json({ data: [], requests: [] });
    }

    // Collect all organization IDs
    const organizationIds = [...new Set(requests.map(r => r.organization_id).filter(Boolean))];

    // Query profiles for organizations
    let profilesMap = {};
    if (organizationIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, avatar_url, user_role, city, country, organization')
        .in('id', organizationIds);

      if (!profilesError && profiles) {
        profilesMap = profiles.reduce((map, profile) => {
          map[profile.id] = profile;
          return map;
        }, {});
      }
    }

    // Merge profiles into requests
    const enrichedRequests = requests.map(request => ({
      ...request,
      organization: profilesMap[request.organization_id] || null,
    }));

    return res.json({ data: enrichedRequests, requests: enrichedRequests });
  } catch (err) {
    console.error('[GET /contact-requests/incoming] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/contact-requests/outgoing — get contact requests sent (organization)
// ---------------------------------------------------------------------------
router.get('/outgoing', async (req, res) => {
  try {
    const { data: requests, error } = await supabaseAdmin
      .from('contact_requests')
      .select(
        `
        id, organization_id, innovator_id, solution_id, challenge_id, subject, message, meeting_link, status, created_at, updated_at,
        solution:solution_id (
          id, title
        ),
        challenge:challenge_id (
          id, title
        )
        `
      )
      .eq('organization_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /contact-requests/outgoing]', error);
      return res.status(500).json({ error: 'Failed to fetch outgoing contact requests.' });
    }

    if (!requests || requests.length === 0) {
      return res.json({ data: [], requests: [] });
    }

    // Collect all innovator IDs
    const innovatorIds = [...new Set(requests.map(r => r.innovator_id).filter(Boolean))];

    // Query profiles for innovators
    let profilesMap = {};
    if (innovatorIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, avatar_url, user_role, city, country')
        .in('id', innovatorIds);

      if (!profilesError && profiles) {
        profilesMap = profiles.reduce((map, profile) => {
          map[profile.id] = profile;
          return map;
        }, {});
      }
    }

    // Merge profiles into requests
    const enrichedRequests = requests.map(request => ({
      ...request,
      innovator: profilesMap[request.innovator_id] || null,
    }));

    return res.json({ data: enrichedRequests, requests: enrichedRequests });
  } catch (err) {
    console.error('[GET /contact-requests/outgoing] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/contact-requests/:id — update status (innovator) or add meeting link (organization)
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, meeting_link } = req.body;

    // Verify the contact request exists
    const { data: request, error: fetchError } = await supabaseAdmin
      .from('contact_requests')
      .select('id, organization_id, innovator_id, status')
      .eq('id', id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: 'Contact request not found.' });
    }

    // Innovator can update status
    if (status && request.innovator_id === req.user.id) {
      if (!['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be accepted or rejected.' });
      }

      const { data: updated, error: updateError } = await supabaseAdmin
        .from('contact_requests')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        console.error('[PATCH /contact-requests/:id]', updateError);
        return res.status(500).json({ error: 'Failed to update contact request.' });
      }

      return res.json({ data: updated, contact: updated });
    }

    // Organization can update meeting link
    if (meeting_link !== undefined && request.organization_id === req.user.id) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('contact_requests')
        .update({ meeting_link, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        console.error('[PATCH /contact-requests/:id]', updateError);
        return res.status(500).json({ error: 'Failed to update contact request.' });
      }

      return res.json({ data: updated, contact: updated });
    }

    return res.status(403).json({ error: 'You do not have permission to update this contact request.' });
  } catch (err) {
    console.error('[PATCH /contact-requests/:id] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
