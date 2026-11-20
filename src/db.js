import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalize } from './keywords.js';

const dataDir = path.join(import.meta.dirname, '..', 'data');

export function openDb(file = path.join(dataDir, 'jobs.db')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      url TEXT,
      title TEXT NOT NULL,
      company TEXT,
      company_ico TEXT,
      location TEXT,
      city TEXT,
      is_remote INTEGER NOT NULL DEFAULT 0,
      salary_min INTEGER,
      salary_max INTEGER,
      salary_text TEXT,
      employment TEXT,
      description TEXT,
      search_text TEXT,
      match_why TEXT,
      match_rank INTEGER NOT NULL DEFAULT 0,
      posted_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_checked_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      note TEXT,
      is_new INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE (source, external_id)
    );
    CREATE INDEX IF NOT EXISTS offers_seen ON offers (first_seen_at DESC);
    CREATE TABLE IF NOT EXISTS companies (
      key TEXT PRIMARY KEY,
      ico TEXT,
      name TEXT NOT NULL,
      name_norm TEXT,
      city TEXT,
      nace TEXT,
      careers_url TEXT,
      email TEXT,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      note TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS checked (
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (source, external_id)
    );
  `);
  // migrace pro DB vytvořené starší verzí
  try { db.exec('ALTER TABLE companies ADD COLUMN name_norm TEXT'); } catch { /* už existuje */ }
  try { db.exec('ALTER TABLE offers ADD COLUMN match_why TEXT'); } catch { /* už existuje */ }
  try { db.exec('ALTER TABLE offers ADD COLUMN match_rank INTEGER NOT NULL DEFAULT 0'); } catch { /* už existuje */ }
  return db;
}

export function upsertOffer(db, o) {
  const now = new Date().toISOString();
  const search = normalize([o.title, o.company, o.description].filter(Boolean).join(' '));
  const existing = db
    .prepare('SELECT id, last_checked_at FROM offers WHERE source = ? AND external_id = ?')
    .get(o.source, o.externalId);

  if (existing) {
    db.prepare(`
      UPDATE offers SET url = ?, title = ?, company = ?, company_ico = ?, location = ?, city = ?,
        is_remote = ?, salary_min = ?, salary_max = ?, salary_text = ?, employment = ?,
        description = ?, search_text = ?, match_why = ?, match_rank = ?, posted_at = ?,
        last_seen_at = ?, last_checked_at = ?, active = 1
      WHERE id = ?
    `).run(
      o.url ?? null, o.title, o.company ?? null, o.companyIco ?? null, o.location ?? null, o.city ?? null,
      o.isRemote ? 1 : 0, o.salaryMin ?? null, o.salaryMax ?? null, o.salaryText ?? null, o.employment ?? null,
      o.description ?? null, search, o.matchWhy ?? null, o.matchRank ?? 0, o.postedAt ?? null, now, now, existing.id,
    );
    return { id: existing.id, isNew: false };
  }

  const res = db.prepare(`
    INSERT INTO offers (source, external_id, url, title, company, company_ico, location, city, is_remote,
      salary_min, salary_max, salary_text, employment, description, search_text, match_why, match_rank, posted_at,
      first_seen_at, last_seen_at, last_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    o.source, o.externalId, o.url ?? null, o.title, o.company ?? null, o.companyIco ?? null, o.location ?? null,
    o.city ?? null, o.isRemote ? 1 : 0, o.salaryMin ?? null, o.salaryMax ?? null, o.salaryText ?? null,
    o.employment ?? null, o.description ?? null, search, o.matchWhy ?? null, o.matchRank ?? 0, o.postedAt ?? null,
    now, now, now,
  );
  return { id: Number(res.lastInsertRowid), isNew: true };
}

export function markStaleOffers(db, source, seenIds) {
  const now = new Date().toISOString();
  const list = db.prepare('SELECT id, external_id FROM offers WHERE source = ? AND active = 1').all(source);
  const seen = new Set(seenIds);
  const stmt = db.prepare('UPDATE offers SET active = 0, last_seen_at = ? WHERE id = ?');
  let n = 0;
  for (const row of list) {
    if (!seen.has(row.external_id)) {
      stmt.run(now, row.id);
      n++;
    }
  }
  return n;
}

