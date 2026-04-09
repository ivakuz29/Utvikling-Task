'use strict';

const { Router } = require('express');
const db = require('../db/database');

const router = Router();

const ALLOWED_CATEGORIES = [
  'Drinks', 'Frozen Food', 'Snacks', 'Household',
  'Dairy', 'Deli', 'Breakfast',
];

// GET /api/products
// Query params: category
router.get('/', (req, res, next) => {
  try {
    const category = req.query.category ?? null;

    if (category && !ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category.' });
    }

    const products = db.getProducts({ category });
    res.json({ data: products });
  } catch (err) {
    next(err);
  }
});

// GET /api/products/stats
router.get('/stats', (_req, res, next) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
