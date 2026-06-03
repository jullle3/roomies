import {authFetch} from "../auth/auth.js";
import {basePath, s3Url} from "../config/config.js";
import {displayErrorMessage} from "../utils.js";

let scannerHighlightedUnavailableClickHandlerReady = false;

export function loadFeaturedHousings(advertisementData) {
    const container = document.getElementById("featured-housings-container");
    if(!container) return;

    // We can use the specific metrics provided by backend
    // TODO: These are actually very misleading names.
    //  The correct order is, newest, VIP2, VIP2
    const housings = [
        advertisementData.most_expensive,
        advertisementData.cheapest,
        advertisementData.lowest_monthly,
    ].filter(Boolean); // Remove nulls

    if (housings.length === 0) {
        document.getElementById('featured-section').style.display = 'none';
        return;
    }

    // Map to HTML using the shared card generator
    container.innerHTML = housings
        .map(housing => generateHousingCard(housing, "landing-featured-card"))
        .join('');
}

export function loadScannerHighlightedListings(advertisementData) {
    const section = document.getElementById("scanner-highlighted-section");
    const track = document.getElementById("scanner-highlighted-track");
    if (!section || !track) return;

    const listings = Array.isArray(advertisementData?.scanner_highlighted_listings)
        ? advertisementData.scanner_highlighted_listings.filter(listing => listing?._id)
        : [];

    if (listings.length === 0) {
        section.classList.add("d-none");
        track.innerHTML = "";
        return;
    }

    section.classList.remove("d-none");
    setupScannerHighlightedUnavailableClickHandler(track);

    const loopListings = buildMarqueeLoopListings(listings);
    const groupHtml = loopListings
        .map((listing, index) => buildScannerHighlightedCard(listing, index))
        .join("");

    track.innerHTML = `
        <div class="scanner-highlighted-group marquee-group">${groupHtml}</div>
        <div class="scanner-highlighted-group marquee-group" aria-hidden="true">${groupHtml}</div>
    `;
}

function buildMarqueeLoopListings(listings) {
    const loopListings = [...listings];
    const minimumLoopItems = 16;

    while (loopListings.length < minimumLoopItems) {
        loopListings.push(...listings);
    }

    return loopListings.slice(0, Math.max(minimumLoopItems, listings.length));
}

function buildScannerHighlightedCard(housing, index) {
    const imgPath = getScannerListingImagePath(housing);
    const cardHeading = escapeHtml(housing.title || housing.street_name || "Andelsbolig");
    const addressText = escapeHtml(formatScannerListingAddress(housing));
    const priceFormatted = formatScannerListingNumber(housing.price, "kr.");
    const feeFormatted = housing.monthly_fee
        ? `${formatScannerListingNumber(housing.monthly_fee, "kr.")}/md`
        : "-/md";
    const sqmFormatted = housing.square_meters ? `${housing.square_meters} m²` : "- m²";
    const roomsFormatted = housing.rooms ? `${housing.rooms} vær.` : "- vær.";
    const loadingAttribute = index < 4 ? 'loading="eager"' : 'loading="lazy"';
    // The frontpage live-overvågning carousel is a FOMO/hype section. Treat
    // every card shown here as already sold regardless of backend status.
    const statusBadgeHtml = buildScannerSoldBadgeHtml();
    const cardAttributes = 'class="scanner-highlighted-card-inner scanner-highlighted-card-inner-unavailable" role="button" tabindex="0" data-unavailable-status="sold"';


    return `
        <article class="scanner-highlighted-card" aria-label="${cardHeading}">
            <div ${cardAttributes}>
                <div class="scanner-highlighted-thumb">
                    <img src="${imgPath}" alt="${cardHeading}" ${loadingAttribute} width="520" height="340">
                    <div class="scanner-highlighted-badges">
                        <span class="scanner-highlighted-live">
                            <span class="live-indicator"></span>
                            Live fund
                        </span>
                        ${statusBadgeHtml}
                    </div>
                </div>
                <div class="scanner-highlighted-body">
                    <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
                        <h3 class="scanner-highlighted-title mb-0">${cardHeading}</h3>
                        <span class="scanner-highlighted-price">${priceFormatted}</span>
                    </div>
                    <p class="scanner-highlighted-address mb-3">${addressText}</p>
                    <div class="scanner-highlighted-meta">
                        <span><i class="fa-solid fa-house"></i>${sqmFormatted}</span>
                        <span><i class="fa-solid fa-bed"></i>${roomsFormatted}</span>
                        <span><i class="fa-solid fa-coins"></i>${feeFormatted}</span>
                    </div>
                </div>
            </div>
        </article>
    `;
}

