// Vercel serverless entrypoint.
// Re-exports the Express app from server/index.js.
// Vercel's @vercel/node runtime calls this as a function handler;
// the app.listen() call in server/index.js is a no-op in this context.
module.exports = require('../server/index');
