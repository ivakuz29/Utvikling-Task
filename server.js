'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const dealsRouter    = require('./routes/deals');
const storesRouter   = require('./routes/stores');
const productsRouter = require('./routes/products');
const usersRouter    = require('./routes/users');

const app  = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000';

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // not needed for this setup
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: ORIGIN,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200,
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));   // cap request body size

// ── Rate limiting ─────────────────────────────────────────────────────────────
const windowMs   = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10); // 15 min
const readMax    = parseInt(process.env.RATE_LIMIT_MAX       ?? '100',    10);
const writeMax   = parseInt(process.env.RATE_LIMIT_WRITE_MAX ?? '20',     10);

const readLimiter = rateLimit({
  windowMs,
  max: readMax,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please try again later.' },
});

const writeLimiter = rateLimit({
  windowMs,
  max: writeMax,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many submissions. Please try again later.' },
});

// ── Static files ──────────────────────────────────────────────────────────────
// Serve public/ — never exposes db/ or routes/
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  dotfiles: 'deny',
}));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/deals',    readLimiter,  dealsRouter);
app.use('/api/stores',   readLimiter,  storesRouter);
app.use('/api/products', readLimiter,  productsRouter);
app.use('/api/users',    writeLimiter, usersRouter);

// ── 404 for unknown API routes ────────────────────────────────────────────────
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// ── Catch-all: serve index.html (SPA fallback) ────────────────────────────────
app.get('*path', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler — never leaks stack traces to client ─────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  const status = err.status ?? 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'development'
      ? err.message
      : 'An internal error occurred.',
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[DealPulse] Running at http://localhost:${PORT}`);
  console.log(`[DealPulse] NODE_ENV=${process.env.NODE_ENV}`);
});

module.exports = app;
