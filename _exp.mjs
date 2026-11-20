import { openDb } from './src/db.js';
const db = openDb();
const rows = db.prepare('SELECT title, description, match_why FROM offers WHERE match_rank > 0').all();
const patterns = [
  /\d{1,2}\s*\+?\s*(?:let|rok\w*|years?|yrs?)/gi,
  /(?:praxe|zkušenost\w*|experience)\s*[:\-–]?\s*\d{1,2}/gi,
  /(?:několik|více|delší)\s+(?:let|roky)/gi,
  /(?:proven|relevant|professional|commercial)\s+experience/gi,
  /praxe\s+(?:nutností|podmínkou|výhodou)/gi,
];
for (const r of rows) {
  const d = (r.description || '').replace(/\s+/g, ' ');
  const hits = new Set();
  for (const p of patterns) for (const m of d.matchAll(p)) {
    const start = Math.max(0, m.index - 60);
    hits.add(d.slice(start, m.index + m[0].length + 60).trim());
  }
  if (hits.size) {
    console.log('\n### ' + r.title + '  [' + r.match_why + ']');
    for (const h of [...hits].slice(0, 4)) console.log('   …' + h + '…');
  }
}
