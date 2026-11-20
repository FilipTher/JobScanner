import { config } from './config.js';

const chains = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Jeden požadavek na doménu za requestGapMs, aby jsme portály nezatěžovali a nedostali ban.
export function politeFetch(url, init = {}, { gapMs = config.requestGapMs, retries = 2 } = {}) {
  const host = new URL(url).host;
  const prev = chains.get(host) ?? Promise.resolve();
  const task = prev.then(async () => {
    for (let attempt = 0; ; attempt++) {
      await sleep(gapMs);
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': config.userAgent, ...(init.headers || {}) },
      });
      if (res.ok) return res;
      if (attempt >= retries || (res.status < 500 && res.status !== 429)) {
        throw new Error(`HTTP ${res.status} ${url}`);
      }
      await sleep(5000 * (attempt + 1));
    }
  });
  chains.set(host, task.catch(() => {}));
  return task;
}

export async function getText(url, init = {}, opts) {
  return (await politeFetch(url, init, opts)).text();
}

export async function getJson(url, init = {}, opts) {
  return (await politeFetch(url, init, opts)).json();
}
