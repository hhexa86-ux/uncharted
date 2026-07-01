'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

// ---------------------------------------------------------------------------
// Route imports
// ---------------------------------------------------------------------------
const ideasRouter = require('./routes/ideas');
const profilesRouter = require('./routes/profiles');
const searchRouter = require('./routes/search');
const bookmarksRouter = require('./routes/bookmarks');
const contactsRouter = require('./routes/contacts');
const uploadRouter = require('./routes/upload');
const challengesRouter = require('./routes/challenges');
const solutionsRouter = require('./routes/solutions');
const contactRequestsRouter = require('./routes/contact-requests');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      [
          "'self'",
          "'unsafe-inline'",          // inline <script> blocks in HTML pages
          "'unsafe-eval'",            // Supabase JS SDK uses eval internally
          "https://cdn.jsdelivr.net", // Supabase JS SDK CDN
          "https://www.gstatic.com",  // Google APIs
        ],
        scriptSrcAttr:  ["'unsafe-inline'"], // onclick="..." handlers in HTML
        styleSrc:       [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        fontSrc:        ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc:         [
          "'self'",
          "data:",
          "blob:",
          "https://*.supabase.co",    // Supabase Storage images
          "https://lh3.googleusercontent.com",
          "https://docs.google.com",
        ],
        frameSrc:       [
          "'self'",
          "https://docs.google.com",  // Google Docs PDF/PPT viewer
        ],
        mediaSrc:       ["'self'", "https://*.supabase.co", "blob:"],
        connectSrc:     [
          "'self'",
          "https://*.supabase.co",    // Supabase REST + Auth + Realtime
          "wss://*.supabase.co",      // Supabase Realtime websocket
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com",
          "https://cdn.jsdelivr.net",
        ],
        objectSrc:      ["'none'"],
        baseUri:        ["'self'"],
        formAction:     ["'self'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
  })
);


// ---------------------------------------------------------------------------
// CORS — same-origin in production, open in development
// ---------------------------------------------------------------------------
const corsOptions = IS_PROD
  ? {
      origin: true, // reflect origin (same-origin enforced by deployment)
      credentials: true,
    }
  : {
      origin: '*',
      credentials: true,
    };

app.use(cors(corsOptions));

// ---------------------------------------------------------------------------
// HTTP request logging
// ---------------------------------------------------------------------------
app.use(morgan(IS_PROD ? 'combined' : 'dev'));

// ---------------------------------------------------------------------------
// Body parsers
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------

// General API limiter: 100 requests per 15 minutes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
  skip: (req) => req.path === '/api/health',
});

// Upload limiter: 20 requests per hour
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit reached. Please try again later.' },
});

// Auth limiter: 10 requests per 15 minutes (for login/signup — handled by Supabase)
// We still rate-limit the auth-adjacent middleware paths
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait and try again.' },
});

// Apply general limiter to all /api routes
app.use('/api', generalLimiter);

// Apply specific limiters
app.use('/api/upload', uploadLimiter);

// ---------------------------------------------------------------------------
// Health check — before other routes so it's never blocked
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
app.use('/api/ideas', ideasRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/search', searchRouter);
app.use('/api/bookmarks', bookmarksRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/challenges', challengesRouter);
app.use('/api/solutions', solutionsRouter);
app.use('/api/contact-requests', contactRequestsRouter);

// ---------------------------------------------------------------------------
// Static files — serve the frontend from /public
// ---------------------------------------------------------------------------
const publicDir = path.join(__dirname, '..', 'public');

// SSR SEO Meta Tags for Idea Page
app.get(['/idea.html', '/public/idea.html'], async (req, res, next) => {
  try {
    const id = req.query.id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return next();
    
    // Fetch idea title and description
    const { supabaseAdmin } = require('./lib/supabase');
    const { data: idea } = await supabaseAdmin
      .from('ideas')
      .select('title, short_description')
      .eq('id', id)
      .maybeSingle();

    if (!idea) return next();

    // Read the static idea.html file
    let html = await fs.promises.readFile(path.join(publicDir, 'idea.html'), 'utf8');

    // Replace the default title and inject OG tags
    const title = idea.title.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const desc = (idea.short_description || 'Check out this innovation on Uncharted')
                 .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    const metaTags = `
<title>${title} — Uncharted</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title} — Uncharted">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title} — Uncharted">
<meta name="twitter:description" content="${desc}">
    `;

    html = html.replace('<title>Loading Idea… — Uncharted</title>', metaTags.trim());
    return res.send(html);
  } catch (err) {
    console.error('[SSR SEO Error]', err);
    next();
  }
});

app.use(express.static(publicDir));

// ---------------------------------------------------------------------------
// SPA fallback — serve index.html for all non-API, non-file routes
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  // Don't fall through for /api routes that weren't matched (404 them)
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  }
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) {
      // If no index.html exists (e.g., API-only mode), send a friendly message
      res.status(200).json({ message: 'Uncharted API is running.', version: '1.0.0' });
    }
  });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err);

  const statusCode = err.status || err.statusCode || 500;
  const message =
    IS_PROD && statusCode === 500
      ? 'An unexpected error occurred. Please try again.'
      : err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: message,
    ...(IS_PROD ? {} : { stack: err.stack }),
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │   🚀  Uncharted API Server              │');
  console.log(`  │   Listening on http://localhost:${PORT}    │`);
  console.log(`  │   Environment: ${(process.env.NODE_ENV || 'development').padEnd(25)}│`);
  console.log('  └─────────────────────────────────────────┘');
  console.log('');
});

module.exports = app;
