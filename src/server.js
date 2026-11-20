import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { config, root } from './config.js';
import { getMeta, listCompanies, listOffers, openDb, updateCompany, updateOffer } from './db.js';
import { runSync } from './sync.js';
import { importRes } from './companies.js';

const db = openDb();
const app = new Hono();
const job = { running: false, kind: null, log: [], summary: null, error: null };

function start(kind) {
  if (job.running) return { started: false };
  Object.assign(job, { running: true, kind, log: [], summary: null, error: null });
  const log = message => {
    job.log.push(message);
    if (job.log.length > 300) job.log.shift();
  };
  const task = kind === 'sync' ? runSync({ log, db }) : importRes({ log, db });
  task
    .then(summary => { job.summary = summary; })
    .catch(err => { job.error = String(err?.message || err); })
    .finally(() => { job.running = false; });
  return { started: true };
}

app.get('/api/offers', c => c.json(listOffers(db, c.req.query())));
app.patch('/api/offers/:id', async c => {
  updateOffer(db, Number(c.req.param('id')), await c.req.json());
  return c.json({ ok: true });
});

app.get('/api/companies', c => c.json(listCompanies(db, c.req.query())));
app.patch('/api/companies/:key', async c => {
  updateCompany(db, decodeURIComponent(c.req.param('key')), await c.req.json());
  return c.json({ ok: true });
});

app.post('/api/sync', c => c.json(start('sync')));
app.post('/api/companies/import', c => c.json(start('companies')));
app.get('/api/status', c => c.json({ ...job, lastSync: getMeta(db, 'last_sync'), lastImport: getMeta(db, 'companies_import') }));
app.get('/api/config', c => c.json({ cities: config.cities }));

app.use('/*', serveStatic({ root: path.join(root, 'public') }));
app.get('*', serveStatic({ path: path.join(root, 'public', 'index.html') }));

serve({ fetch: app.fetch, port: config.port }, info => {
  console.log(`JobScanner běží na http://localhost:${info.port}`);
});
