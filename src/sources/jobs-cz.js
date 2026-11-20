import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { getText } from '../http.js';
import { classifyLocation, employmentTags, matchOffer, normalize } from '../keywords.js';
import { parseSalary, stripHtml } from '../util.js';

const BASE = 'https://www.jobs.cz';

export function parseListing(html) {
  const $ = cheerio.load(html);
  return $('article.SearchResultCard').map((_, el) => {
    const link = $(el).find('a[data-jobad-id]').first();
    const href = link.attr('href') || '';
    const id = link.attr('data-jobad-id') || href.match(/\/rpd\/(\d+)/)?.[1];
    const footer = $(el).find('.SearchResultCard__footerItem').map((_, f) => $(f).text().trim()).get();
    const tags = $(el).find('.Tag').map((_, t) => $(t).text().trim()).get();
    const salaryTag = tags.find(t => /kč|eur/i.test(t) && /\d/.test(t)) || '';
    return {
      id,
      title: link.text().trim(),
      url: href.split('?')[0],
      company: footer[0] || '',
      location: footer[1] || '',
      remote: tags.some(t => /prace z domova|home ?office|remote|dalky/i.test(normalize(t)) && !/obcasn|moznost|prilezitost/i.test(normalize(t))),
      tags,
      salary: parseSalary(salaryTag),
    };
  }).get().filter(c => c.id && c.title);
}

export function parseDetail(html) {
  const $ = cheerio.load(html);
  return {
    description: stripHtml($('[data-test=jd-body-richtext]').first().html() || ''),
    salaryText: $('[data-test=jd-salary]').first().text().trim(),
  };
}

export async function syncJobsCz({ rules, log }) {
  const result = { offers: [], seen: [], companies: [] };
  const { professions, maxPages } = config.sources.jobsCz;

  const seenIds = new Set();

  for (const slug of professions) {
    for (let page = 1; page <= maxPages; page++) {
      // page=1 občas vrací jinou (kampaní) variantu stránky, proto bez parametru + jeden pokus navíc.
      const url = page === 1 ? `${BASE}/prace/${slug}/` : `${BASE}/prace/${slug}/?page=${page}`;
      let cards = parseListing(await getText(url));
      if (!cards.length) {
        await new Promise(r => setTimeout(r, 3000));
        cards = parseListing(await getText(url));
        if (!cards.length) break;
      }
      // Poslední stránky vrací znovu stejné "doporučené" karty - končíme, když nic nového.
      const fresh = cards.filter(card => !seenIds.has(card.id));
      for (const card of fresh) seenIds.add(card.id);
      if (!fresh.length) break;
      log(`jobs.cz ${slug}: strana ${page}, ${fresh.length} nabídek`);

      for (const card of fresh) {
        const where = classifyLocation(config, card);
        if (!where.keep) continue;

        let detail;
        try {
          detail = parseDetail(await getText(card.url));
        } catch (err) {
          log(`jobs.cz: přeskočeno ${card.url} (${err.message})`);
          continue;
        }
        const description = detail.description;
        const verdict = matchOffer(rules, { title: card.title, description });
        if (!verdict.keep) continue;

        const salary = detail.salaryText ? parseSalary(detail.salaryText) : card.salary;
        result.seen.push(card.id);
        result.offers.push({
          source: 'jobs.cz',
          externalId: card.id,
          url: card.url,
          title: card.title,
          company: card.company,
          location: card.location,
          city: where.city,
          isRemote: where.isRemote,
          salaryMin: salary.salaryMin,
          salaryMax: salary.salaryMax,
          salaryText: salary.salaryText,
          employment: employmentTags(rules, [card.title, ...card.tags, description].join(' ')).join(', '),
          description,
          matchWhy: verdict.why,
          matchRank: verdict.rank,
          postedAt: null,
        });
        if (card.company) {
          result.companies.push({ name: card.company, city: where.city === 'remote' ? null : where.city, source: 'jobs.cz' });
        }
      }
    }
  }
  return result;
}
