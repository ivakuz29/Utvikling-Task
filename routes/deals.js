'use strict';

const { Router } = require('express');
const db = require('../db/database');

const router = Router();

const ALLOWED_CATEGORIES = [
  'Drinks', 'Frozen Food', 'Snacks', 'Household',
  'Dairy', 'Deli', 'Breakfast',
];
const ALLOWED_CITIES = ['Bergen', 'Oslo', 'Trondheim', 'Stavanger'];

// GET /api/deals
// Query params: limit (1-50), category, city
router.get('/', (req, res, next) => {
  try {
    let limit = parseInt(req.query.limit ?? '20', 10);
    if (!Number.isInteger(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;

    const category = req.query.category ?? null;
    const city     = req.query.city     ?? null;

    if (category && !ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category.' });
    }
    if (city && !ALLOWED_CITIES.includes(city)) {
      return res.status(400).json({ error: 'Invalid city.' });
    }

    const deals = db.getDeals({ limit, category, city });
    res.json({ data: deals, count: deals.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/deals/history?store_id=&product_id=
router.get('/history', (req, res, next) => {
  try {
    const storeId   = parseInt(req.query.store_id,   10);
    const productId = parseInt(req.query.product_id, 10);

    if (!Number.isInteger(storeId)   || storeId   < 1 ||
        !Number.isInteger(productId) || productId < 1) {
      return res.status(400).json({ error: 'Invalid store_id or product_id.' });
    }

    const history = db.getPriceHistory(storeId, productId);
    res.json({ data: history });
  } catch (err) {
    next(err);
  }
});

// GET /api/deals/filters — return available filter values
router.get('/filters', (_req, res, next) => {
  try {
    const categories = db.getCategories();
    const cities     = db.getCities();
    res.json({ categories, cities });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
