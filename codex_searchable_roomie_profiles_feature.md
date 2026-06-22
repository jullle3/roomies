# Searchable Room-Seeker Profiles

## Summary

RoomieDanmark now has a new marketplace loop where people who rent out rooms can browse public profiles of people looking for a room. The feature is exposed as the `Find roomie` navbar item and the `/find-roomie` SPA route.

The core idea is simple: instead of only letting room seekers search rooms, room providers can also search people and contact the specific roomies who look like a good match.

## User Experience

- Public visitors can browse the `Find roomie` page without logging in.
- The page shows searchable cards for users who are looking for a room and have a public profile.
- Each card can show:
  - first name
  - profile photo or fallback avatar
  - age, gender, and occupation when provided
  - desired areas
  - max monthly budget
  - move-in date
  - roomie-vibes
  - short profile description
- Clicking `Skriv til roomie` opens the existing message flow.
- Contact still requires login and a filled roomie profile, using the same `ensureRoomieProfile("contact")` pattern as room-detail contact.

## Routes And Frontend Wiring

- New route: `/find-roomie`
- New view id: `roomie_seekers`
- New source module: `roomies/roomie_seekers/roomie_seekers.js`
- New stylesheet: `roomies/roomie_seekers/roomie_seekers.css`
- ViewManager renders the page via `renderRoomieSeekersView()`.
- `main.js` initializes the feature via `setupRoomieSeekersView()`.
- `build.js` includes the new CSS file in the generated stylesheet bundle.

## Profile Fields

The profile form now supports these `roomie_profile` fields:

```json
{
  "seeking_room": true,
  "renting_room": false,
  "public_profile": true,
  "monthly_price_max": 6000,
  "areas": [2200, 2300],
  "move_in_from": 1767222000
}
```

The UI labels are:

- `Jeg søger værelse`
- `Jeg udlejer / har et værelse`
- `Synlig på Find roomie`
- `Maks husleje pr. måned`
- `Kan flytte ind fra`
- `Ønskede områder`

The profile save logic preserves unknown existing `roomie_profile` fields so future backend/profile additions are not accidentally overwritten.

## Onboarding

The roomie onboarding modal now asks what the user uses RoomieDanmark for:

- `Jeg søger værelse`
- `Jeg udlejer værelse`
- `Synlig på Find roomie`

Defaults depend on context:

- `contact`: defaults to seeking a room.
- `agent`: defaults to seeking a room.
- `publish`: defaults to renting out a room.

## Filtering

The `Find roomie` page supports filters for:

- area/postal area
- room rent, matched against seeker max budget
- move-in date
- occupation
- gender
- free-text search
- selected roomie-vibes

The frontend sends filter params to `/roomies/users/profile` but also applies client-side filtering. This keeps the page usable while backend-side filtering is being completed.

## Backend Contract

The expected endpoint is:

```http
GET /roomies/users/profile
```

It should be callable without login and return only safe public profile fields. It must not return email, phone, private account data, JWT data, or moderation/internal fields.

A profile should appear in the directory only when:

```js
public_profile !== false && seeking_room === true
```

Suggested supported query params:

- `areas`
- `room_price`
- `move_in_from`
- `occupation`
- `gender`
- `interests`
- `q`
- `limit`
- `cursor` or `offset`

## Contact Flow

The `Skriv til roomie` CTA opens:

```text
/beskeder?modtager=<user_id>&source=seeker
```

The conversations view passes `source=seeker` into draft creation. When no room listing is attached, the draft conversation uses the public seeker profile for name/photo and pre-fills this opener:

```text
Hej {firstName} 👋 Jeg har et værelse, som måske matcher det du søger. Har du lyst til at høre mere?
```

## Privacy And Safety

- Browsing is public, but contact is login-gated.
- Email and phone are never shown in the public directory.
- Users can disable visibility using `Synlig på Find roomie`.
- No individual public profile pages were added in this first version.
- The page indexes the directory route only, not per-user profile URLs.

## Verification

Implemented and checked with:

- `node --check` on touched JS modules.
- `git diff --check`.
- `npm.cmd run build`.

The final implementation build bumped `roomies_version` to `1035`.