function setupScannerHighlightedUnavailableClickHandler(track) {
    if (scannerHighlightedUnavailableClickHandlerReady) return;

    track.addEventListener("click", handleScannerHighlightedUnavailableActivation);
    track.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;

        const unavailableCard = event.target.closest("[data-unavailable-status]");
        if (!unavailableCard || !track.contains(unavailableCard)) return;

        event.preventDefault();
        handleScannerHighlightedUnavailableActivation(event);
    });

    scannerHighlightedUnavailableClickHandlerReady = true;
}

function handleScannerHighlightedUnavailableActivation(event) {
    const unavailableCard = event.target.closest("[data-unavailable-status]");
    if (!unavailableCard) return;

    const message = unavailableCard.dataset.unavailableStatus === "sold"
        ? "Boligen er desværre solgt."
        : "Boligen er desværre reserveret.";

    displayErrorMessage(message, 3500);
}

function buildScannerSoldBadgeHtml() {
    return `<span class="badge-glass badge-sold"><i class="fa-solid fa-handshake"></i><span>Solgt</span></span>`;
}

function getScannerListingImagePath(housing) {
    const imageName = housing?.images?.[0]?.name;
    return imageName ? `${s3Url}/${imageName}` : `${basePath}/pics/default4.webp`;
}

function formatScannerListingAddress(housing) {
    const street = housing.street_name || housing.address || "";
    const postal = [housing.postal_number, housing.city || housing.postal_name]
        .filter(Boolean)
        .join(" ");

    return [street, postal].filter(Boolean).join(", ") || "Adresse ikke angivet";
}

function formatScannerListingNumber(value, suffix) {
    if (!value) return "-";
    return `${Number(value).toLocaleString("da-DK")} ${suffix}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export async function fetchAdvertisementData() {
    // Used for stats or featured listings
    const response = await authFetch("/advertisement_data");
    if (!response.ok) return null;

    try {
        return await response.json();
    } catch (error) {
        console.error("Failed to parse advertisement data", error);
        return null;
    }
}

export function initDynamicUserCount(fetchedTotalUsers) {
    const counterElement = document.getElementById('user-count-number');
    // If the element doesn't exist (e.g., user is not on the landing page), do nothing.
    if (!counterElement) return;

    // Fallback to 550 if the API didn't return a valid number
    // Start the counter 60 numbers below the target for a snappy, satisfying animation
    const startCount = Math.max(0, fetchedTotalUsers - 60);
    const animationDuration = 10000; // 2 seconds

    animateValue(counterElement, startCount, fetchedTotalUsers, animationDuration);
}

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;

    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);

        // easeOutExpo easing function: Starts fast, slows down smoothly at the end
        const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

        const currentCount = Math.floor(easeProgress * (end - start) + start);

        // Format the number to Danish locale (e.g. 1.250 instead of 1250)
        obj.innerHTML = new Intl.NumberFormat('da-DK').format(currentCount);

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            // Force it to end on the exact target number when the animation finishes
            obj.innerHTML = new Intl.NumberFormat('da-DK').format(end);
        }
    };

    window.requestAnimationFrame(step);
}

export function initDynamicScrapedCount(fetchedTotalScraped) {
    const counterElement = document.getElementById('scraped-count-number');

    // Hvis elementet ikke findes (fx hvis brugeren er på en anden underside), stopper vi bare
    if (!counterElement) return;

    // Fallback til 14.852, hvis API'et af en eller anden grund fejler eller returnerer null
    const targetCount = fetchedTotalScraped || 5312;

    // Start animationen 300 numre under målet, så den ruller visuelt op til det korrekte tal
    const startCount = Math.max(0, targetCount - 300);
    const animationDuration = 2500; // 2.5 sekunder giver en god, "tung" fornemmelse

    // Genbrug din eksisterende animateValue funktion!
    animateValue(counterElement, startCount, targetCount, animationDuration);
}
