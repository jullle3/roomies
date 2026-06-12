# Ad Placement Ideas — RoomieDanmark

Monetization plan for the free site: sell native ad slots to brands matching the target group (students / young professionals moving into shared homes) — e.g. IKEA, insurance companies, telecom, banks, moving services.

## Guiding principle

Keep ads **native and non-intrusive** — styled to match the warm, tactile design system, never banner-spam. A free community site lives or dies on trust, so:

- Always label clearly: **"Sponsoreret"** pill (also required by Danish ad/marketing law).
- Max **one ad per screen** in view at a time.
- Match card styling (rounded corners, soft shadow, coral accents) — no harsh IAB banners.

Reference checked: trustmrr.com uses only a single native "Powered by" footer credit — minimal, native, non-intrusive. Confirms the native model over banners, but offered little concrete layout to copy.

---

## Placements (ranked by value)

### 1. In-feed sponsored card — *start here*
Inject a sponsored card into the `ledige-vaerelser` search-results grid, styled like a `.room-card` sibling with a small "Sponsoreret" pill.

- Frequency: one per `Vis mere` batch (e.g. position 6 of every 18).
- Example: IKEA — "Indret dit nye værelse" with product shot.
- Scales for free across desktop grid + mobile single-column flow.
- Build data-driven: sponsor list → inject every N cards, so advertisers are just data.

### 2. Detail-view ad — *high intent*
A user reading a room detail is about to move → peak moment for insurance + furniture.

- **Desktop:** sticky ad in the contact-card sidebar column.
- **Mobile:** one native block inline between sections (after description, before map).

### 3. Post-action moment — *highest intent, lowest volume*
After "Send besked" or "Opret annonce": small native card —
"Skal du flytte? Indboforsikring fra X". Insurance pays most for this intent.

### 4. Mobile sticky bottom bar
Slim, dismissible, bottom-anchored. High viewability.

- Use one at a time, must be closeable.
- Desktop: skip — lean on #1 / #2 instead.

### 5. Landing "Partnere" strip
Logo row / single hero sponsor near footer. Low CPM but good for flat brand deals
(e.g. IKEA logo + tagline). Brand-trust play, not performance.

---

## Recommended first step

Ship **#1 (in-feed) + #2 (detail)** as the core:

- Both native, both scale mobile + desktop.
- No new pages required.
- Data-driven sponsor list so adding advertisers = editing data, not code.

## Target advertisers

- **Furniture / home:** IKEA, JYSK, Sinnerup
- **Insurance:** indboforsikring (Tryg, Alka, GF, Gjensidige)
- **Telecom / internet:** YouSee, Telia, Hiper
- **Banking / fintech:** Lunar, students banks
- **Moving / logistics:** flyttefirmaer, deleby/storage
