import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { config, root } from './config.js';
import { openDb, setMeta, upsertCompany } from './db.js';
import { normalize } from './keywords.js';

const RES_URL = 'https://opendata.csu.gov.cz/soubory/od/od_org03/res_data.csv';
const RES_FILE = path.join(root, 'data', 'res_data.csv');
const NACE_IT = ['58', '62', '63'];

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function download(file, log) {
  log('ČSÚ: stahuji RES (~545 MB, jednou za měsíc)…');
  const res = await fetch(RES_URL, { headers: { 'User-Agent': config.userAgent } });
  if (!res.ok) throw new Error(`RES HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  let nextLog = 50 << 20;
  const body = Readable.fromWeb(res.body);
  body.on('data', chunk => {
    done += chunk.length;
    if (done >= nextLog) {
      log(`ČSÚ: ${total ? Math.round((done / total) * 100) + ' %' : Math.round(done / (1 << 20)) + ' MB'}`);
      nextLog += 50 << 20;
    }
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await pipeline(body, fs.createWriteStream(file + '.part'));
  fs.renameSync(file + '.part', file);
}

export async function importRes({ log = () => {}, db = openDb(), force = false } = {}) {
  if (force || !fs.existsSync(RES_FILE) || Date.now() - fs.statSync(RES_FILE).mtimeMs > 30 * 86400000) {
    await download(RES_FILE, log);
  }

  const cities = config.cities.map(normalize);
  const districts = new Set(config.companyDistricts || []);
  const startedAt = new Date().toISOString();
  const rl = readline.createInterface({ input: fs.createReadStream(RES_FILE, 'utf8'), crlfDelay: Infinity });
  let header = null;
  let seen = 0;
  let kept = 0;
  const insert = db.prepare(`
    INSERT INTO companies (key, ico, name, name_norm, city, nace, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'res', ?)
    ON CONFLICT (key) DO UPDATE SET name = excluded.name, name_norm = excluded.name_norm,
      city = excluded.city, nace = excluded.nace, updated_at = excluded.updated_at
  `);

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line).map(h => h.trim());
      continue;
    }
    seen++;
    if (seen % 200000 === 0) log(`ČSÚ: ${seen.toLocaleString('cs')} záznamů…`);

    const cols = parseCsvLine(line);
    const get = name => cols[header.indexOf(name)] ?? '';
    if (get('DDATZAN')) continue;

    const nace = get('NACE2025') || get('NACE');
    if (!NACE_IT.some(prefix => nace.startsWith(prefix))) continue;

    const city = get('OBEC_TEXT');
    if (districts.size ? !districts.has(get('OKRESLAU')) : !cities.includes(normalize(city))) continue;

    const ico = get('ICO');
    // RES někdy vrací název jako "Firma, s.r.o." ("Firma, spol. s r.o.") - bereme první variantu.
    const name = get('FIRMA').trim().replace(/^"+|"+$/g, '').replace(/\s*\(".*"\)\s*$/, '');
    if (!ico || !name) continue;
    if (/v likvidaci|v konkurzu|v úpadku|zanikl/i.test(name)) continue;
    insert.run(ico, ico, name, normalize(name), city, nace, new Date().toISOString());
    kept++;
  }

  setMeta(db, 'companies_import', new Date().toISOString());
  // Firmy, které v novém CSV nejsou (zaniklé, přejmenované), zůstaly by ve starém stavu.
  const removed = db.prepare("DELETE FROM companies WHERE source = 'res' AND updated_at < ?").run(startedAt).changes;
  log(`ČSÚ: hotovo, ${kept} IT firem v HK a Pardubicích (z ${seen.toLocaleString('cs')} záznamů, ${removed} odstraněno)`);
  return { scanned: seen, kept, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  importRes({ log: console.log, force: process.argv.includes('--force') })
    .then(s => console.log(s))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
