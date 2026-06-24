# PSEO Generator — Review & Action List

Review of `andelsbolig-backend/andelsbolig/a_roomies/pseo/generate_pseo_roomiedanmark.py`.
Goal context: ship many SEO-optimized static pages that earn clicks from Google before the August `studiebolig` peak.

Work top-to-bottom. Items are ordered worst-first. Check them off as you go.

> Line references point at the generator file in the **backend** repo unless noted.

---

## What already works (don't touch)

- Per-intent differentiation per §4.5: distinct intro / FAQ / supporting module / listing sort for `studiebolig` vs `vaerelser` vs `lejebolig`.
- Inventory tiering gates (`can_emit_studiebolig`, `can_emit_lejebolig`) — 2nd/3rd intent page on a city needs a higher bar.
- `get_total_monthly_price()` includes acconto — consistent with the room-card fix in the frontend (`roomies/rooms/roomCard.js`).
- Full structured data: `CollectionPage`, `BreadcrumbList`, `FAQPage`, `RealEstateListing`, `ProfilePage`.
- Canonical / OG / Twitter injection, breadcrumbs, sitemap, `llms.txt`, orphan cleanup via previous inventory.

---

## HIGH — fix before launch

### 1. URL duplication trap: `/vaerelse/{slug}-{id}` vs `/vaerelse?id=`
- [ ] Confirm the SPA router resolves the path form `/vaerelse/{slug}-{id}` (extracts the id from the path, not just `?id=`).
- [ ] Make the static detail page and the SPA deep-links agree on ONE canonical URL form.
- [ ] Update `roomies/rooms/roomCard.js` (and any other `?id=` links) so internal links match the chosen canonical.

**Why:** `room_path()` (generator ~line 226) emits `/vaerelse/{slug}-{id}` with a self-canonical, but the SPA and room cards link to `/vaerelse?id=…`. Two live URLs for the same listing = duplicate content + split link signals. This is the exact trap the plan §7 warned about. Also: if the router can't hydrate the path form, Google clicks land on a broken page.

### 2. Self-canonical everywhere undercuts the §4.5 canonical plan
- [ ] Decide consciously: does `/lejebolig/{by}` self-canonical, or fold (`rel=canonical`) to `/vaerelser/{by}`?
- [ ] If keeping self-canonical, commit to defending it with genuinely distinct copy (see item 6).
- [ ] Re-check after launch in GSC: if lejebolig and vaerelser compete for the same queries with the same listings, canonicalize lejebolig → vaerelser.

**Why:** `render_html` (~line 1103) self-canonicals every page. `/studiebolig/{by}`, `/vaerelser/{by}`, `/lejebolig/{by}` serve the **same room set**, only re-sorted. The plan made vaerelser the canonical inventory home; right now there's no mechanism to demote the weaker twin.

### 3. Mass thin leaf pages (one per room + one per seeker)
- [ ] `noindex` rented / `OutOfStock` rooms and very-thin rooms (no description AND no images) — keep crawlable for the mesh, out of the index.
- [ ] Add `ItemList` / `numberOfItems` to the city `CollectionPage` so money pages outweigh the leaf pages.
- [ ] Sanity-check total page count at real inventory volume (dry run) — watch for thousands of thin detail pages.

**Why:** the loop (~line 993) emits a page for every room including rented; the profile loop (~line 1008) one per seeker. Many detail pages are thin and near-identical ("Værelse til leje i {location}") → thin-content dilution + crawl-budget waste.

### 4. Privacy + scope: the find-roomie / profile tier
- [ ] Confirm explicit user consent to publish a public, Google-indexed personal page (first name, photo, description, budget, interests) when `seeking_room` is on.
- [ ] If consent isn't explicit, `noindex` the profile + find-roomie pages.
- [ ] Decide deliberately whether to build this tier at all — plan §0/§7 says **don't** target "roomie/roommate" keywords (~1,200/mo).

**Why:** `build_profile_page` / `build_find_roomie_city_page` (~line 822+) publish personal data and target keywords the plan told us to skip. GDPR/consent risk + off-plan scope.

---

## MEDIUM

### 5. Meta description: too long and duplicates the on-page intro
- [ ] Generate a separate meta description, ≤155 chars, keyword + live count front-loaded.
- [ ] Stop reusing the hero intro string as the meta description.

**Why:** `build_city_page` sets `description = city_intro(...)` and also renders it as the hero intro. Intros run ~200–280 chars → SERP-truncated, and meta == visible text.

### 6. Intro / FAQ skeleton identical across cities
- [ ] Weave real geo facts into each intro (universities for studiebolig, p25–p75 price band for vaerelser, neighborhood names for both) so paragraphs diverge structurally, not just by city name.
- [ ] Vary at least one FAQ question per city where a real local fact exists.

**Why:** `city_intro` / `city_faq` are find-and-replace with a couple of interpolated numbers — exactly what §7 warns against. The real facts already exist (universities, neighborhoods, price band) but only appear in the module, not the intro.

### 7. Trailing-slash canonical consistency (Cloudflare Pages)
- [ ] Verify what Pages actually serves: `/vaerelser/aarhus` vs `/vaerelser/aarhus/`.
- [ ] Make canonical URLs + sitemap entries match the served form exactly (incl. trailing slash).

**Why:** canonicals are emitted without a trailing slash, but Pages serves `…/index.html` and often normalizes to a trailing slash → self-inflicted canonical mismatch.

### 8. robots.txt cleanup (roadmap Phase 0)
- [ ] Remove stale andelsbolig `Disallow`s (`/saelger`, `/ai-analyse`, `/boligerovervaagning-*`) that don't exist on roomies.
- [ ] Keep `Allow: /` + the `Sitemap:` line.
- [ ] Decide whether the generator should own robots.txt or it's maintained by hand.

**Why:** `main()` writes sitemap + `llms.txt` but never touches robots.txt. Plan §3.5 flagged this as Phase 0 — nothing ranks without crawl plumbing.

---

## LOW / polish

- [ ] **Studiebolig/lejebolig hub mesh:** sibling links are always `/vaerelser/*`. Add intent-internal sideways links so those hubs link city→sibling-city within the same intent.
- [ ] **Hub counts overcount:** `build_root_hub` (~line 718) sums all cities, not just the intent's emitted cities.
- [ ] **`city_image` never set:** all heroes render flat dark. Add city hero images (helps OG/CTR, not core SEO).
- [ ] **Slug churn:** `room_path` embeds the title, so editing a title changes the URL → 404 churn. Consider canonical-by-id for stability.
- [ ] **Sitemap splitting:** add a sitemap index if per-room + per-profile pages push total URLs toward the 50k limit.

---

## Suggested order of attack

1. Items 1 + 2 + 7 together — settle the canonical/URL story once (detail form, intent canonicals, trailing slash). Everything else builds on this.
2. Item 3 — gate the leaf pages (noindex rules).
3. Item 4 — consent/scope decision on profiles.
4. Items 5 + 6 — tighten meta + intro/FAQ uniqueness.
5. Item 8 — robots.txt.
6. Low-priority polish.
