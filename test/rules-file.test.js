import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadKeywords, matchOffer } from '../src/keywords.js';
import { root } from '../src/config.js';

// End-to-end test na skutečný Key words.txt - hlídá, že soubor zůstane použitelný.
const rules = loadKeywords(path.join(root, 'Key words.txt'));
const matches = (title, description = '') => matchOffer(rules, { title, description }).keep;

test('skutečná pravidla: juniorní vývojář projde', () => {
  assert.equal(matches('Junior vývojář'), true);
  assert.equal(matches('JUNIOR JAVA Developer pro core systémy'), true);
  assert.equal(matches('Junior projektový manažer'), true);
});

test('skutečná pravidla: juniorní obchodní/ne-IT pozice neprojde', () => {
  assert.equal(matches('Junior Esport Trader'), false);
  assert.equal(matches('Junior obchodní zástupce'), false);
});

test('skutečná pravidla: senior, lead, helpdesk a správce neprojdou', () => {
  assert.equal(matches('Senior vývojář'), false);
  assert.equal(matches('Team Lead – backend'), false);
  assert.equal(matches('Junior System Administrator'), false);
  assert.equal(matches('IT podpora uživatelů'), false);
  assert.equal(matches('Programátor', 'Požadujeme 5 let praxe v oboru.'), false);
  assert.equal(matches('Vývojář', 'Jsme na trhu 5 let a hledáme posilu.'), true, 'stáří firmy není praxe');
});

test('skutečná pravidla: běžná nabídka projde přes technologii v popisu', () => {
  assert.equal(matches('Pracovník IT oddělení', 'Náplní je vývoj v Reactu a Node.js.'), true);
});
