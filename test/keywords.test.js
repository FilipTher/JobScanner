import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLocation, matchOffer, normalize, parseKeywords } from '../src/keywords.js';

const rules = parseKeywords(`
JUNIOR:
Junior, Absolvent
LEVEL:
Senior, Lead, Manager, Specialist
ANO:
Vývojář, Junior, JavaScript, Java
TYP:
Full-time, DPP
NE:
Helpdesk, System Administrator
re:([3-9]|\\d{2})\\+?\\s*(let|rok|roky)\\b
`);

test('normalize odstraní diakritiku a sjednotí pomlčky', () => {
  assert.equal(normalize('Vývojář – Junior'), 'vyvojar - junior');
});

test('juniorská pozice na začátku názvu přebije LEVEL', () => {
  const v = matchOffer(rules, { title: 'Junior projektový manažer', description: 'Hledáme managera' });
  assert.equal(v.keep, true);
});

test('LEVEL v názvu vylučuje i přes ANO', () => {
  assert.equal(matchOffer(rules, { title: 'Senior vývojář', description: '' }).keep, false);
});

test('junior na konci názvu LEVEL nepřebije', () => {
  assert.equal(matchOffer(rules, { title: 'Lead Generation Specialist | vhodné i pro juniory', description: '' }).keep, false);
});

test('jiná profese v názvu vylučuje i pro juniora', () => {
  assert.equal(matchOffer(rules, { title: 'Junior System Administrator', description: 'Linux' }).keep, false);
});

test('NE v popisu vylučuje, pokud název nic netvrdí', () => {
  assert.equal(matchOffer(rules, { title: 'Pracovník', description: 'Požadujeme minimálně 5 let praxe.' }).keep, false);
});

test('ANO v popisu stačí, když název nic neříká', () => {
  const v = matchOffer(rules, { title: 'Pracovník', description: 'Náplní je vývoj aplikace v JavaScriptu.' });
  assert.equal(v.keep, true);
  assert.equal(v.rank, 1);
});

test('krátké ASCII slovo se nechytá uvnitř jiného slova', () => {
  const onlyJava = parseKeywords('ANO:\nJava\nNE:');
  assert.equal(matchOffer(onlyJava, { title: 'JavaScript konzultant', description: '' }).keep, false, 'Java nesmí chytit JavaScript');
});

test('bez shody vylučuje', () => {
  assert.equal(matchOffer(rules, { title: 'Zedník', description: 'Práce na stavbě.' }).keep, false);
});

const config = { cities: ['Hradec Králové', 'Pardubice'], allowRemote: true, slovakiaRemoteOnly: true };

test('lokalita: město projde, cizí město ne', () => {
  assert.equal(classifyLocation(config, { location: 'Hradec Králové – centrum' }).keep, true);
  assert.equal(classifyLocation(config, { location: 'Brno' }).keep, false);
});

test('lokalita: remote projde, slovenské onsite ne', () => {
  assert.equal(classifyLocation(config, { location: 'Remote' }).city, 'remote');
  assert.equal(classifyLocation(config, { location: 'Bratislava' }).keep, false);
  assert.equal(classifyLocation(config, { location: 'Bratislava', remote: true }).keep, true);
});

test('lokalita: občasný home office není remote', () => {
  assert.equal(classifyLocation(config, { location: 'Praha – Kobylisy' }).keep, false);
  assert.equal(classifyLocation(config, { location: 'Možnost občasné práce z domova' }).keep, false);
  assert.equal(classifyLocation(config, { location: 'Práce z domova' }).keep, true);
});
