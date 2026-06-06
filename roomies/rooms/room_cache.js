import {authFetch} from "../auth/auth.js";

const ROOM_CACHE_EVENT = "rooms:loaded";
const ALL_ROOMS_ENDPOINT = "/roomies/rooms/all";

if (typeof window !== "undefined") {
    window.rooms = window.rooms ?? null;
    window.roomFetchPromise = window.roomFetchPromise ?? null;
}

export function preloadRooms() {
    if (window.roomFetchPromise) {
        return window.roomFetchPromise;
    }

    window.rooms = null;
    window.roomFetchPromise = fetchAllRooms()
        .then(rooms => {
            window.rooms = rooms;
            dispatchRoomsLoaded(rooms);
            return rooms;
        })
        .catch(err => {
            console.error("Failed to fetch rooms in background", err);
            window.rooms = [];
            dispatchRoomsLoaded([]);
            return [];
        });

    return window.roomFetchPromise;
}

export function getCachedRooms() {
    return window.rooms;
}

export async function getRoomById(roomId) {
    if (!roomId) return null;

    const cached = getCachedRoomById(roomId);
    if (cached) return cached;

    if (window.roomFetchPromise) {
        await window.roomFetchPromise;
        return getCachedRoomById(roomId);
    }

    await preloadRooms();
    return getCachedRoomById(roomId);
}

export function onRoomsLoaded(callback) {
    document.addEventListener(ROOM_CACHE_EVENT, event => callback(event.detail.rooms));
}

async function fetchAllRooms() {
    const response = await authFetch(ALL_ROOMS_ENDPOINT);
    if (!response.ok) {
        throw new Error(`Room fetch failed with status ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) {
        return data;
    }

    return Array.isArray(data?.rooms) ? data.rooms : [];
}

function dispatchRoomsLoaded(rooms) {
    document.dispatchEvent(new CustomEvent(ROOM_CACHE_EVENT, {detail: {rooms}}));
}

function getCachedRoomById(roomId) {
    const rooms = getCachedRooms();
    if (!Array.isArray(rooms)) return null;
    return rooms.find(room => String(room?._id || room?.id) === String(roomId)) || null;
}
