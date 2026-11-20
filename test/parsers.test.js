import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSalary, stripHtml } from '../src/util.js';
import { parseDetail, parseListing } from '../src/sources/jobs-cz.js';
import { normalizeOffer, parseSitemap } from '../src/sources/startupjobs.js';
import { parseCsvLine } from '../src/companies.js';

test('parseSalary: rozsah i jednotlivé meze', () => {
  assert.deepEqual(parseSalary('40 000 – 45 000 Kč'), { salaryText: '40 000 – 45 000 Kč', salaryMin: 40000, salaryMax: 45000 });
  assert.equal(parseSalary('od 35 000 Kč').salaryMin, 35000);
  assert.equal(parseSalary('až 60 000 Kč').salaryMax, 60000);
  assert.equal(parseSalary('150 Kč/hod').salaryMin, null, 'hodinová mzda se neplete s měsíční');
});

test('stripHtml vyhodí značky a entity', () => {
  assert.equal(stripHtml('<p>Ahoj&nbsp;světe</p><br>další &amp; konec'), 'Ahoj světe\n\ndalší & konec');
});

test('parseListing vytáhne kartu jobs.cz', () => {
  const html = `<article class="SearchResultCard">
    <h2 class="SearchResultCard__title"><a data-jobad-id="123" href="https://www.jobs.cz/rpd/123/?searchId=x">Junior vývojář</a></h2>
    <span class="Tag">40 000 – 45 000 Kč</span>
    <span class="Tag">Práce z domova</span>
    <footer class="SearchResultCard__footer"><ul class="SearchResultCard__footerList">
      <li class="SearchResultCard__footerItem">Firma s.r.o.</li>
      <li class="SearchResultCard__footerItem">Hradec Králové</li>
    </ul></footer>
  </article>`;
  const [card] = parseListing(html);
  assert.equal(card.id, '123');
  assert.equal(card.url, 'https://www.jobs.cz/rpd/123/');
  assert.equal(card.company, 'Firma s.r.o.');
  assert.equal(card.location, 'Hradec Králové');
  assert.equal(card.remote, true);
  assert.equal(card.salary.salaryMin, 40000);
});

test('parseDetail vytáhne popis', () => {
  const html = '<div data-test="jd-body-richtext"><p>Náplň práce</p></div><div data-test="jd-salary">50 000 Kč</div>';
  const detail = parseDetail(html);
  assert.equal(detail.description, 'Náplň práce');
  assert.equal(detail.salaryText, '50 000 Kč');
});

test('parseSitemap vrátí ID nabídek', () => {
  const xml = '<loc>https://www.startupjobs.cz/nabidka/21242/foo</loc><loc>https://www.startupjobs.cz/nabidka/21242/foo</loc><loc>https://www.startupjobs.cz/nabidka/99/bar</loc>';
  assert.deepEqual(parseSitemap(xml), ['21242', '99']);
});

test('normalizeOffer: remote ano, hybrid ne', () => {
  const base = {
    name: { cs: 'Vývojář' }, description: { cs: '<p>React</p>' }, company: 1,
    locations: [{ name: { cs: 'Praha, Česko' } }], salary: null, hours: [{ id: 'full-time' }], contracts: [],
  };
  assert.equal(normalizeOffer({ ...base, locationPreferences: [{ id: 'remote' }] }).remote, true);
  assert.equal(normalizeOffer({ ...base, locationPreferences: [{ id: 'hybrid' }] }).remote, false);
});

test('normalizeOffer převede mzdu z haléřů na Kč', () => {
  const offer = normalizeOffer({
    name: { cs: 'Vývojář' }, description: { cs: '' }, company: 1, locations: [], hours: [], contracts: [],
    salary: { min: 4800000, max: 7000000, currency: 'CZK', period: 'month' },
  });
  assert.equal(offer.salary.salaryMin, 48000);
  assert.equal(offer.salary.salaryMax, 70000);
  assert.match(offer.salary.salaryText, /48\s?000/);
});

test('parseCsvLine zvládá uvozovky a čárky v názvu', () => {
  assert.deepEqual(parseCsvLine('00000078,CZ0203,"Lesní správa, Lány",27061,Lány'), ['00000078', 'CZ0203', 'Lesní správa, Lány', '27061', 'Lány']);
  assert.deepEqual(parseCsvLine('1,,,"a""b"'), ['1', '', '', 'a"b']);
});
