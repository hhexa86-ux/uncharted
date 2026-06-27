'use strict';

const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../lib/supabase');

// ---------------------------------------------------------------------------
// Storage: keep files in memory, upload buffer to Supabase Storage
// ---------------------------------------------------------------------------
const memoryStorage = multer.memoryStorage();

// ---------------------------------------------------------------------------
// MIME type maps per upload category
// ---------------------------------------------------------------------------
const ALLOWED_TYPES = {
  videos: {
    mimes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/avi'],
    extensions: ['.mp4', '.mov', '.webm', '.avi'],
    maxSize: 500 * 1024 * 1024, // 500 MB
  },
  reports: {
    mimes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ],
    extensions: ['.pdf', '.docx', '.doc'],
    maxSize: 50 * 1024 * 1024, // 50 MB
  },
  presentations: {
    mimes: [
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/pdf',
    ],
    extensions: ['.ppt', '.pptx', '.pdf'],
    maxSize: 50 * 1024 * 1024, // 50 MB
  },
  images: {
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxSize: 10 * 1024 * 1024, // 10 MB
  },
  avatars: {
    mimes: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    maxSize: 5 * 1024 * 1024, // 5 MB
  },
};

// ---------------------------------------------------------------------------
// File filter factory — validates MIME type against a category
// ---------------------------------------------------------------------------
function makeFileFilter(category) {
  return function fileFilter(req, file, cb) {
    const allowed = ALLOWED_TYPES[category];
    if (!allowed) {
      return cb(new Error(`Unknown upload category: ${category}`), false);
    }
    if (!allowed.mimes.includes(file.mimetype)) {
      return cb(
        new Error(
          `Invalid file type "${file.mimetype}". Allowed types: ${allowed.extensions.join(', ')}`
        ),
        false
      );
    }
    cb(null, true);
  };
}

// ---------------------------------------------------------------------------
// Multer instance factory
// ---------------------------------------------------------------------------
function makeUploader(category) {
  const config = ALLOWED_TYPES[category];
  if (!config) throw new Error(`Unknown upload category: ${category}`);

  return multer({
    storage: memoryStorage,
    limits: { fileSize: config.maxSize },
    fileFilter: makeFileFilter(category),
  });
}

// ---------------------------------------------------------------------------
// Named multer middleware instances
// ---------------------------------------------------------------------------
const uploaders = {
  videos: makeUploader('videos'),
  reports: makeUploader('reports'),
  presentations: makeUploader('presentations'),
  images: makeUploader('images'),
  avatars: makeUploader('avatars'),
};

// ---------------------------------------------------------------------------
// uploadToSupabase — uploads a buffer to Supabase Storage, returns public URL
// ---------------------------------------------------------------------------
/**
 * @param {Buffer} buffer      — File buffer from multer memoryStorage
 * @param {string} originalName — Original filename (used to derive extension)
 * @param {string} bucket      — Supabase Storage bucket name
 * @param {string} mimeType    — MIME type for Content-Type header
 * @returns {Promise<{ publicUrl: string, path: string }>}
 */
async function uploadToSupabase(buffer, originalName, bucket, mimeType) {
  // Build a collision-resistant filename: uuid-prefix + sanitised original name
  const ext = originalName.includes('.')
    ? '.' + originalName.split('.').pop().toLowerCase()
    : '';
  const safeName = originalName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .toLowerCase()
    .slice(0, 80);
  const storagePath = `${uuidv4()}_${safeName}`;

  const { data, error } = await supabaseAdmin.storage.from(bucket).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);

  return {
    publicUrl: urlData.publicUrl,
    path: storagePath,
  };
}

// ---------------------------------------------------------------------------
// Multer error handler — converts multer errors to clean JSON responses
// ---------------------------------------------------------------------------
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Check the size limit for this upload type.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files uploaded at once.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
}

module.exports = {
  uploaders,
  uploadToSupabase,
  handleUploadError,
  ALLOWED_TYPES,
};
