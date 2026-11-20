import { config } from '../config.js';
import { getJson, getText } from '../http.js';
import { getChecked, setChecked } from '../db.js';
import { classifyLocation, employmentTags, matchOffer, normalize } from '../keywords.js';
import { stripHtml } from '../util.js';

const SITEMAP = 'https://www.startupjobs.cz/sitemap/offers.xml';
const API = 'https://back.startupjobs.cz/api';

export function parseSitemap(xml) {
  return [...new Set([...String(xml).matchAll(/\/nabidka\/(\d+)\//g)].map(m => m[1]))];
}

const pick = (obj) => obj?.cs || obj?.en || '';

export function normalizeOffer(raw) {
  const countryOnly = /^(cesko|czechia|slovensko|slovakia|česko)$/;
  const locations = (raw.locations || [])
    .map(l => pick(l.name) || [l.locality && pick(l.locality), l.region && pick(l.region)].filter(Boolean).join(', '))
    .map(s => s.replace(/,\s*(Česko|Czechia|Slovensko|Slovakia)\s*$/i, '').trim())
    .filter(s => s && !countryOnly.test(normalize(s)));
  const prefs = new Set((raw.locationPreferences || []).map(p => p.id));
  const remote = prefs.has('remote') || prefs.has('fully-remote') || prefs.has('fullyremote');
  // startupjobs posílá mzdu v haléřích (50 000 Kč = 5 000 000).
  const toCzk = value => (value == null ? null : Math.round(value / 100));
  const salaryMin = toCzk(raw.salary?.min ?? raw.salary?.from ?? null);
  const salaryMax = toCzk(raw.salary?.max ?? raw.salary?.to ?? null);
  const salaryText = salaryMin
    ? `${salaryMin.toLocaleString('cs')}${salaryMax ? ' – ' + salaryMax.toLocaleString('cs') : '+'} ${raw.salary.currency ?? ''}${String(raw.salary.period ?? '').toLowerCase().startsWith('hour') ? ' /hod' : ''}`.trim()
    : '';
  const salary = { salaryMin, salaryMax, salaryText };
  return {
    title: pick(raw.name),
    description: stripHtml(pick(raw.description)),
    location: [...new Set(locations)].join(' / '),
    // Hybridní nabídka není remote: dojíždění rozhoduje lokalita.
    remote,
    employment: [...(raw.hours || []).map(h => h.id), ...(raw.contracts || []).map(c => c.id)].join(', '),
    postedAt: raw.publishedAt ?? null,
    salary,
    companyId: raw.company,
  };
}

export async function syncStartupjobs({ rules, log, db }) {
  const result = { offers: [], seen: [], companies: [] };
  const ids = parseSitemap(await getText(SITEMAP));
  result.seen.push(...ids);
  const recheckMs = (config.sources.startupjobs.recheckDays || 3) * 86400000;
  const checked = getChecked(db, 'startupjobs');
  const companyCache = new Map();
  const checkedNow = [];
  let fetched = 0;

  for (const id of ids) {
    const last = checked.get(id) ?? 0;
    if (Date.now() - last < recheckMs) continue;
    checkedNow.push(id);

    const raw = await getJson(`${API}/offers/${id}`, { headers: { Accept: 'application/json' } })
      .catch(err => {
        log(`startupjobs: přeskočeno ${id} (${err.message})`);
        return null;
      });
    if (!raw) continue;
    const offer = normalizeOffer(raw);
    const where = classifyLocation(config, offer);
    if (!where.keep) continue;

    const verdict = matchOffer(rules, offer);
    if (!verdict.keep) continue;

    let company = null;
    if (offer.companyId && !companyCache.has(offer.companyId)) {
      try {
        const c = await getJson(`${API}/companies/${offer.companyId}`, { headers: { Accept: 'application/json' } });
        companyCache.set(offer.companyId, {
          name: c.profile?.name || '',
          web: c.profile?.web || null,
          email: c.profile?.email || null,
          size: c.profile?.teamSize || null,
        });
      } catch {
        companyCache.set(offer.companyId, null);
      }
    }
    company = companyCache.get(offer.companyId) || null;

    result.seen.push(id);
    result.offers.push({
      source: 'startupjobs',
      externalId: id,
      url: `https://www.startupjobs.cz/nabidka/${id}`,
      title: offer.title,
      company: company?.name || '',
      location: offer.location,
      city: where.city,
      isRemote: where.isRemote,
      salaryMin: offer.salary.salaryMin,
      salaryMax: offer.salary.salaryMax,
      salaryText: offer.salary.salaryText,
      employment: offer.employment || employmentTags(rules, offer.title).join(', '),
      description: offer.description,
      matchWhy: verdict.why,
      matchRank: verdict.rank,
      postedAt: offer.postedAt,
    });
    if (company?.name) {
      result.companies.push({
        name: company.name,
        city: where.city === 'remote' ? null : where.city,
        careersUrl: company.web,
        email: company.email,
        source: 'startupjobs',
      });
    }
    fetched++;
    if (fetched % 25 === 0) log(`startupjobs: ${fetched} nabídek ověřeno`);
  }
  log(`startupjobs: ${result.offers.length} relevantních, ${checkedNow.length} znovu ověřeno, ${ids.length - checkedNow.length} přeskočeno (ověřeno v posledních ${config.sources.startupjobs.recheckDays} dnech)`);
  setChecked(db, 'startupjobs', checkedNow);
  return result;
}
