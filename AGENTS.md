# AGENTS.MD - roomies Frontend Context

Read this file first. It is the compact entrypoint for AI agents working in the roomies frontend. Use the linked `ai_docs/` files for deeper context.

## Critical Rules

- Do not edit bundled/generated files directly: `roomies/mergedJS.js`, `roomies/mergedStyles.css`, generated PSEO HTML under `tilsalg/`, `bytte/`, `alle-boliger/`, and `omraader/`, or `sitemap.xml` unless the user explicitly asks for generated output changes.
- Do not read bundled/minified files for source truth. Read source modules under `roomies/` instead.
- Do not copy secrets, tokens, passwords, API keys, webhook secrets, or exact credential values into code or docs. Frontend publishable keys may be public, but still avoid duplicating exact values in AI docs.
- Preserve the manual vanilla SPA architecture. Do not introduce React, Vue, Angular, TypeScript, or a router framework unless the user explicitly asks for that migration.
- After code changes, `npm run build` is normally needed to regenerate bundles and bump the asset version in `index.html`. Do not run it for documentation-only changes.

## Engineering Discipline

- Think before changing code. If a request has multiple plausible meanings that affect product behavior, auth, payments, routing, data persistence, or backend contracts, surface the ambiguity before implementing. For smaller UI/details, make a conservative assumption and proceed.
- Keep changes surgical. Every changed line should trace directly to the user request or to cleanup caused by that request.
- Prefer the simplest implementation that solves the problem. Do not add speculative abstractions, configurability, or future-proofing unless it clearly reduces current complexity or matches an existing local pattern.
- Match the existing code style and architecture, even when a different style might be cleaner in isolation.
- Do not refactor, reformat, rename, or “clean up” adjacent code unless it is necessary for the requested change. If unrelated issues are discovered, mention them instead of fixing them silently.
- Remove unused imports, variables, functions, and comments only when they were made obsolete by your own changes.

## Project Snapshot

roomies is a Danish cooperative-housing platform for buying, selling, and swapping `andelsboliger`.

- Architecture: static vanilla JS SPA with route-like static SEO pages.
- UI stack: HTML5, CSS, Bootstrap 5, jQuery, FontAwesome, Lottie, noUiSlider, Google Maps marker clustering.
- Hosting: Cloudflare Pages with `_redirects`, `_headers`, and a Cloudflare Worker for SEO metadata rewriting.
- Backend: FastAPI API hosted separately. Frontend API routing is centralized through `authFetch(...)`.
- Data loading preference: when practical, load small shared datasets upfront into global, shareable variables. Most frontend datasets are only a few MB, so this reduces repeated network requests and keeps SPA navigation feeling smooth and fast.
- SPA data architecture: prefer background preloading on init for commonly reused, heavily cached data, then let list/map/detail/create views reuse the same local cache or shared promise where possible. Treat preloaded data as a fast shared cache, not the final source of truth: route-specific views that require correctness should do a targeted fallback fetch when the shared cache misses or fails (for example detail can fall back to a single `/advertisement/{id}` fetch rather than refetching the full list).
- Build: `build.js` bundles source JS to `roomies/mergedJS.js`, concatenates/minifies CSS to `roomies/mergedStyles.css`, and increments `roomies_version` in `index.html`.

## Active Source Surface

Main source code lives in `roomies/`.

Important entrypoints:

- `roomies/main.js`: startup, global background fetches, view setup, post-load landing stats.
- `roomies/views/viewManager.js`: manual SPA routing, auth/paywall gating, PSEO bypass, view data loading, meta updates.
- `roomies/auth/auth.js`: `authFetch(...)`, JWT attachment, Cloudflare-vs-direct API routing.
- `roomies/utils.js`: global user state, messages, Stripe script/config, image shrinking, metadata helpers, global housing lookup.
- `cloudflare_worker.js`: HTMLRewriter SEO metadata for dynamic detail pages and static SPA routes.
- `index.html`: all SPA view containers, modals, script/style bundle references, and static root markup.

## AI Docs Index
None exist yet

## 🎨 Design System & Style Guide

## 🎨 1. Color System
Shift from "Institutional Royal Blue" to colors that communicate energy, warmth, and urgency.

* **Primary Action (The "Robin Hood" Color):** * `--color-primary: #4F46E5;` (Electric Indigo) OR `--color-primary: #FF6B6B;` (Vibrant Coral).
  * *Usage:* Apply to main CTAs ("Send besked", "Opret annonce").
* **Secondary / Premium Accent (The "Superpower"):** * `--gradient-premium: linear-gradient(135deg, #4f46e5, #8b5cf6, #06b6d4);`
  * *Usage:* Use strictly for Freemium indicators (BoligMatch Express, Profile Boosts).
* **Backgrounds (Warm & Cozy):** * `--bg-main: #FDFBF7;` (Soft Cream / Warm Off-White).
  * *Usage:* Global body background to replace clinical grays.
