'use strict';

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}: ${message}`);
  if (status === 500) console.error(err.stack);

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
