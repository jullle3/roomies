import {authFetch} from "../auth/auth.js";

const ROOM_CACHE_EVENT = "rooms:loaded";
const MY_ROOM_CACHE_EVENT = "my-rooms:loaded";
const ALL_ROOMS_ENDPOINT = "/roomies/rooms/all";
const MY_ROOMS_ENDPOINT = "/roomies/rooms";

if (typeof window !== "undefined") {
    window.rooms = window.rooms ?? null;
    window.roomFetchPromise = window.roomFetchPromise ?? null;
    window.myRooms = window.myRooms ?? null;
    window.myRoomFetchPromise = window.myRoomFetchPromise ?? null;
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

export function preloadMyRooms({force = false} = {}) {
    if (!localStorage.getItem("jwt")) {
        window.myRooms = [];
        window.myRoomFetchPromise = null;
        dispatchMyRoomsLoaded([]);
        return Promise.resolve([]);
    }

    if (!force && window.myRoomFetchPromise) {
        return window.myRoomFetchPromise;
    }

    if (force) {
        window.myRoomFetchPromise = null;
    }

    window.myRoomFetchPromise = fetchMyRooms()
        .then(rooms => {
            window.myRooms = rooms;
            dispatchMyRoomsLoaded(rooms);
            return rooms;
        })
        .catch(err => {
            console.error("Failed to fetch user rooms", err);
            window.myRooms = [];
            dispatchMyRoomsLoaded([]);
            return [];
        });

    return window.myRoomFetchPromise;
}

export function getCachedMyRooms() {
    return window.myRooms;
}

export function mergeRoomsIntoCaches(updatedRooms) {
    const rooms = Array.isArray(updatedRooms) ? updatedRooms : [updatedRooms];
    const validRooms = rooms.filter(room => getRoomId(room));
    if (!validRooms.length) return;

    window.rooms = mergeRoomList(window.rooms, validRooms);
    window.myRooms = mergeRoomList(window.myRooms, validRooms);

    dispatchRoomsLoaded(window.rooms || []);
    dispatchMyRoomsLoaded(window.myRooms || []);
}

export function removeRoomsFromCaches(roomIds) {
    const ids = new Set((Array.isArray(roomIds) ? roomIds : [roomIds]).map(String).filter(Boolean));
    if (!ids.size) return;

    window.rooms = removeRoomsFromList(window.rooms, ids);
    window.myRooms = removeRoomsFromList(window.myRooms, ids);

    dispatchRoomsLoaded(window.rooms || []);
    dispatchMyRoomsLoaded(window.myRooms || []);
}

export async function getRoomById(roomId) {
    if (!roomId) return null;

    const cached = getCachedRoomById(roomId);
    if (cached) return cached;

    if (window.roomFetchPromise) {
        await window.roomFetchPromise;
        const cachedAfterPublicFetch = getCachedRoomById(roomId);
        if (cachedAfterPublicFetch) return cachedAfterPublicFetch;
        return getRoomByIdFromOwnerCache(roomId);
    }

    await preloadRooms();
    const cachedAfterPublicFetch = getCachedRoomById(roomId);
    if (cachedAfterPublicFetch) return cachedAfterPublicFetch;
    return getRoomByIdFromOwnerCache(roomId);
}

export async function getRoomByCreatedBy(userId) {
    if (!userId) return null;

    const cached = findRoomByCreatedBy(getCachedRooms(), userId);
    if (cached) return cached;

    await preloadRooms();
    return findRoomByCreatedBy(getCachedRooms(), userId);
}

function findRoomByCreatedBy(rooms, userId) {
    if (!Array.isArray(rooms)) return null;
    return rooms.find(room => String(room?.created_by || "") === String(userId) && room?.deleted !== true) || null;
}

export function onRoomsLoaded(callback) {
    document.addEventListener(ROOM_CACHE_EVENT, event => callback(event.detail.rooms));
}

export function onMyRoomsLoaded(callback) {
    document.addEventListener(MY_ROOM_CACHE_EVENT, event => callback(event.detail.rooms));
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

async function fetchMyRooms() {
    const response = await authFetch(MY_ROOMS_ENDPOINT);
    if (!response.ok) {
        throw new Error(`User room fetch failed with status ${response.status}`);
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

function dispatchMyRoomsLoaded(rooms) {
    document.dispatchEvent(new CustomEvent(MY_ROOM_CACHE_EVENT, {detail: {rooms}}));
}

function getCachedRoomById(roomId) {
    const rooms = [
        ...(Array.isArray(getCachedRooms()) ? getCachedRooms() : []),
        ...(Array.isArray(getCachedMyRooms()) ? getCachedMyRooms() : [])
    ];
    return rooms.find(room => String(room?._id || room?.id) === String(roomId)) || null;
}

async function getRoomByIdFromOwnerCache(roomId) {
    if (!localStorage.getItem("jwt")) return null;
    await preloadMyRooms();
    return getCachedRoomById(roomId);
}

function mergeRoomList(existingRooms, updatedRooms) {
    const existing = Array.isArray(existingRooms) ? existingRooms : [];
    const updatedIds = new Set(updatedRooms.map(getRoomId));
    return [
        ...updatedRooms,
        ...existing.filter(room => !updatedIds.has(getRoomId(room)))
    ];
}

function getRoomId(room) {
    return String(room?._id || room?.id || "");
}

function removeRoomsFromList(existingRooms, ids) {
    if (!Array.isArray(existingRooms)) return existingRooms;
    return existingRooms.filter(room => !ids.has(getRoomId(room)));
}
