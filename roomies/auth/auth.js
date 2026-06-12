import {apiUrl, directApiUrl} from "../config/config.js";

// Define exactly which endpoints should go through Cloudflare (Caching)
const CACHEABLE_ENDPOINTS = [
    '/roomies/rooms/all',
    '/roomies/advertisement_data'
];

const API_PREFIX = "/roomies";

function withRoomiesPrefix(url) {
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith(`${API_PREFIX}/`) || url === API_PREFIX) return url;
    if (!url.startsWith("/")) return `${API_PREFIX}/${url}`;
    return `${API_PREFIX}${url}`;
}

/**
 * A wrapper around the fetch function to automatically include JWT in the headers.
 * Used for requests to our backend API
 */
export function authFetch(url, options = {}) {
    const jwt = localStorage.getItem('jwt');
    const prefixedUrl = withRoomiesPrefix(url);

    // Ensure headers object exists
    if (!options.headers) {
        options.headers = {};
    }

    // Append the Authorization header with the JWT, if it exists.
    if (jwt) {
        options.headers['Authorization'] = `Bearer ${jwt}`;
    }

    // Extract the path without query parameters (e.g., "/advertisement?page=1" -> "/advertisement")
    const endpoint = prefixedUrl.split("?")[0];

    // ROUTING LOGIC:
    // Check if the endpoint is in our allowed list.
    // If it is, use Cloudflare (apiUrl). Otherwise, use the direct Google backend (directApiUrl), since cloudflare seems to add 50-200 ms per request
    let base = directApiUrl;

    if (CACHEABLE_ENDPOINTS.includes(endpoint)) {
        base = apiUrl;
    }

    return fetch(base + prefixedUrl, options);
}
