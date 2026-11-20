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

export function matchOffer(rules, { title, description }) {
  const t = normalize(title);
  const d = normalize(description);
  const hit = (list, text) => list.find(term => pattern(term).test(text));

  const neTitle = hit(rules.NE, t);
  if (neTitle) return { keep: false, why: `název: ${neTitle}`, rank: 0 };
  const praxe = hit(rules.PRAXE, `${t} ${d}`);
  if (praxe) return { keep: false, why: `praxe: ${praxe}`, rank: 0 };
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
