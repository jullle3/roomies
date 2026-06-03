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

## AI Docs Index
None exist yet

---

## 🎨 Design System & Style Guide

**Core Aesthetic:** "Scandinavian Community Tech" — vibrant, tactile, trustworthy, and highly accessible. The UI must feel like a modern, frictionless social app, not a bank or real estate agency.

### 🎨 1. Color System
The platform utilizes warm, energetic colors to appeal to students and young professionals.

* **Primary Action (The "Robin Hood" Color):** `--color-primary: #FF6B6B;` (Vibrant Coral).
  * *Hover State:* `--color-primary-hover: #fa5252;`
  * *Usage:* Apply to main CTAs ("Send besked", "Opret annonce") and active UI states.
* **Secondary / Premium Accent (The "Superpower"):** A gradient flowing from Indigo to Cyan (`linear-gradient(135deg, #4f46e5, #06b6d4)`).
  * *Usage:* Use strictly for Freemium indicators (Boosted profiles, Premium unlocks).
* **Backgrounds (Warm & Cozy):** `--bg-main: #FDFBF7;` (Soft Cream / Warm Off-White).
  * *Usage:* Global body background to replace clinical grays.
* **Text & Typography:** `--text-main: #1F2937;` (Deep Charcoal) and `--text-muted: #6B7280;` (Cool Gray).

### 🔤 2. Typography
Friendly, highly legible mobile-first typefaces.

* **Headings:** `'Poppins', sans-serif`
  * Weight: `700` or `800` (Extra Bold). Letter-spacing slightly tight (`-0.5px`).
* **Body & UI Elements:** `'Inter', sans-serif`
  * Weight: `400` (Regular), `500` (Medium), `600` (Semi-Bold for tags/nav). Ensure base size is `16px` to avoid iOS zoom on inputs.

### 🧱 3. UI Components & "The Tactile Rule"

* **Border Radii:** Use completely rounded pills for buttons/tags (`--radius-pill: 50px`) and large, soft corners for cards and hubs (`--radius-xl: 20px`).
* **Shadows:** Avoid harsh borders. Use wide, soft shadows (`--shadow-soft`) that elevate dramatically on hover (`--shadow-hover`).

#### General Visual Quality Bar
Use the same polished, tactile language across the product, not only on the front page.

* **Composition:** Interfaces should feel spacious, intentional, and social-app-like. Prefer one strong focal element per section over many small competing boxes.
* **Surface Treatment:** Important UI surfaces should feel slightly elevated and touchable: soft shadows, warm white or glass backgrounds, rounded pills/cards, and subtle hover lift.
* **Contrast:** Text must stay readable over photos, gradients, and glass surfaces. Use dark overlays behind image-backed sections and avoid `text-muted` directly on image or busy backgrounds.
* **Desktop and Mobile Parity:** Every page and component must be intentionally designed for both desktop and mobile. Do not treat mobile as an afterthought or merely let Bootstrap stack things by default. Check layout, alignment, spacing, text wrapping, tap targets, and image cropping at mobile and desktop breakpoints. It is acceptable for alignment to change by breakpoint when it improves the experience, for example left-aligned hero copy on desktop with centered hero copy on mobile.
* **CTA Hierarchy:** Primary user actions use the coral primary color. Avoid black/dark buttons for main actions unless the surrounding design explicitly needs a dark neutral control.
* **Typography Consistency:** Related text inside the same component should share the same font family, weight logic, casing, and letter spacing. Avoid accidental mixes of Bootstrap badge typography, uppercase labels, and normal body text.
* **Bootstrap Restraint:** Use Bootstrap utilities as helpers, but the final result should not look like default Bootstrap. Add roomies-specific classes or styles when needed to keep the warm, tactile identity.
* **Warmth Over Corporate:** Prefer friendly, rounded, human UI over clinical real-estate or banking aesthetics. The product should feel like a community tool, not an agency portal.

#### Listing Cards (`.room-card`)
* **Focus on the Human:** Roommates care about *who* they live with. Ensure a prominent circular user avatar (`width: 56px; height: 56px; border: 4px solid #fff; border-radius: 50%;`) overlaps the bottom-right edge of the room image (`bottom: -24px; right: 24px;`).
* **Aspect Ratio:** Room thumbnails must use a 3:2 aspect ratio (`padding-bottom: 65%`).
* **Interaction:** `transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);` translating Y by `-4px` with the expanded `--shadow-hover`.

#### Floating Action Hubs & Glassmorphism
* Key interface elements (like the search/sell tabbed hero hub) should use glassmorphism to feel lightweight: `background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.6);`.

#### Lifestyle Vibe Tags (`.vibe-tag`)
Replace generic facility tags with human-centric behavior tags.
* **Examples:** 🌿 Vegan, 🤫 Stille, 🍻 Socialt, 🧹 Rengøringsplan.
* **Constraint:** Enforce a maximum of **3-4 tags** per listing card to prevent visual clutter.
* **Styling:** Pill-shaped, light gray background (`#F3F4F6`), solid muted text, font-weight 600.

### 🖼️ 4. Imagery & Iconography
* **Icons:** Use `FontAwesome 6`.
* **Emojis:** Actively use native emojis in headings and tags to match Danish youth behavior on social media (e.g., "Ledigt værelse på Nørrebro 🚲💨").
* **Empty States:** Replace static images with friendly, high-quality **Lottie Animations**.

### 🗣️ 5. Tone of Voice (Danish)
* **Keywords:** Use *Hjem* (Home) instead of *Bolig* (Housing). Use *Roomie* instead of *Lejer* (Tenant).
* **Tone:** Friendly, transparent, anti-scam.
* **Examples:**
  * *Instead of:* "Opret bruger for at kontakte udlejer." -> *Use:* "Skriv til din nye roomie (helt gratis)."
  * *Instead of:* "Abonnement påkrævet." -> *Use:* "Spring køen over med Premium."

### 🛠️ 6. CSS Root Template
When generating new styles or components, AI agents must adhere to these root variables:

```css
:root {
    --color-primary: #FF6B6B; /* Vibrant Coral */
    --color-primary-hover: #fa5252;
    --color-premium-start: #4f46e5;
    --color-premium-end: #06b6d4;
    --bg-main: #FDFBF7; /* Warm Off-White */
    --text-main: #1F2937;
    --text-muted: #6B7280;

    --font-heading: 'Poppins', sans-serif;
    --font-body: 'Inter', sans-serif;

    --radius-xl: 20px;
    --radius-pill: 50px;
    
    /* Soft, diffuse shadows for the tactile app feel */
    --shadow-soft: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);
    --shadow-hover: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.01);
}
