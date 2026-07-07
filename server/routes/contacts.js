'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All contacts routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/contacts — send a contact request
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { receiver_id, idea_id, message, contact_type } = req.body;

    if (!receiver_id) {
      return res.status(400).json({ error: 'receiver_id is required.' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required.' });
    }
    if (receiver_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot send a contact request to yourself.' });
    }

    // Verify receiver exists
    const { data: receiver, error: receiverError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('id', receiver_id)
      .single();

    if (receiverError || !receiver) {
      return res.status(404).json({ error: 'Receiver not found.' });
    }

    // If idea_id provided, verify it exists
    let ideaTitle = null;
    if (idea_id) {
      const { data: idea } = await supabaseAdmin
        .from('ideas')
        .select('id, title')
        .eq('id', idea_id)
        .maybeSingle();
      if (idea) ideaTitle = idea.title;
    }

    const { data: contact, error: contactError } = await supabaseAdmin
      .from('contacts')
      .insert({
        sender_id: req.user.id,
        receiver_id,
        idea_id: idea_id || null,
        message: message.trim(),
        contact_type: contact_type || 'general',
        status: 'pending',
      })
      .select()
      .single();

    if (contactError) {
      console.error('[POST /contacts]', contactError);
      return res.status(500).json({ error: 'Failed to send contact request.' });
    }

    // Create notification for receiver
    supabaseAdmin
      .from('notifications')
      .insert({
        user_id: receiver_id,
        type: 'contact_request',
        title: 'New contact request',
        body: ideaTitle
          ? `Someone wants to connect about your idea "${ideaTitle}".`
          : 'You have a new contact request.',
        data: {
          contact_id: contact.id,
          sender_id: req.user.id,
          idea_id: idea_id || null,
        },
      })
      .then(({ error: notifErr }) => {
        if (notifErr) console.warn('[contact notification]', notifErr.message);
      });

    return res.status(201).json({ data: contact });
  } catch (err) {
    console.error('[POST /contacts] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/contacts/inbox — get contact requests received
// ---------------------------------------------------------------------------
router.get('/inbox', async (req, res) => {
  try {
    // Step 1: fetch raw contacts rows (no joins — joins can fail silently when referenced rows are missing)
    const { data: contacts, error } = await supabaseAdmin
      .from('contacts')
      .select('id, sender_id, receiver_id, idea_id, message, contact_type, status, created_at')
      .eq('receiver_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /contacts/inbox]', error);
      return res.status(500).json({ error: 'Failed to fetch inbox.' });
    }

    if (!contacts || contacts.length === 0) {
      return res.json({ data: [] });
    }

    // Step 2: enrich sender profiles
    const senderIds = [...new Set(contacts.map(c => c.sender_id).filter(Boolean))];
    let senderMap = {};
    if (senderIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, avatar_url, user_role, city, country, organization')
        .in('id', senderIds);
      (profiles || []).forEach(p => { senderMap[p.id] = p; });
    }

    // Step 3: enrich idea titles
    const ideaIds = [...new Set(contacts.map(c => c.idea_id).filter(Boolean))];
    let ideaMap = {};
    if (ideaIds.length > 0) {
      const { data: ideas } = await supabaseAdmin
        .from('ideas')
        .select('id, title, slug, industry')
        .in('id', ideaIds);
      (ideas || []).forEach(i => { ideaMap[i.id] = i; });
    }

    // Step 4: merge
    const enriched = contacts.map(c => ({
      ...c,
      sender: senderMap[c.sender_id] || null,
      idea: c.idea_id ? (ideaMap[c.idea_id] || null) : null,
    }));

    return res.json({ data: enriched });
  } catch (err) {
    console.error('[GET /contacts/inbox] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/contacts/sent — get contact requests sent
// ---------------------------------------------------------------------------
router.get('/sent', async (req, res) => {
  try {
    // 1️⃣ Fetch raw contacts sent by this user
    const { data: contacts, error } = await supabaseAdmin
      .from('contacts')
      .select('id, sender_id, receiver_id, idea_id, message, contact_type, status, created_at')
      .eq('sender_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /contacts/sent] supabase error:', error);
      return res.status(500).json({ error: 'Failed to fetch sent contacts.' });
    }

    if (!contacts || contacts.length === 0) {
      return res.json({ data: [] });
    }

    // 2️⃣ Enrich receiver profiles
    const receiverIds = [...new Set(contacts.map(c => c.receiver_id).filter(Boolean))];
    let receiverMap = {};
    if (receiverIds.length > 0) {
      const { data: receivers, error: recvErr } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, avatar_url, user_role, city, country, organization')
        .in('id', receiverIds);
      if (recvErr) {
        console.error('[GET /contacts/sent] fetch receivers error:', recvErr);
      } else {
        (receivers || []).forEach(r => { receiverMap[r.id] = r; });
      }
    }

    // 3️⃣ Enrich idea data if any
    const ideaIds = [...new Set(contacts.map(c => c.idea_id).filter(Boolean))];
    let ideaMap = {};
    if (ideaIds.length > 0) {
      const { data: ideas, error: ideaErr } = await supabaseAdmin
        .from('ideas')
        .select('id, title, slug, industry')
        .in('id', ideaIds);
      if (ideaErr) {
        console.error('[GET /contacts/sent] fetch ideas error:', ideaErr);
      } else {
        (ideas || []).forEach(i => { ideaMap[i.id] = i; });
      }
    }

    // 4️⃣ Merge enriched data
    const enriched = contacts.map(c => ({
      ...c,
      receiver: receiverMap[c.receiver_id] || null,
      idea: c.idea_id ? (ideaMap[c.idea_id] || null) : null,
    }));

    return res.json({ data: enriched });
  } catch (err) {
    console.error('[GET /contacts/sent] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/contacts/:id/read — mark contact as read
// ---------------------------------------------------------------------------
router.patch('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify the contact belongs to this user as receiver
    const { data: contact, error: fetchError } = await supabaseAdmin
      .from('contacts')
      .select('id, receiver_id, status')
      .eq('id', id)
      .single();

    if (fetchError || !contact) {
      return res.status(404).json({ error: 'Contact not found.' });
    }
    if (contact.receiver_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not the receiver of this contact.' });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('contacts')
      .update({ status: 'read' })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[PATCH /contacts/:id/read]', updateError);
      return res.status(500).json({ error: 'Failed to mark contact as read.' });
    }

    return res.json({ data: updated });
  } catch (err) {
    console.error('[PATCH /contacts/:id/read] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/contacts/:id/status — update contact status (accept/reject)
// ---------------------------------------------------------------------------
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be accepted or rejected.' });
    }

    // Verify the contact belongs to this user as receiver
    const { data: contact, error: fetchError } = await supabaseAdmin
      .from('contacts')
      .select('id, receiver_id, sender_id, idea_id')
      .eq('id', id)
      .single();

    if (fetchError || !contact) {
      return res.status(404).json({ error: 'Contact not found.' });
    }
    if (contact.receiver_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not authorized to update this contact.' });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('contacts')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[PATCH /contacts/:id/status]', updateError);
      return res.status(500).json({ error: 'Failed to update contact status.' });
    }

    // Fetch idea title if present to enrich notification message
    let ideaTitle = null;
    if (contact.idea_id) {
      const { data: idea } = await supabaseAdmin
        .from('ideas')
        .select('title')
        .eq('id', contact.idea_id)
        .maybeSingle();
      if (idea) ideaTitle = idea.title;
    }

    // Create notification for requester (sender_id)
    const notifTitle = status === 'accepted' ? 'Access request approved' : 'Access request declined';
    const notifBody = ideaTitle
      ? `The innovator has ${status} your access request for "${ideaTitle}".`
      : `The innovator has ${status} your access request.`;

    supabaseAdmin
      .from('notifications')
      .insert({
        user_id: contact.sender_id,
        type: 'access_request_status',
        title: notifTitle,
        body: notifBody,
        data: {
          contact_id: contact.id,
          receiver_id: req.user.id,
          idea_id: contact.idea_id,
          status,
        },
      })
      .then(({ error: notifErr }) => {
        if (notifErr) console.warn('[status change notification]', notifErr.message);
      });

    return res.json({ data: updated });
  } catch (err) {
    console.error('[PATCH /contacts/:id/status] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
