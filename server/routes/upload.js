'use strict';

const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { uploaders, uploadToSupabase, handleUploadError } = require('../middleware/upload');

const router = express.Router();

// All upload routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helper: respond with upload result
// ---------------------------------------------------------------------------
function uploadSuccess(res, url, file, path) {
  return res.status(201).json({
    data: {
      url,
      path,
      filename: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    },
    url,
    path,
    filename: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
  });
}

// ---------------------------------------------------------------------------
// POST /api/upload/video — upload a video file
// ---------------------------------------------------------------------------
router.post('/video', (req, res, next) => {
  uploaders.videos.single('file')(req, res, async (err) => {
    if (err) return handleUploadError(err, req, res, next);

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided. Use field name "file".' });
    }

    try {
      const { publicUrl, path } = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        'videos',
        req.file.mimetype
      );
      return uploadSuccess(res, publicUrl, req.file, path);
    } catch (uploadErr) {
      console.error('[POST /upload/video]', uploadErr.message);
      return res.status(500).json({ error: uploadErr.message });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/upload/report — upload a PDF or DOCX report
// ---------------------------------------------------------------------------
router.post('/report', (req, res, next) => {
  uploaders.reports.single('file')(req, res, async (err) => {
    if (err) return handleUploadError(err, req, res, next);

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided. Use field name "file".' });
    }

    try {
      const { publicUrl, path } = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        'reports',
        req.file.mimetype
      );
      return uploadSuccess(res, publicUrl, req.file, path);
    } catch (uploadErr) {
      console.error('[POST /upload/report]', uploadErr.message);
      return res.status(500).json({ error: uploadErr.message });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/upload/presentation — upload PPT/PPTX/PDF presentation
// ---------------------------------------------------------------------------
router.post('/presentation', (req, res, next) => {
  uploaders.presentations.single('file')(req, res, async (err) => {
    if (err) return handleUploadError(err, req, res, next);

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided. Use field name "file".' });
    }

    try {
      const { publicUrl, path } = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        'presentations',
        req.file.mimetype
      );
      return uploadSuccess(res, publicUrl, req.file, path);
    } catch (uploadErr) {
      console.error('[POST /upload/presentation]', uploadErr.message);
      return res.status(500).json({ error: uploadErr.message });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/upload/image — upload prototype images (up to 10)
// ---------------------------------------------------------------------------
router.post('/image', (req, res, next) => {
  uploaders.images.array('files', 10)(req, res, async (err) => {
    if (err) return handleUploadError(err, req, res, next);

    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided. Use field name "files".' });
    }

    try {
      const uploads = await Promise.all(
        files.map(async (file) => {
          const { publicUrl, path } = await uploadToSupabase(
            file.buffer,
            file.originalname,
            'images',
            file.mimetype
          );
          return {
            url: publicUrl,
            path,
            filename: file.originalname,
            size: file.size,
            mimetype: file.mimetype,
          };
        })
      );

      return res.status(201).json({ data: uploads, uploads });
    } catch (uploadErr) {
      console.error('[POST /upload/image]', uploadErr.message);
      return res.status(500).json({ error: uploadErr.message });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/upload/avatar — upload profile photo
// ---------------------------------------------------------------------------
router.post('/avatar', (req, res, next) => {
  uploaders.avatars.single('file')(req, res, async (err) => {
    if (err) return handleUploadError(err, req, res, next);

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided. Use field name "file".' });
    }

    try {
      const { publicUrl, path } = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        'avatars',
        req.file.mimetype
      );

      // Optionally update the user's avatar_url in profiles table
      supabaseAdmin
        .from('profiles')
        .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', req.user.id)
        .then(({ error: profileErr }) => {
          if (profileErr) console.warn('[avatar profile update]', profileErr.message);
        });

      return uploadSuccess(res, publicUrl, req.file, path);
    } catch (uploadErr) {
      console.error('[POST /upload/avatar]', uploadErr.message);
      return res.status(500).json({ error: uploadErr.message });
    }
  });
});

module.exports = router;
