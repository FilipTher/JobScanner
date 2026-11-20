# JobScanner

Osobní scanner práce: stáhne nabídky pro vývojáře v Hradci Králové / Pardubicích a remote, profiltruje je podle `Key words.txt`, a k tomu vede seznam firem na oslovení. Běží lokálně, data u tebe v `data/jobs.db`.

## Spuštění

```powershell
npm install
npm start
```

Otevři <http://localhost:3000>. Tlačítko **Aktualizovat nabídky** stáhne nové inzeráty, **Import firem z ČSÚ** načte firmy v oboru IT (stáhne ~545 MB CSV, jednou za měsíc).

První stažení startupjobs.cz trvá několik minut (prochází ~390 nabídek po jedné). Další běhy jsou rychlé — nabídky ověřené v posledních 3 dnech se přeskakují.

## Jak funguje filtr

`Key words.txt` je jediný zdroj pravidel, aplikace ho čte při každém stažení:

- `JUNIOR:` — když pozice **začíná** tímto slovem, projde i přes `LEVEL` (`Junior projektový manažer`).
- `LEVEL:` — úroveň pozice; v názvu vylučuje (`Senior vývojář`, `Team Lead`, `Specialist`).
- `ANO:` — stačí shoda v názvu nebo popisu.
- `NE:` — vylučuje všude, název i popis (helpdesk, podpora, obchod, DevOps, správce sítě, „3+ roky praxe“).
- `TYP:` — jen štítek typu úvazku (full-time, DPP…), nic nefiltruje.
- `re:` na začátku řádku = regulární výraz, např. `re:([3-9]|\d{2})\+?\s*(let|rok)`.

Porovnává se bez diakritiky a bez ohledu na velikost písmen. U anglických slov se hlídá hranice slova (`Java` nechytí `JavaScript`), česká slova se matchují jako podřetězec kvůli koncovkám.

Každá nabídka má u sebe štítek, **proč** prošla filtrem (`název: Vývojář`, `popis: React`) — podle něj poznáš, co filtr pustil omylem, a doladíš slova.

Kromě slov se z popisu vytahuje **požadovaná praxe**: vzory jako „2 roky praxe“, „minimálně 3 roky“, „1+ year of experience“, „At least 3 years' experience“, „praxe nutností“. Nabídka se schová, když požadavek dosáhne `hideIfRequiresYears` z `config.json` (výchozí 1 rok). Zmínky typu „2 roky praxe **výhodou**“ nebo „zkušenosti vítané“ se ignorují a nabídka zůstane.

Lokalita: `config.json` → `cities` (HK, Pardubice) + remote. Slovenské nabídky projdou jen jako remote (`slovakiaRemoteOnly`).

## Ruční spuštění bez UI

```powershell
npm run sync              # oba zdroje
npm run sync jobs.cz      # jen jeden zdroj
npm run sync refilter     # jen přefiltrovat uložené nabídky novými pravidly (bez stahování)
npm run companies         # import firem z ČSÚ (--force = stáhnout CSV znovu)
npm test
```

## Filtry v UI

Město, zdroj, stav a fulltext (název + firma + popis). Stavy nabídky: nové → posláno → odpověď / zamítnuto / nezajímá. „Nové“ znamená poprvé stažené a dosud nepřečtené.

## Zdroje

| Zdroj | Co dává | Poznámka |
|---|---|---|
| jobs.cz | nabídky + plný popis | scraping výpisů `/prace/{profese}/`, robots.txt povoluje; 1 req/s |
| startupjobs.cz | nabídky, strukturovaný plat, remote | veřejné API `back.startupjobs.cz`, robots `Allow: /` |
| ČSÚ RES | firmy v oboru IT (CZ-NACE 58/62/63) v okresech HK a Pardubice | open data, jednorázový import |
| ARES | — | nevyužito: chybí hromadný filtr podle oboru |

Vynechané zdroje a proč:

- **NoFluffJobs** — má v HK i Pardubicích nula nabídek (polský portál s českou lokalizací).
- **MPSV (Úřad práce)** — 183 MB JSON, žádné popisy a v IT jen pár nabídek od agentur na celou ČR; poměr práce k užitku špatný.
- **LinkedIn, Indeed** — zákaz scrapingu v ToS, technicky blokované; **Adzuna** ČR vůbec nekryje.

## Omezení

- Scrape jobs.cz závisí na struktuře HTML — při změně webu se musí upravit `src/sources/jobs-cz.js`.
- Kariérní stránky a e-maily firem nejsou v žádném veřejném datasetu. U firem ze startupjobs.cz se bere e-mail/web z jejich profilu, u firem z ČSÚ se odkazuje na hledání „firma kariéra“.
- Nabídky se mezi zdroji nededuplikují (stejná pozice na jobs.cz i startupjobs bude dvakrát).
- ČSÚ CSV má u malých firem obor často nevyplněný nebo nepřesný, takže seznam firem má díry.

Přidání města: `config.json` → `cities` (+ `companyDistricts` s kódy okresů CZ-NUTS, např. `CZ0521`).
