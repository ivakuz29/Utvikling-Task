'use strict';

const { Router } = require('express');
const db = require('../db/database');

const router = Router();

const ALLOWED_CITIES = ['Bergen', 'Oslo', 'Trondheim', 'Stavanger'];

// GET /api/stores
// Query params: city
router.get('/', (req, res, next) => {
  try {
    const city = req.query.city ?? null;

    if (city && !ALLOWED_CITIES.includes(city)) {
      return res.status(400).json({ error: 'Invalid city.' });
    }

    const stores = db.getStores({ city });
    res.json({ data: stores });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
