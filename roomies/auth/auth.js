import {apiUrl, directApiUrl} from "../config/config.js";

// Define exactly which endpoints should go through Cloudflare (Caching)
const CACHEABLE_ENDPOINTS = [
    '/advertisement',
    '/advertisement_data'
];

/**
 * A wrapper around the fetch function to automatically include JWT in the headers.
 * Used for requests to our backend API
 */
export function authFetch(url, options = {}) {
    const jwt = localStorage.getItem('jwt');

    // Ensure headers object exists
    if (!options.headers) {
        options.headers = {};
    }

    // Append the Authorization header with the JWT, if it exists.
    if (jwt) {
        options.headers['Authorization'] = `Bearer ${jwt}`;
    }

    // Extract the path without query parameters (e.g., "/advertisement?page=1" -> "/advertisement")
    const endpoint = url.split("?")[0];

    // ROUTING LOGIC:
    // Check if the endpoint is in our allowed list.
    // If it is, use Cloudflare (apiUrl). Otherwise, use the direct Google backend (directApiUrl).
    let base = directApiUrl;

    if (CACHEABLE_ENDPOINTS.includes(endpoint)) {
        base = apiUrl;
    }

    return fetch(base + url, options);
}