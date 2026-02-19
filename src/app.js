'use strict';

const express = require('express');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(express.json({ limit: '1mb' }));

// Health check (no auth — Railway uses this)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/vapi', require('./routes/vapi'));
app.use('/clients', require('./routes/clients'));

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// Global error handler
app.use(errorHandler);

module.exports = app;
