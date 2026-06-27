'use strict';

const { supabaseAdmin } = require('../lib/supabase');

/**
 * Extract the Bearer token from:
 *  1. Authorization: Bearer <token> header
 *  2. sb_token cookie (fallback)
 */
function extractToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.cookies && req.cookies.sb_token) {
    return req.cookies.sb_token;
  }
  return null;
}

/**
 * requireAuth — Middleware that enforces authentication.
 * Attaches req.user and req.token on success.
 * Returns HTTP 401 if token is missing or invalid.
 */
async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Provide a Bearer token.' });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    req.user = data.user;
    req.token = token;
    return next();
  } catch (err) {
    console.error('[requireAuth] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Authentication service error.' });
  }
}

/**
 * optionalAuth — Middleware that attaches user info if a valid token is present.
 * Does NOT block the request if the token is missing or invalid.
 * Sets req.user = null if unauthenticated.
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    req.user = null;
    req.token = null;
    return next();
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data || !data.user) {
      req.user = null;
      req.token = null;
    } else {
      req.user = data.user;
      req.token = token;
    }
  } catch (err) {
    console.error('[optionalAuth] Unexpected error:', err.message);
    req.user = null;
    req.token = null;
  }

  return next();
}

module.exports = { requireAuth, optionalAuth };
