import {generateHousingCard} from "../housing_list/housing_list.js";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

let infowindow;
let markerClusterer = null;
let markerRenderToken = 0;
let lastMarkerSignature = '';
const MARKER_BATCH_SIZE = 75;
// const MAP_ZOOM = 13;  // More zoomed out
// Replace with your actual API key and use the weekly channel or a quarterly alias
const API_KEY = 'AIzaSyCStq9v7paVD8cksRB8LvIh1oZeGSIkEvk';
const GOOGLE_MAPS_VERSION = 'quarterly';  // use 'weekly' or 'quarterly' to avoid retired numeric versions

const clusterIconCache = new Map();
const clusterAlgorithmOptions = getClusterAlgorithmOptions();
const clusterRenderer = {
    render({count, position}) {
        const size = getClusterIconSize(count);

        return new google.maps.Marker({
            position,
            title: `${count} boliger i området`,
            zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
            optimized: true,
            icon: {
                url: getClusterIconUrl(size),
                scaledSize: new google.maps.Size(size, size),
                anchor: new google.maps.Point(size / 2, size / 2)
            },
            label: {
                text: String(count),
                color: '#ffffff',
                fontFamily: 'Lato, Arial, sans-serif',
                fontSize: count > 99 ? '13px' : '14px',
                fontWeight: '800'
            }
        });
    }
};

export function setupMapView() {
    document.getElementById("showVisibleListBtn").addEventListener("click", async () => {
        await showView("housing_list");
    });
}

// This method ensures map is only loaded exactly once, to save cloud costs
export async function initMap() {
    // Load the Maps script and import the marker library
    await loadGoogleMapsScript();

    // Prevent reinitializing an existing map
    if (window.googlemap instanceof google.maps.Map) {
        // Map has already been initialized
        return
    }

    const mapOptions = {
        zoom: 7, // Adjusted zoom to get a good view of Denmark
        center: { lat: 56.26392, lng: 9.501785 },  // Center on Denmark
        mapId: '9df01a95f0b6f4d6',
        gestureHandling: 'greedy',
        zoomControl: true,
        disableDefaultUI: false
    };

    window.googlemap = new google.maps.Map(document.getElementById('googlemap'), mapOptions);
    infowindow = new google.maps.InfoWindow();
}


// Only load google Maps javascript when its actually needed
function loadGoogleMapsScript() {
    return new Promise((resolve, reject) => {
        if (window.google && window.google.maps) {
            resolve();  // Already loaded
            return;
        }

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=marker&v=${GOOGLE_MAPS_VERSION}`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Google Maps script load error'));
        document.head.appendChild(script);
    });
}


function createCustomSVGIconWithPNG(imageUrl, width, height) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}">
    <image href="${imageUrl}" width="${width}" height="${height}"/>
</svg>`;
}

export async function displayHousingsOnMap(response_json) {
    const adsWithLocation = (response_json.objects || []).filter(ad => ad.location);
    const nextSignature = buildMarkerSignature(adsWithLocation);
    if (nextSignature === lastMarkerSignature) {
        return;
    }

    const renderToken = ++markerRenderToken;
    lastMarkerSignature = nextSignature;
    clearMapMarkers();

    // Standard icon for normal sales
    const houseIcon = {
        url: 'pics/house_marker.webp',
        scaledSize: new google.maps.Size(40, 40),
        optimized: true
    };

    // New icon for exchange-only properties
    const exchangeIcon = {
        url: 'pics/house_marker_exchange.webp', // Make sure to add this image to your pics/ folder
        scaledSize: new google.maps.Size(40, 40),
        optimized: true
    };

    // Kick off image decode for both icons to prevent popping
    new Image().src = houseIcon.url;
    new Image().src = exchangeIcon.url;

    for (let i = 0; i < adsWithLocation.length; i += MARKER_BATCH_SIZE) {
        if (renderToken !== markerRenderToken) {
            return;
        }

        const batch = adsWithLocation.slice(i, i + MARKER_BATCH_SIZE);
        batch.forEach(ad => {
            const marker = new google.maps.Marker({
                position: {
                    lat: ad.location.coordinates[1],
                    lng: ad.location.coordinates[0]
                },
                title: ad.title,
                optimized: true,
                // Check if the property is exchange_only and apply the correct icon
                icon: ad.exchange_only ? exchangeIcon : houseIcon
            });

            marker._id = ad._id;

            // click → infowindow with dynamic content
            marker.addListener('click', event => {
                const content = buildContent(ad);
                infowindow.setContent(content);
                infowindow.open(window.googlemap, marker);
                google.maps.event.addListenerOnce(infowindow, 'domready', () => {
                    // Delay attaching outside-click handler so it doesn't catch the marker click
                    setTimeout(() => {
                        document.addEventListener('pointerdown', handleOutsideClick);
                    }, 0);
                });
            });

            window.markers.push(marker);
        });

        if (i + MARKER_BATCH_SIZE < adsWithLocation.length) {
            await yieldToMainThread();
        }
    }

    if (renderToken !== markerRenderToken) {
        return;
    }

    markerClusterer = new MarkerClusterer({
        map: window.googlemap,
        markers: window.markers,
        algorithmOptions: clusterAlgorithmOptions,
        renderer: clusterRenderer
    });

    // Fit map bounds around all markers smoothly
    if (window.markers.length > 0) {
        const bounds = new google.maps.LatLngBounds();
        window.markers.forEach(marker => {
            // Standard Marker stores its LatLng in .getPosition() or .position
            bounds.extend(marker.position || marker.getPosition());
        });

        // CRITICAL FIX: Ensure map has dimensions before fitting bounds
        // If the map was hidden (size 0x0), fitting bounds causes the "World View" bug.
        const mapDiv = document.getElementById('googlemap');

        // Helper to apply bounds safely
        const applyBounds = () => {
            window.googlemap.fitBounds(bounds, { padding: 50 });

            // Extra check: If zoom goes too far out (World View), reset to Denmark
            const listener = window.googlemap.addListener('idle', () => {
                if (window.googlemap.getZoom() < 6) {
                    // Center of DK
                    window.googlemap.setCenter({ lat: 56.26392, lng: 9.501785 });
                    window.googlemap.setZoom(7);
                }
                google.maps.event.removeListener(listener);
            });
        };

        if (mapDiv.offsetWidth > 0 && mapDiv.offsetHeight > 0) {
            applyBounds();
        } else {
            // Wait for the view transition (display: block) to finish rendering
            setTimeout(applyBounds, 200);
        }
    }
}

// Clicks outside popups closes the card
function handleOutsideClick(event) {
    const popupCard = document.getElementById('popup-card');
    if (popupCard && !popupCard.contains(event.target)) {
        infowindow.close();
        document.removeEventListener('pointerdown', handleOutsideClick);
    }
}

function clearMapMarkers() {
    if (markerClusterer) {
        markerClusterer.clearMarkers();
        markerClusterer = null;
    }

    if (window.markers?.length) {
        window.markers.forEach(marker => marker.setMap(null));
    }

    window.markers = [];
}

function buildMarkerSignature(ads) {
    return ads
        .map(ad => [
            ad._id,
            ad.exchange_only ? '1' : '0',
            ad.location?.coordinates?.[0] ?? '',
            ad.location?.coordinates?.[1] ?? ''
        ].join(':'))
        .sort()
        .join('|');
}

function yieldToMainThread() {
    return new Promise(resolve => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(resolve, {timeout: 50});
            return;
        }

        setTimeout(resolve, 0);
    });
}

