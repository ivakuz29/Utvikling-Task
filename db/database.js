'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'dealpulse.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');   // faster concurrent reads
    db.pragma('foreign_keys = ON');    // enforce FK constraints
    db.pragma('synchronous = NORMAL'); // good durability/speed balance
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT    NOT NULL,
      email                 TEXT    NOT NULL UNIQUE,
      city                  TEXT    NOT NULL,
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stores (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      chain      TEXT    NOT NULL,
      city       TEXT    NOT NULL,
      address    TEXT    NOT NULL,
      lat        REAL    NOT NULL,
      lng        REAL    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL,
      emoji       TEXT NOT NULL DEFAULT '🛒',
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS price_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id    INTEGER NOT NULL REFERENCES stores(id)   ON DELETE CASCADE,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      price       REAL    NOT NULL CHECK(price >= 0),
      recorded_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tracked_items (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      product_id           INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      max_distance_km      REAL    NOT NULL DEFAULT 5 CHECK(max_distance_km BETWEEN 1 AND 100),
      notify_threshold_pct REAL    NOT NULL DEFAULT 5 CHECK(notify_threshold_pct BETWEEN 1 AND 99),
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      store_id   INTEGER NOT NULL REFERENCES stores(id)   ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      old_price  REAL,
      new_price  REAL    NOT NULL,
      message    TEXT    NOT NULL,
      is_sent    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_price_entries_store_product
      ON price_entries(store_id, product_id, recorded_at DESC);

    CREATE INDEX IF NOT EXISTS idx_tracked_user
      ON tracked_items(user_id);

    CREATE INDEX IF NOT EXISTS idx_notifications_user
      ON notifications(user_id, created_at DESC);
  `);

  seedIfEmpty();
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM stores').get().c;
  if (count > 0) return;

  // ── Stores ────────────────────────────────────────────────────────────────
  const insertStore = db.prepare(`
    INSERT INTO stores (name, chain, city, address, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const stores = [
    ['Kiwi Bergen Sentrum',    'Kiwi',     'Bergen',     'Strandgaten 10',        60.3935, 5.3243],
    ['Rema 1000 Danmarksplass','Rema 1000', 'Bergen',     'Danmarksplass 1',       60.3701, 5.3400],
    ['Extra Minde',            'Extra',     'Bergen',     'Mindemyren 1',          60.3610, 5.3337],
    ['Meny Lagunen',           'Meny',      'Bergen',     'Laguneparken 2',        60.2954, 5.2380],
    ['Coop Prix Kronstad',     'Coop Prix', 'Bergen',     'Kronstad 3',            60.3765, 5.3561],
    ['Obs Åsane',              'Obs',       'Bergen',     'Åsane Senter',          60.4714, 5.3244],
    ['Spar Majorstuen',        'Spar',      'Oslo',       'Bogstadveien 45',       59.9282, 10.7137],
    ['Rema 1000 Grünerløkka',  'Rema 1000', 'Oslo',       'Thorvald Meyers gate 6',59.9228, 10.7558],
    ['Kiwi Trondheim City',    'Kiwi',      'Trondheim',  'Kongens gate 10',       63.4300, 10.3954],
    ['Meny Stavanger',         'Meny',      'Stavanger',  'Kvalaberg 1',           58.9690, 5.7331],
  ];

  for (const s of stores) insertStore.run(...s);

  // ── Products ──────────────────────────────────────────────────────────────
  const insertProduct = db.prepare(`
    INSERT INTO products (name, category, emoji, description)
    VALUES (?, ?, ?, ?)
  `);

  const products = [
    ['Red Bull 4-pack',          'Drinks',     '🥤', 'Energy drink 4 x 250ml'],
    ['Grandiosa Originale',      'Frozen Food','🍕', 'Classic Norwegian frozen pizza 585g'],
    ['Coca-Cola 1.5L',           'Drinks',     '🥤', 'Classic cola 1.5 litre bottle'],
    ['Monster Energy 500ml',     'Drinks',     '🥤', 'Green energy drink can'],
    ['Freia Melkesjokolade 200g','Snacks',     '🍫', 'Norwegian milk chocolate bar'],
    ['Lambi Toalettpapir 12pk',  'Household',  '🧻', 'Soft toilet paper 12-pack'],
    ['Tine Helmelk 1L',          'Dairy',      '🥛', 'Full fat milk 1 litre'],
    ['Stabburet Leverpostei',    'Deli',       '🥫', 'Norwegian liver pâté 185g'],
    ['Norvegia Skivet 400g',     'Dairy',      '🧀', 'Sliced Norwegian cheese'],
    ['Go\'morgen Yoghurt 4pk',   'Dairy',      '🥛', 'Mixed flavour yoghurt 4-pack'],
    ['Granola Havregryn 1kg',    'Breakfast',  '🌾', 'Rolled oats 1 kg'],
    ['Pepsi Max 6pk',            'Drinks',     '🥤', 'Zero sugar cola 6 x 500ml'],
  ];

  for (const p of products) insertProduct.run(...p);

  // ── Price entries (2 snapshots per store–product pair) ────────────────────
  const insertPrice = db.prepare(`
    INSERT INTO price_entries (store_id, product_id, price, recorded_at)
    VALUES (?, ?, ?, ?)
  `);

  // Base prices per product (index 1–12)
  const basePrices = [0, 69, 54, 34, 35, 22, 89, 24, 28, 59, 18, 32, 89];

  // For each store, insert a "yesterday" price and a "today" price with a drop
  const storeCount    = stores.length;
  const productCount  = products.length;

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const today     = new Date().toISOString();

  // discount % varies by store+product combo for variety
  const discounts = [0.29, 0.22, 0.18, 0.31, 0.27, 0.15, 0.20, 0.25, 0.10, 0.33];

  for (let si = 1; si <= storeCount; si++) {
    for (let pi = 1; pi <= productCount; pi++) {
      const base     = basePrices[pi];
      const discPct  = discounts[(si + pi) % discounts.length];
      const oldPrice = Math.round(base * 10) / 10;
      const newPrice = Math.round(base * (1 - discPct) * 10) / 10;

      insertPrice.run(si, pi, oldPrice, yesterday);
      insertPrice.run(si, pi, newPrice, today);
    }
  }

  console.log('[DB] Seeded stores, products, and price entries.');
}

// ── Query helpers (all use parameterized statements) ─────────────────────────

function getDeals({ limit = 20, category = null, city = null } = {}) {
  const db = getDb();

  let where = '';
  const params = [];

  if (category) { where += ' AND p.category = ?'; params.push(category); }
  if (city)     { where += ' AND s.city = ?';     params.push(city); }

  // Latest price vs previous price per store+product pair
  const sql = `
    WITH ranked AS (
      SELECT
        pe.store_id,
        pe.product_id,
        pe.price,
        pe.recorded_at,
        ROW_NUMBER() OVER (
          PARTITION BY pe.store_id, pe.product_id
          ORDER BY pe.recorded_at DESC
        ) AS rn
      FROM price_entries pe
    ),
    latest  AS (SELECT * FROM ranked WHERE rn = 1),
    prev    AS (SELECT * FROM ranked WHERE rn = 2)
    SELECT
      l.store_id,
      l.product_id,
      s.name       AS store_name,
      s.chain,
      s.city,
      s.address,
      s.lat,
      s.lng,
      p.name       AS product_name,
      p.category,
      p.emoji,
      p.description,
      l.price      AS current_price,
      v.price      AS previous_price,
      ROUND((v.price - l.price) / v.price * 100, 1) AS discount_pct,
      l.recorded_at
    FROM latest l
    JOIN prev    v ON v.store_id = l.store_id AND v.product_id = l.product_id
    JOIN stores  s ON s.id = l.store_id
    JOIN products p ON p.id = l.product_id
    WHERE l.price < v.price ${where}
    ORDER BY discount_pct DESC
    LIMIT ?
  `;

  params.push(limit);
  return db.prepare(sql).all(...params);
}

function getPriceHistory(storeId, productId) {
  const db = getDb();
  return db.prepare(`
    SELECT price, recorded_at
    FROM price_entries
    WHERE store_id = ? AND product_id = ?
    ORDER BY recorded_at ASC
  `).all(storeId, productId);
}

function getStores({ city = null } = {}) {
  const db = getDb();
  if (city) {
    return db.prepare('SELECT * FROM stores WHERE city = ? ORDER BY chain, name').all(city);
  }
  return db.prepare('SELECT * FROM stores ORDER BY city, chain, name').all();
}

function getProducts({ category = null } = {}) {
  const db = getDb();
  if (category) {
    return db.prepare('SELECT * FROM products WHERE category = ? ORDER BY name').all(category);
  }
  return db.prepare('SELECT * FROM products ORDER BY category, name').all();
}

function getStats() {
  const db = getDb();
  const users    = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const products = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const stores   = db.prepare('SELECT COUNT(*) AS c FROM stores').get().c;
  const tracked  = db.prepare('SELECT COUNT(*) AS c FROM tracked_items').get().c;

  const avgSavings = db.prepare(`
    WITH ranked AS (
      SELECT
        store_id, product_id, price,
        ROW_NUMBER() OVER (
          PARTITION BY store_id, product_id ORDER BY recorded_at DESC
        ) AS rn
      FROM price_entries
    ),
    l AS (SELECT * FROM ranked WHERE rn = 1),
    v AS (SELECT * FROM ranked WHERE rn = 2)
    SELECT ROUND(AVG((v.price - l.price) / v.price * 100), 1) AS avg_pct
    FROM l JOIN v ON v.store_id = l.store_id AND v.product_id = l.product_id
    WHERE l.price < v.price
  `).get().avg_pct ?? 0;

  return { users, products, stores, tracked, avgSavings };
}

function createUser({ name, email, city, notificationsEnabled }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO users (name, email, city, notifications_enabled)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    name,
    email,
    city,
    notificationsEnabled ? 1 : 0
  );
  return result.lastInsertRowid;
}

function getUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function trackItem({ userId, productId, maxDistanceKm, notifyThresholdPct }) {
  const db = getDb();
  return db.prepare(`
    INSERT OR IGNORE INTO tracked_items
      (user_id, product_id, max_distance_km, notify_threshold_pct)
    VALUES (?, ?, ?, ?)
  `).run(userId, productId, maxDistanceKm, notifyThresholdPct);
}

function getTrackedItems(userId) {
  return getDb().prepare(`
    SELECT ti.*, p.name AS product_name, p.emoji, p.category
    FROM tracked_items ti
    JOIN products p ON p.id = ti.product_id
    WHERE ti.user_id = ?
    ORDER BY ti.created_at DESC
  `).all(userId);
}

function getCategories() {
  return getDb()
    .prepare('SELECT DISTINCT category FROM products ORDER BY category')
    .all()
    .map(r => r.category);
}

function getCities() {
  return getDb()
    .prepare('SELECT DISTINCT city FROM stores ORDER BY city')
    .all()
    .map(r => r.city);
}

module.exports = {
  getDb,
  getDeals,
  getPriceHistory,
  getStores,
  getProducts,
  getStats,
  createUser,
  getUserByEmail,
  trackItem,
  getTrackedItems,
  getCategories,
  getCities,
};
