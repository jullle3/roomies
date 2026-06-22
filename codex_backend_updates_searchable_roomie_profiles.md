# Backend Updates For Searchable Roomie Profiles

## Summary

The frontend now has a `/find-roomie` page where room providers can browse public profiles of users who are looking for a room. For this to work fully, the backend needs to expose safe public seeker profile data, support filtering, and persist the new `roomie_profile` fields.

All endpoints below are under the existing `/roomies` prefix.

## User / Roomie Profile Model

Extend the existing user `roomie_profile` object with these fields:

```python
class RoomieProfile(BaseModel):
    profile_photo: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    occupation: list[str] = []
    interests: list[str] = []
    description: Optional[str] = None

    seeking_room: bool = False
    renting_room: bool = False
    public_profile: bool = True
    monthly_price_max: Optional[int] = None
    areas: Optional[list[int]] = None
    move_in_from: Optional[int] = None  # epoch seconds
```

Default behavior:

- `public_profile` should default to `True`.
- `seeking_room` and `renting_room` should default to `False`.
- Existing users without `public_profile` should behave as public unless explicitly set to `False`.

## User Update Endpoint

The existing authenticated user update endpoint should accept and preserve the new fields:

```http
PATCH /roomies/user
```

Expected payload shape:

```json
{
  "roomie_profile": {
    "seeking_room": true,
    "renting_room": false,
    "public_profile": true,
    "monthly_price_max": 6000,
    "areas": [2200, 2300],
    "move_in_from": 1767222000
  }
}
```

Important:

- Do not drop unknown existing `roomie_profile` fields during partial updates.
- Validate `areas` as integers.
- Validate `monthly_price_max >= 0`.
- Validate `move_in_from` as epoch seconds or `null`.

## Public Profile Search Endpoint

Update or implement:

```http
GET /roomies/users/profile
```

This endpoint must be callable without authentication. It should return only public, safe fields.

Profiles should be included only when:

```python
roomie_profile.public_profile is not False
and roomie_profile.seeking_room is True
```

Do not return:

- email
- phone
- auth/JWT data
- internal moderation fields
- private account settings
- raw user object

Recommended response item:

```json
{
  "id": "user_id",
  "full_name": "Julian Køster Larsen",
  "profile_photo": "photo.webp",
  "age": 28,
  "gender": "mand",
  "occupation": ["Fuldtidsarbejde"],
  "interests": ["🍻 Socialt anlagt", "🧹 Rengøringsplan"],
  "description": "Kort tekst om mig...",
  "seeking_room": true,
  "renting_room": false,
  "public_profile": true,
  "monthly_price_max": 6500,
  "areas": [2200, 2300],
  "move_in_from": 1767222000,
  "updated": 1760000000
}
```

The frontend accepts either a raw array or `{ "items": [...] }`, but a raw array is simplest for v1.

## Filtering

Support these query params:

```http
GET /roomies/users/profile?areas=2200&room_price=5500&move_in_from=1767222000&occupation=Studerende&gender=kvinde&interests=🧹%20Rengøringsplan&q=rolig&limit=200
```

Expected semantics:

- `areas`: match users whose `roomie_profile.areas` is empty/null or overlaps the requested area.
- `room_price`: match users whose `monthly_price_max` is null or `monthly_price_max >= room_price`.
- `move_in_from`: match users whose `move_in_from` is null or `move_in_from <= requested_move_in_from`.
- `occupation`: match if the value is in `occupation`.
- `gender`: exact match.
- `interests`: match if any requested interest exists in `interests`.
- `q`: case-insensitive search across first name, occupation, interests, area labels if available, and description.
- `limit`: cap response size.

Area IDs may be postal codes or range-style IDs from the frontend `areaAutocompleteOptions`. If the backend already expands area IDs elsewhere, reuse that logic.

## Conversation Assumptions

The frontend opens seeker contact with:

```text
/beskeder?modtager=<user_id>&source=seeker
```

Then messages are sent through the existing endpoint:

```http
POST /roomies/conversation/message
```

Expected payload:

```json
{
  "receiver_id": "user_id",
  "text": "Hej ...",
  "room_id": null
}
```

Backend should allow `room_id: null` for direct user-to-user contact. If it currently requires a room id, loosen that validation for this use case.

## Indexes

Recommended Mongo indexes:

```python
IndexModel("roomie_profile.public_profile")
IndexModel("roomie_profile.seeking_room")
IndexModel("roomie_profile.monthly_price_max")
IndexModel("roomie_profile.areas")
IndexModel("roomie_profile.move_in_from")
```

For v1, simple indexes are enough. Text search can start as application-level filtering if the dataset is small.

## Migration / Backfill

For existing users:

- Set missing `roomie_profile.public_profile` to `True`.
- Set missing `roomie_profile.seeking_room` to `False`.
- Set missing `roomie_profile.renting_room` to `False`.
- Leave `monthly_price_max`, `areas`, and `move_in_from` as `null` unless known.

Do not automatically mark all existing users as `seeking_room = True`; that would expose people in the new directory without clear intent.

## Safety Notes

- Public endpoint must never leak email or phone.
- Public endpoint should not require login, but write/contact endpoints still should.
- Consider rate limiting public profile search if scraping becomes a problem.
- Consider moderation/reporting later, but it is not required for the frontend v1 to work.
