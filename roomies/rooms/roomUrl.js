// Single source of truth for room-detail URLs.
//
// SEO-friendly listings live at "/vaerelse/<slug>-<id>". The slug is purely
// decorative — the trailing 24-char Mongo id is the only part that drives the
// lookup, so the slug can change freely (title/address edits) without ever
// breaking an existing link. The backend computes `room.slug`; we never build
// it on the frontend, which keeps the slug logic in exactly one place.

import {basePath} from "../config/config.js";
import {getCachedRooms, getCachedMyRooms} from "./room_cache.js";

function getRoomId(room) {
    return String(room?._id || room?.id || "");
}

// Pretty path for a full room object (must carry `slug`). Falls back to the
// legacy "?id=" form when the slug is missing, so links never break.
export function roomDetailPath(room) {
    const id = getRoomId(room);
    if (!id) return `${basePath}/vaerelse`;

    const slug = room?.slug;
    return slug
        ? `${basePath}/vaerelse/${slug}-${id}`
        : `${basePath}/vaerelse?id=${encodeURIComponent(id)}`;
}

// Pretty path when only the id is known (e.g. programmatic navigation). Resolves
// the slug from the shared room caches; falls back to "?id=" on a cache miss.
export function roomDetailPathFromId(id) {
    const roomId = String(id || "");
    if (!roomId) return `${basePath}/vaerelse`;

    const room = findCachedRoom(roomId);
    return roomDetailPath(room || {id: roomId});
}

function findCachedRoom(id) {
    const caches = [getCachedRooms(), getCachedMyRooms()];
    for (const cache of caches) {
        if (!Array.isArray(cache)) continue;
        const match = cache.find(room => getRoomId(room) === id);
        if (match) return match;
    }
    return null;
}

// Extract the room id from a detail URL path. The id is the trailing 24-char hex
// Mongo ObjectId, optionally preceded by a slug ("/vaerelse/<slug>-<id>" or the
// bare "/vaerelse/<id>"). Returns null when no id is present.
export function extractRoomIdFromPath(pathname) {
    const match = String(pathname || "").match(/\/vaerelse\/(?:.*-)?([a-f0-9]{24})\/?$/i);
    return match ? match[1] : null;
}