* **Text & Typography:** * `--text-main: #1F2937;` (Deep Charcoal - softer than pure black).
  * `--text-muted: #6B7280;` (Cool Gray for secondary information).

## 🔤 2. Typography
Moving away from rigid corporate fonts to friendly, highly legible mobile-first typefaces.

* **Headings:** `'Poppins', sans-serif`
  * Weight: `700` or `800` (Extra Bold).
  * *Usage:* View titles, marketing headers, modal titles.
* **Body & UI Elements:** `'Inter', sans-serif`
  * Weight: `400` (Regular), `500` (Medium).
  * *Usage:* Room descriptions, input fields, navigation. Ensure base size is `16px` to avoid iOS zoom on inputs, with `1.1rem` for main reading blocks.

## 🧱 3. UI Components & "The Tactile Rule"

### Listing Cards (`.room-card`)
* **Focus on the Human:** Unlike real estate, roommates care about *who* they live with. Ensure a prominent circular user avatar (`width: 48px; height: 48px; border-radius: 50%;`) overlaps the bottom edge of the room image.
* **Styling:** Use `--bs-border-radius-xl` (approx 16px) for soft, modern corners.
* **Interaction:** `transition: transform 0.2s ease;` on hover, translating Y by `-4px` with an increased shadow (`box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);`).

### Lifestyle Vibe Tags (`.vibe-tag`)
Replace generic facility tags (Elevator, Balcony) with human-centric behavior tags.
* **Examples:** 🌿 Vegan, 🤫 Stille, 🍻 Socialt, 🧹 Rengøringsplan.
* **Constraint:** Enforce a maximum of **3-4 tags** per listing card to prevent visual clutter.
* **Styling:** Pill-shaped (`border-radius: 50px`), muted background, solid text. Active state adopts the primary color background with white text.

## 🖼️ 4. Imagery & Iconography

* **Icons:** Use `FontAwesome 6` (Solid for active, Regular for inactive).
* **Emojis:** Actively use native emojis in headings and tags. Danish youth use emojis heavily in Facebook housing groups; mirroring this makes the platform feel native. (e.g., "Ledigt værelse på Nørrebro 🚲💨").
* **Empty States:** Replace static images with friendly, high-quality **Lottie Animations** (e.g., when the inbox is empty or a search yields no results).

## 🗣️ 5. Tone of Voice (Danish)
The copy must reflect the brand's position as a disruptor of expensive legacy platforms.

* **Keywords:** Use *Hjem* (Home) instead of *Bolig* (Housing). Use *Roomie* instead of *Lejer* (Tenant).
* **Tone:** Friendly, transparent, anti-scam.
* **Examples:**
  * *Instead of:* "Opret bruger for at kontakte udlejer."
  * *Use:* "Skriv til din nye roomie (helt gratis)."
  * *Instead of:* "Abonnement påkrævet."
  * *Use:* "Spring køen over med Premium."

## 💎 6. Freemium UI Indicators
Paid features must feel integrated but exclusive. They should not feel like roadblocks, but rather like optional upgrades.

* **Boosted Profiles (`.badge-boosted`):** Apply a subtle glowing border using `--gradient-premium` and a glassmorphism badge (`backdrop-filter: blur(8px); background: rgba(255,255,255,0.8);`). Label: "🌟 Top-kandidat".
* **Paywall / Feature Locks:** Use a subtle lock icon (`fa-lock`) next to premium toggles (e.g., Real-time Match Emails).
* **Upsell Modals:** When clicking a premium feature, open a clean, centered modal that emphasizes the *competitive advantage* (e.g., "Vær den første der ansøger" - "Be the first to apply") rather than the cost.

## 🛠️ 7. CSS Root Template
```css
:root {
  /* Colors */
  --color-primary: #4F46E5;
  --color-primary-hover: #4338CA;
  --color-premium-start: #4f46e5;
  --color-premium-mid: #8b5cf6;
  --color-premium-end: #06b6d4;
  --bg-main: #FDFBF7;
  --bg-card: #FFFFFF;
  --text-main: #1F2937;
  --text-muted: #6B7280;
  
  /* Typography */
  --font-heading: 'Poppins', sans-serif;
  --font-body: 'Inter', sans-serif;
  
  /* Gradients & Effects */
  --gradient-premium: linear-gradient(135deg, var(--color-premium-start), var(--color-premium-mid), var(--color-premium-end));
  --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
  --shadow-card-hover: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  
  /* Radii */
  --radius-card: 16px;
  --radius-pill: 50px;
}
```

## Self-Improving AI Documentation

When working in this repository, improve AI-facing docs if you discover durable project knowledge that future agents could reasonably get wrong without explicit documentation.

- Add short, broad rules to `AGENTS.md`.
- Add detailed or domain-specific context to a focused file under `ai_docs/`, then reference it from `AGENTS.md`.
- Do not document temporary debugging notes, one-off implementation details, obvious code facts, or speculation.
- Only update AI docs when already editing repository files, or when the user explicitly asks for documentation updates.
- Keep documentation updates small, factual, directly related to the work, and within the original task scope.
