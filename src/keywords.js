import fs from 'node:fs';

const ASCII_TERM = /^[\x20-\x7e]+$/;

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—−]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseKeywords(text) {
  const sections = { ANO: [], JUNIOR: [], LEVEL: [], PRAXE: [], TYP: [], NE: [] };
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const head = line.match(/^(ANO|NE|TYP|JUNIOR|LEVEL|PRAXE):$/i);
    if (head) {
      current = head[1].toUpperCase();
      continue;
    }
    if (!current) continue;
    for (const part of line.split(',')) {
      const term = part.trim();
      if (term) sections[current].push(term);
    }
  }
  return sections;
}

export function loadKeywords(file) {
  return parseKeywords(fs.readFileSync(file, 'utf8'));
}

const compiled = new Map();
function pattern(term) {
  if (compiled.has(term)) return compiled.get(term);
  let re;
  if (term.startsWith('re:')) {
    re = new RegExp(term.slice(3), 'i');
  } else {
    const body = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // ASCII slova na hranici slova + české koncovky ("JavaScriptu"), aby "Java" nechytilo "JavaScript".
    re = ASCII_TERM.test(term)
      ? new RegExp(`(?<![a-z0-9])${body}(?:[a-z]{1,3})?(?![a-z0-9])`, 'i')
      : new RegExp(body, 'i');
  }
  compiled.set(term, re);
  return re;
}

// "Junior projektový manažer" projde, ale "Lead Generation Specialist | pro juniory" ne.
function startsJunior(rules, normalizedTitle) {
  return rules.JUNIOR.some(term => normalizedTitle.startsWith(normalize(term)));
}

// Pozor: text je už normalizovaný (bez diakritiky), proto i vzory musí být bez diakritiky.
const ADVANTAGE = /vyhodou|vyhoda|vitan|vitana|vitane|nice to have|advantage|preferred|je plus|bonus/;
const YEARS = String.raw`(?:let|roku|roky|rok|years?|yrs?)`;
const NUMBER_WORDS = String.raw`(?:minim\w*|alespon|aspon|at least|min\.|vice nez|more than)`;

// Najde požadavek na praxi v letech. Vrací nejnižší počet let, který inzerát vyžaduje,
// a ignoruje zmínky označené jako výhoda ("2 roky praxe výhodou").
export function detectExperience(text) {
  const normalized = normalize(text);
  const found = [];
  const push = (years, index, length) => found.push({ years, index, length });

  const windowHasAdvantage = (index, length) => {
    const start = Math.max(0, index - 90);
    return ADVANTAGE.test(normalized.slice(start, index + length + 90));
  };

  const addAll = (re, pick) => {
    for (const m of normalized.matchAll(re)) {
      const years = pick(m);
      if (years !== null) push(years, m.index, m[0].length);
    }
  };

  // "2 roky praxe", "5 let zkušeností", "1+ year of experience", "3 years' experience"
  addAll(new RegExp(String.raw`(?<!\d)(\d{1,2})\s*\+?\s*${YEARS}\b[^.\n]{0,60}?(?:praxe|praxi|zkusenost\w*|experience|v oboru)`, 'g'), m => Number(m[1]));
  addAll(new RegExp(String.raw`(?:praxe|praxi|zkusenost\w*|experience)[^.\n]{0,40}?(?<!\d)(\d{1,2})\s*\+?\s*${YEARS}\b`, 'g'), m => Number(m[1]));
  // "minimálně 2 roky", "at least 2 years"
  addAll(new RegExp(String.raw`${NUMBER_WORDS}\s*(?<!\d)(\d{1,2})\s*\+?\s*${YEARS}\b`, 'g'), m => Number(m[1]));
  // rozsah "0-2 roky", "1–3 years" - rozhoduje spodní hranice
  addAll(new RegExp(String.raw`(?<!\d)(\d{1,2})\s*[-–]\s*\d{1,2}\s*${YEARS}\b`, 'g'), m => Number(m[1]));
  // bez čísla: "praxe nutností", "prokazatelná praxe", "several years"
  addAll(/praxe\s+(?:nutnosti|podminkou|je nutna|je vyzadovana)/g, () => 1);
  addAll(/prokazateln\w*\s+prax\w*/g, () => 1);
  addAll(/(?:several|multiple|nekolik|vice)\s+(?:years|let|roky)/g, () => 3);

  const relevant = found.filter(f => !windowHasAdvantage(f.index, f.length));
  if (!relevant.length) return null;
  relevant.sort((a, b) => a.years - b.years);
  const best = relevant[0];
  return { years: best.years, snippet: normalized.slice(Math.max(0, best.index - 40), best.index + best.length + 40).trim() };
}

export function matchOffer(rules, { title, description }, { hideFromYears = 1 } = {}) {
  const t = normalize(title);
  const d = normalize(description);
  const hit = (list, text) => list.find(term => pattern(term).test(text));

  const neTitle = hit(rules.NE, t);
  if (neTitle) return { keep: false, why: `název: ${neTitle}`, rank: 0 };
  const praxe = hit(rules.PRAXE, `${t} ${d}`);
  if (praxe) return { keep: false, why: `praxe: ${praxe}`, rank: 0 };
  const experience = detectExperience(d);
  if (experience && experience.years >= hideFromYears) {
    return { keep: false, why: `praxe: ${experience.years}+ ${experience.years === 1 ? 'rok' : experience.years < 5 ? 'roky' : 'let'}`, rank: 0 };
  }
  const junior = startsJunior(rules, t);
  const levelTitle = hit(rules.LEVEL, t);
  if (levelTitle && !junior) return { keep: false, why: `úroveň: ${levelTitle}`, rank: 0 };
  const anoTitle = hit(rules.ANO, t);
  if (anoTitle) return { keep: true, why: junior ? `juniorská pozice (${anoTitle})` : `název: ${anoTitle}`, rank: 2 };
  const neBody = hit(rules.NE, d);
  if (neBody) return { keep: false, why: `popis: ${neBody}`, rank: 0 };
  const anoBody = hit(rules.ANO, d);
  if (anoBody) return { keep: true, why: `popis: ${anoBody}`, rank: 1 };
  return { keep: false, why: 'bez shody', rank: 0 };
}

export function employmentTags(rules, text) {
  const t = normalize(text);
  return rules.TYP.filter(term => pattern(term).test(t));
}

const REMOTE_HINT = /\bremote\b|prace z domova|home ?office|z domova|na dalku|fully remote/;
const NOT_REMOTE_HINT = /obcasn|cast[ee]cn|prilezitost|moznost/;

export function classifyLocation(config, { location = '', remote = false }) {
  const text = normalize(location);
  const city = config.cities.find(name => text.includes(normalize(name)));
  // "Možnost občasné práce z domova" není remote nabídka.
  const remoteish = remote || (REMOTE_HINT.test(text) && !NOT_REMOTE_HINT.test(text));
  const slovakia = /slovensko|bratislava|kosice|zilina|nitra|trnava|presov|banska|slovakia/.test(text);

  if (city) return { keep: true, city, isRemote: remoteish };
  if (remoteish && config.allowRemote) {
    if (slovakia && config.slovakiaRemoteOnly) return { keep: true, city: 'remote', isRemote: true, note: 'SK' };
    return { keep: true, city: 'remote', isRemote: true };
  }
  return { keep: false, city: null, isRemote: remoteish };
}
