# Roomies SEO/PSEO Keyword Analysis

_Last updated: 2026-06-15_

## ⚠️ Honesty first

No live volume data feeds this doc yet (no Search Console / Google Keyword Planner / Ahrefs connected). Priority tiers below are **inferred** from market structure + what competitors spend pages on — not measured search volume. Validate exact volume once the site is live, using Google Keyword Planner + Search Console.

Tier legend: 🔥 high · ⬆ med · ▪ low / long-tail.

Current state of the site (baseline):
- SPA only — **zero PSEO landing pages built**.
- **No `sitemap.xml`** (yet `robots.txt` already points to one).
- `llms.txt` is just "TODO".
- Per-route meta only lives in `index.html`; Cloudflare Worker rewrites OG meta.

---

## 1. Competitor landscape

| Site | PSEO URL pattern | Angle |
|------|------------------|-------|
| **findroommate.dk** | `/vaerelser/{by}/{kvarter}`, `/studiebolig/{by}` | market leader, deep geo tree |
| **boligportal.dk** | `/find-roomie-{by}/c/`, `/studieboliger-{by}/c/` | biggest portal; "BoligAgent" = our SøgeAgent |
| **findroomie.dk** | `/{by}_studieboliger`, `/{by}_findroomie` | roomie-first |
| **boligskift.dk** | `/vaerelser-til-leje-{by}`, `/studieboliger-{by}` | geo landing pages |
| **roomme.dk / roomii.dk** | `/by/{by}/` | small, beatable |
| **dba.dk** | search-query pages ("roomie søges") | classifieds |

**Takeaway:** the whole market is built on **geo × intent landing pages**. Competitor title formula: `Værelse til leje i {By} [1000+ Værelser til leje lige nu]` — count + "lige nu" social proof. Roomies has none of these pages. Biggest gap = biggest opportunity.

---

## 2. Keyword universe (by cluster)

### A. Head terms — rooms 🔥
| Keyword | Intent | Priority |
|---|---|---|
| værelse til leje | find room | 🔥🔥 |
| ledige værelser | find room | 🔥 |
| værelse leje / lej værelse | find room | 🔥 |
| lejebolig / lejeværelse | find room | ⬆ |
| billige værelser | budget | ⬆ |

### B. Roommate cluster 🔥 (brand differentiator — "roomie" not "lejer")
| Keyword | Intent | Priority |
|---|---|---|
| find roomie / find roommate | match person | 🔥 |
| roomie søges / bofælle søges | match person | 🔥 |
| find bofælle | match person | ⬆ |
| delelejlighed / delebolig | shared flat | ⬆ |
| roommate københavn | geo match | ⬆ |

### C. Geo-modified — **the PSEO goldmine** 🔥🔥
Pattern: `{head term} {by}` and `{head term} {kvarter}`. Highest-converting, lowest-competition-per-page.
- **Byer:** København, Aarhus, Odense, Aalborg, Esbjerg, Roskilde, Kolding, Vejle, Horsens, Randers, Aabenraa, …
- **København kvarterer:** Nørrebro, Vesterbro, Østerbro, Amager, Frederiksberg, Valby, Vanløse, Nordvest, Sydhavn, Christianshavn.
- Examples: `værelse til leje københavn` 🔥🔥 · `værelse nørrebro` 🔥 · `værelse aarhus` 🔥 · `værelse vesterbro` ⬆.

### D. Student cluster 🔥 (peaks Jun–Aug, study start)
| Keyword | Priority |
|---|---|
| studiebolig {by} | 🔥 |
| ungdomsbolig / kollegie {by} | ⬆ |
| studievenlig værelse | ▪ |
| bolig til studiestart | ⬆ seasonal |

### E. Transaction / supply side ⬆ (feeds `/udlej-vaerelse`)
| Keyword | Priority |
|---|---|
| udlej værelse / lej værelse ud | ⬆ |
| fremleje værelse | ⬆ |
| værelse udlejes {by} | ⬆ |

