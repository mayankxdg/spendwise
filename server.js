// ===== Expense & Savings Tracker - Express + SQLite backend =====
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'tracker.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  note TEXT DEFAULT '',
  date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  monthly_limit REAL NOT NULL CHECK (monthly_limit > 0),
  UNIQUE (user_id, category)
);`);

const app = express();
app.use(express.json());
app.use(session({ secret: 'change-this-secret', resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 } }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers / server-side validation ----------
const CATEGORIES = ['Food', 'Transport', 'Rent', 'Shopping', 'Bills', 'Health', 'Entertainment', 'Salary', 'Other'];
const requireAuth = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ error: 'Please log in first.' });
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d));

function validateTxn(b) {
  if (!['income', 'expense'].includes(b.type)) return 'Type must be income or expense.';
  if (!CATEGORIES.includes(b.category)) return 'Invalid category.';
  const amt = Number(b.amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 100000000) return 'Amount must be a positive number.';
  if (!isDate(b.date)) return 'Date must be in YYYY-MM-DD format.';
  if (b.note && String(b.note).length > 120) return 'Note must be 120 characters or fewer.';
  return null;
}

// ================= MODULE 1: AUTH =================
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'Enter a valid email.' });
  if (!password || password.length < 8 || !/\d/.test(password))
    return res.status(400).json({ error: 'Password needs 8+ characters including a digit.' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)')
      .run(name.trim(), email.toLowerCase(), hash);
    req.session.userId = info.lastInsertRowid;
    res.json({ ok: true, name: name.trim() });
  } catch (e) {
    res.status(409).json({ error: 'That email is already registered.' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'Incorrect email or password.' });
  req.session.userId = u.id;
  res.json({ ok: true, name: u.name });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.session.userId);
  res.json({ ...u, categories: CATEGORIES });
});

// ================= MODULE 2: TRANSACTIONS =================
app.get('/api/transactions', requireAuth, (req, res) => {
  const { category, from, to, type } = req.query;
  let sql = 'SELECT * FROM transactions WHERE user_id = ?';
  const args = [req.session.userId];
  if (category) { sql += ' AND category = ?'; args.push(category); }
  if (type) { sql += ' AND type = ?'; args.push(type); }
  if (from) { sql += ' AND date >= ?'; args.push(from); }
  if (to) { sql += ' AND date <= ?'; args.push(to); }
  res.json(db.prepare(sql + ' ORDER BY date DESC, id DESC').all(...args));
});

app.post('/api/transactions', requireAuth, (req, res) => {
  const err = validateTxn(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const info = db.prepare('INSERT INTO transactions (user_id,type,category,amount,note,date) VALUES (?,?,?,?,?,?)')
    .run(req.session.userId, b.type, b.category, Number(b.amount), b.note || '', b.date);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/transactions/:id', requireAuth, (req, res) => {
  const err = validateTxn(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const info = db.prepare('UPDATE transactions SET type=?,category=?,amount=?,note=?,date=? WHERE id=? AND user_id=?')
    .run(b.type, b.category, Number(b.amount), b.note || '', b.date, req.params.id, req.session.userId);
  info.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Transaction not found.' });
});

app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  info.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Transaction not found.' });
});

// ================= MODULE 3: DASHBOARD =================
app.get('/api/summary', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
      FROM transactions WHERE user_id=?`).get(uid);
  const byCategory = db.prepare(`SELECT category, SUM(amount) AS total FROM transactions
      WHERE user_id=? AND type='expense' GROUP BY category ORDER BY total DESC`).all(uid);
  const monthly = db.prepare(`SELECT substr(date,1,7) AS month,
      SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense
      FROM transactions WHERE user_id=? GROUP BY month ORDER BY month DESC LIMIT 6`).all(uid).reverse();
  res.json({ ...totals, balance: totals.income - totals.expense, byCategory, monthly });
});

// ================= MODULE 4: BUDGETS =================
app.get('/api/budgets', requireAuth, (req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`SELECT b.id, b.category, b.monthly_limit,
      COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id=b.user_id
        AND t.category=b.category AND t.type='expense' AND substr(t.date,1,7)=?),0) AS spent
      FROM budgets b WHERE b.user_id=? ORDER BY b.category`).all(month, req.session.userId);
  res.json({ month, budgets: rows });
});

app.post('/api/budgets', requireAuth, (req, res) => {
  const { category, monthly_limit } = req.body;
  const lim = Number(monthly_limit);
  if (!CATEGORIES.includes(category) || category === 'Salary') return res.status(400).json({ error: 'Pick a valid expense category.' });
  if (!Number.isFinite(lim) || lim <= 0) return res.status(400).json({ error: 'Limit must be a positive number.' });
  db.prepare(`INSERT INTO budgets (user_id,category,monthly_limit) VALUES (?,?,?)
      ON CONFLICT(user_id,category) DO UPDATE SET monthly_limit=excluded.monthly_limit`)
    .run(req.session.userId, category, lim);
  res.json({ ok: true });
});

app.delete('/api/budgets/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM budgets WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

app.get('/api/export.csv', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT date,type,category,amount,note FROM transactions WHERE user_id=? ORDER BY date').all(req.session.userId);
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const csv = ['date,type,category,amount,note', ...rows.map(r => [r.date, r.type, r.category, r.amount, esc(r.note)].join(','))].join('\n');
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="transactions.csv"' }).send(csv);
});

const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
module.exports = app;
