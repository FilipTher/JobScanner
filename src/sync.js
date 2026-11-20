import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './config.js';
import { loadKeywords, matchOffer } from './keywords.js';
import { markStaleOffers, openDb, setMeta, upsertCompany, upsertOffer } from './db.js';
import { syncJobsCz } from './sources/jobs-cz.js';
import { syncStartupjobs } from './sources/startupjobs.js';

// Přežene uložené nabídky aktuálními pravidly - změna Key words.txt se projeví bez stahování.
export function refilter(db, rules) {
  const stmt = db.prepare('UPDATE offers SET match_why = ?, match_rank = ? WHERE id = ?');
  let kept = 0;
  for (const row of db.prepare('SELECT id, title, description FROM offers').all()) {
    const verdict = matchOffer(rules, row);
    if (verdict.keep) kept++;
    stmt.run(verdict.why, verdict.rank, row.id);
  }
  return { total: db.prepare('SELECT count(*) n FROM offers').get().n, kept };
}

export async function runSync({ log = () => {}, db = openDb(), only = null } = {}) {
  const rules = loadKeywords(path.join(root, 'Key words.txt'));
  const summary = {};
  const refiltered = refilter(db, rules);
  log(`přefiltrováno ${refiltered.total} uložených nabídek, ${refiltered.kept} odpovídá pravidlům`);

  for (const [name, source] of [['jobs.cz', syncJobsCz], ['startupjobs', syncStartupjobs]]) {
    if (only && only !== name) continue;
    log(`— ${name} —`);
    const res = await source({ rules, log, db });
    let added = 0;
    for (const offer of res.offers) {
      if (upsertOffer(db, offer).isNew) added++;
    }
    for (const company of res.companies) {
      if (company?.name) upsertCompany(db, company);
    }
    const stale = markStaleOffers(db, name, res.seen);
    summary[name] = { found: res.offers.length, new: added, inactive: stale };
    log(`${name}: ${res.offers.length} relevantních, ${added} nových, ${stale} už neaktivních`);
  }

  setMeta(db, 'last_sync', new Date().toISOString());
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2] || null;
  runSync({ log: console.log, only })
    .then(s => console.log(JSON.stringify(s, null, 2)))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