export function listOffers(db, { city, remote, source, status, q } = {}) {
  const where = ['match_rank > 0'];
  const args = [];
  if (city === 'remote') where.push('is_remote = 1');
  else if (city) { where.push('city = ?'); args.push(city); }
  if (remote === 'true') where.push('is_remote = 1');
  if (source) { where.push('source = ?'); args.push(source); }
  if (status) { where.push('status = ?'); args.push(status); }
  else where.push("status != 'skipped'");
  if (q) {
    where.push('search_text LIKE ?');
    args.push('%' + normalize(q) + '%');
  }
  const sql = `SELECT * FROM offers ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY is_new DESC, match_rank DESC, first_seen_at DESC LIMIT 500`;
  return db.prepare(sql).all(...args);
}

export function updateOffer(db, id, { status, note, isNew }) {
  const sets = [];
  const args = [];
  if (status !== undefined) { sets.push('status = ?'); args.push(status); }
  if (note !== undefined) { sets.push('note = ?'); args.push(note); }
  if (isNew !== undefined) { sets.push('is_new = ?'); args.push(isNew ? 1 : 0); }
  if (!sets.length) return;
  args.push(id);
  db.prepare(`UPDATE offers SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

export function upsertCompany(db, c) {
  const nameNorm = normalize(c.name);
  const byIco = c.ico ? String(c.ico) : null;
  const byName = db.prepare('SELECT key FROM companies WHERE name_norm = ? LIMIT 1').get(nameNorm)?.key;
  const key = byIco ?? byName ?? 'name:' + nameNorm;
  const existing = db.prepare('SELECT * FROM companies WHERE key = ?').get(key);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE companies SET name = ?, name_norm = COALESCE(name_norm, ?), ico = COALESCE(?, ico),
        city = COALESCE(?, city), nace = COALESCE(?, nace),
        careers_url = COALESCE(?, careers_url), email = COALESCE(?, email), updated_at = ?
      WHERE key = ?
    `).run(c.name, nameNorm, byIco, c.city ?? null, c.nace ?? null, c.careersUrl ?? null, c.email ?? null, now, key);
    return key;
  }
  db.prepare(`
    INSERT INTO companies (key, ico, name, name_norm, city, nace, careers_url, email, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    key, byIco, c.name, nameNorm, c.city ?? null, c.nace ?? null,
    c.careersUrl ?? null, c.email ?? null, c.source ?? null, now,
  );
  return key;
}

export function listCompanies(db, { q } = {}) {
  if (q) {
    return db.prepare('SELECT * FROM companies WHERE name_norm LIKE ? ORDER BY name LIMIT 2000')
      .all('%' + normalize(q) + '%');
  }
  return db.prepare('SELECT * FROM companies ORDER BY name LIMIT 2000').all();
}

export function updateCompany(db, key, { status, note, careersUrl, email }) {
  const sets = [];
  const args = [];
  if (status !== undefined) { sets.push('status = ?'); args.push(status); }
  if (note !== undefined) { sets.push('note = ?'); args.push(note); }
  if (careersUrl !== undefined) { sets.push('careers_url = ?'); args.push(careersUrl); }
  if (email !== undefined) { sets.push('email = ?'); args.push(email); }
  if (!sets.length) return;
  args.push(key);
  db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE key = ?`).run(...args);
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function getChecked(db, source) {
  const rows = db.prepare('SELECT external_id, checked_at FROM checked WHERE source = ?').all(source);
  return new Map(rows.map(r => [r.external_id, Date.parse(r.checked_at) || 0]));
}

export function setChecked(db, source, ids, at = new Date().toISOString()) {
  const stmt = db.prepare(`
    INSERT INTO checked (source, external_id, checked_at) VALUES (?, ?, ?)
    ON CONFLICT (source, external_id) DO UPDATE SET checked_at = excluded.checked_at
  `);
  for (const id of ids) stmt.run(source, String(id), at);
}