### F. Long-tail / informational (blog territory) ▪
"værelse under 4000 kr", "værelse med egen indgang", "hvordan finder man roomie", "depositum værelse regler", "fremleje regler". Low volume, high intent, cheap to own via blog.

---

## 3. PSEO strategy

### URL templates to build
```
/vaerelser/{by}                  → "Værelse til leje i {By}"
/vaerelser/{by}/{kvarter}        → "Værelse til leje på {Kvarter}, {By}"  (Kbh first)
/studiebolig/{by}                → "Studiebolig & værelser i {By}"
/find-roomie/{by}                → "Find roomie i {By}"
```

**Slug rule:** ASCII like competitors — `koebenhavn`, `noerrebro` (æ→ae, ø→oe, å→aa). Match what Google already indexes.

### Scale math
~20 byer × 3 templates ≈ 60 pages + ~10 Kbh kvarterer ≈ **70–90 pages** from one generator. Geo data already exists: `postalData` + area ranges in `roomies/config/hardcoded_data.js`. Backend can expand postal → city → live count per page.

### Page anatomy (each PSEO page needs)
- `<h1>` = exact keyword ("Værelse til leje i Aarhus").
- Live room count + freshness ("Opdateret i dag · 47 ledige").
- Real listing cards (server- or pre-rendered for crawl).
- Short **unique** Danish intro paragraph (warm tone, anti-scam) — not duplicated across pages.
- CTA: SøgeAgent signup ("Få besked når nyt værelse i {By}").
- Internal links to sibling byer/kvarterer (link mesh).

### Priority order
1. København + 10 kvarterer (most volume).
2. Aarhus, Odense, Aalborg (student cities).
3. `studiebolig {by}` set (launch before August study-start).
4. Remaining byer.
5. `find-roomie {by}` set.

---

## 4. Technical SEO gaps (fix before/with PSEO)

| Gap | Status | Fix |
|---|---|---|
| `sitemap.xml` | ❌ missing (robots points to it) | generate in `build.js`; list all PSEO + core routes |
| `llms.txt` | "TODO" | fill — cheap AI-search win |
| Per-route meta | only in `index.html` | Cloudflare Worker already rewrites OG meta — extend to inject per-PSEO title/desc |
| Prerender for crawl | SPA fetches rooms client-side | PSEO pages need server/edge-rendered content (Googlebot renders JS but slowly/unreliably for fresh listings) |
| robots disallows | lists andelsbolig routes (`/saelger`, `/ai-analyse`) not in roomies | clean up |

---

## 5. Recommended target list (start here)

- **Tier 1 (build first):** værelse til leje københavn · værelse nørrebro · værelse vesterbro · værelse østerbro · værelse amager · studiebolig københavn · find roomie københavn
- **Tier 2:** værelse til leje aarhus · studiebolig aarhus · værelse odense · værelse aalborg · find bofælle
- **Tier 3 (blog / long-tail):** fremleje regler · depositum værelse · hvordan finder man en god roomie · billige værelser under 4000

---

## 6. Next steps

1. **PSEO generator** (`build.js` + backend count endpoint → 70+ geo pages).
2. **`sitemap.xml` generator** in `build.js`.
3. Fill **`llms.txt`**.
4. **On-page meta** upgrade for existing `/ledige-vaerelser` + `/vaerelse`.

Recommended pairing: **#2 + #1 together** — a sitemap is useless without pages, and pages are useless uncrawled. For hard volume numbers first, export Google Keyword Planner data and convert the estimated tiers above into measured volume.

---

## Sources

- https://www.findroommate.dk/vaerelser/koebenhavn
- https://www.findroommate.dk/studiebolig/aarhus
- https://www.boligportal.dk/find-roomie-koebenhavn/c/
- https://www.boligportal.dk/studieboliger-aarhus/c/
- https://findroomie.dk/
- https://boligskift.dk/vaerelser-til-leje-kobenhavn
- https://roomme.dk/by/aarhus/
- https://www.dba.dk/boliger/lejebolig/vaerelser/?soeg=roomie+s%C3%B8ges
