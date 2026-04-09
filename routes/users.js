'use strict';

const { Router } = require('express');
const db = require('../db/database');

const router = Router();

const ALLOWED_CITIES = ['Bergen', 'Oslo', 'Trondheim', 'Stavanger'];
const EMAIL_REGEX    = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// ── Validation helpers ────────────────────────────────────────────────────────
function validateName(name) {
  return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 100;
}
function validateEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim()) && email.length <= 254;
}
function validateCity(city) {
  return typeof city === 'string' && ALLOWED_CITIES.includes(city);
}

// POST /api/users/waitlist
// Body: { name, email, city, items_text, notifications_enabled }
router.post('/waitlist', (req, res, next) => {
  try {
    const { name, email, city, items_text, notifications_enabled } = req.body ?? {};

    if (!validateName(name)) {
      return res.status(400).json({ error: 'Name must be 2–100 characters.' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (!validateCity(city)) {
      return res.status(400).json({ error: 'City must be Bergen, Oslo, Trondheim, or Stavanger.' });
    }
    if (items_text !== undefined && typeof items_text !== 'string') {
      return res.status(400).json({ error: 'items_text must be a string.' });
    }
    if (items_text && items_text.length > 500) {
      return res.status(400).json({ error: 'items_text too long (max 500 chars).' });
    }

    const notifyEnabled = notifications_enabled === true || notifications_enabled === 1;

    // Check for duplicate email
    const existing = db.getUserByEmail(email.trim().toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'This email is already registered.' });
    }

    const userId = db.createUser({
      name:                 name.trim(),
      email:                email.trim().toLowerCase(),
      city,
      notificationsEnabled: notifyEnabled,
    });

    res.status(201).json({ message: 'You\'re on the list!', userId });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/track
// Body: { email, product_id, max_distance_km, notify_threshold_pct }
router.post('/track', (req, res, next) => {
  try {
    const { email, product_id, max_distance_km, notify_threshold_pct } = req.body ?? {};

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const productId = parseInt(product_id, 10);
    if (!Number.isInteger(productId) || productId < 1) {
      return res.status(400).json({ error: 'Invalid product_id.' });
    }

    const dist = parseFloat(max_distance_km ?? 5);
    if (!Number.isFinite(dist) || dist < 1 || dist > 100) {
      return res.status(400).json({ error: 'max_distance_km must be between 1 and 100.' });
    }

    const threshold = parseFloat(notify_threshold_pct ?? 5);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 99) {
      return res.status(400).json({ error: 'notify_threshold_pct must be between 1 and 99.' });
    }

    const user = db.getUserByEmail(email.trim().toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Email not found. Please join the waitlist first.' });
    }

    db.trackItem({
      userId:              user.id,
      productId,
      maxDistanceKm:       dist,
      notifyThresholdPct:  threshold,
    });

    res.status(201).json({ message: 'Item is now being tracked.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/tracked?email=
router.get('/tracked', (req, res, next) => {
  try {
    const email = req.query.email ?? '';

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const user = db.getUserByEmail(email.trim().toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Email not found.' });
    }

    const items = db.getTrackedItems(user.id);
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