function getClusterIconSize(count) {
    if (count >= 100) return 58;
    if (count >= 50) return 54;
    if (count >= 10) return 50;
    return 46;
}

function getClusterAlgorithmOptions() {
    const isMobile = window.matchMedia?.('(max-width: 768px)').matches;

    return {
        // Stop clustering once users are inspecting neighbourhood-level areas.
        maxZoom: 13,
        minPoints: isMobile ? 3 : 2,
        radius: isMobile ? 76 : 60,
        nodeSize: isMobile ? 96 : 64
    };
}

function getClusterIconUrl(size) {
    if (clusterIconCache.has(size)) {
        return clusterIconCache.get(size);
    }

    const radius = Math.floor(size / 2) - 4;
    const innerRadius = Math.max(10, radius - 9);
    const center = size / 2;
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="clusterFill" x1="0" y1="0" x2="${size}" y2="${size}">
      <stop offset="0" stop-color="#4d66ff"/>
      <stop offset="1" stop-color="#1f3ed6"/>
    </linearGradient>
    <filter id="clusterShadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#061148" flood-opacity="0.26"/>
    </filter>
  </defs>
  <circle cx="${center}" cy="${center}" r="${radius}" fill="url(#clusterFill)" stroke="#ffffff" stroke-width="3" filter="url(#clusterShadow)"/>
  <circle cx="${center}" cy="${center}" r="${innerRadius}" fill="none" stroke="#dbe3ff" stroke-width="1.5" stroke-opacity="0.72"/>
</svg>`.trim();

    const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    clusterIconCache.set(size, url);
    return url;
}

function buildContent(housing) {
    const content = document.createElement("div");

    // Create a temporary container to parse the string
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = generateHousingCard(housing, "data-housing-id-map");

    // Extract the inner .card element (ignoring the outer .col wrapper)
    // This fixes the issue where the card was restricted to 25% width on large screens
    const cardElement = tempDiv.querySelector('.card');
    const finalHtml = cardElement ? cardElement.outerHTML : tempDiv.innerHTML;

    // Attach "popup-card" ID, so we can attach clickHandler
    content.innerHTML = `
<div id="popup-card" class="property popup-content">
    ${finalHtml}
</div>`;
    return content;
}

// Adjust map height to fill remaining viewport
function adjustMapHeight() {
    const mapDiv = document.getElementById('googlemap');
    const headerHeight = 188;
    mapDiv.style.height = `${window.innerHeight - headerHeight}px`;
}


/**
 * Returns an array of all ad IDs whose markers are currently visible in the map’s viewport.
 * Assumes:
 * - window.googlemap is your initialized google.maps.Map instance
 * - window.markers is an array of google.maps.Marker objects
 * - each marker has a custom property marker.adId (the advertisement’s _id)
 */
function getVisibleAdIds() {
    if (!window.googlemap || !window.markers) return [];

    const bounds = window.googlemap.getBounds();
    if (!bounds) return [];

    // Filter markers by whether their position is within the bounds, then extract adId
    return window.markers
        .filter(marker => bounds.contains(marker.getPosition()))
        .map(marker => marker._id);
}
