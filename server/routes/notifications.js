'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// GET /api/notifications — list notifications for current user
router.get('/', async (req, res) => {
  try {
    const { data: notifications, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /notifications]', error);
      return res.status(500).json({ error: 'Failed to fetch notifications.' });
    }

    const mapped = (notifications || []).map(n => {
      // Map frontend icons and messages
      let type = n.type;
      if (type === 'contact_request' || type === 'access_request_status') {
        type = 'contact';
      }
      return {
        ...n,
        type,
        message: n.body || n.title || 'New notification',
        text: n.body || n.title || 'New notification'
      };
    });

    return res.json({ data: mapped, notifications: mapped });
  } catch (err) {
    console.error('[GET /notifications] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/notifications/:id/read — mark notification as read
router.post('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: notification, error: fetchError } = await supabaseAdmin
      .from('notifications')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !notification) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    if (notification.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not authorized to update this notification.' });
    }

    const { error: updateError } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('id', id);

    if (updateError) {
      console.error('[POST /notifications/:id/read]', updateError);
      return res.status(500).json({ error: 'Failed to mark notification as read.' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /notifications/:id/read] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/notifications/read-all — mark all notifications as read
router.post('/read-all', async (req, res) => {
  try {
    const { error: updateError } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', req.user.id);

    if (updateError) {
      console.error('[POST /notifications/read-all]', updateError);
      return res.status(500).json({ error: 'Failed to mark all notifications as read.' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /notifications/read-all] Unexpected:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
