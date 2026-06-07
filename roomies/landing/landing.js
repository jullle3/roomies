import {authFetch} from "../auth/auth.js";
import {basePath, s3Url} from "../config/config.js";
import {displayErrorMessage} from "../utils.js";
import {preloadRooms} from "../rooms/room_cache.js";

let scannerHighlightedUnavailableClickHandlerReady = false;

export async function loadLandingNewRooms() {
    const container = document.getElementById("landing-new-rooms");
    if (!container) return;

    container.hidden = false;
    container.innerHTML = renderLandingRoomsLoadingState();

    try {
        const rooms = await preloadRooms();
        const newestRooms = Array.isArray(rooms)
            ? rooms
                .filter(room => room && room.deleted !== true && room.visible !== false)
                .sort((a, b) => Number(b.created || 0) - Number(a.created || 0))
                .slice(0, 3)
            : [];

        container.innerHTML = newestRooms.length
            ? newestRooms.map(renderLandingRoomCard).join("")
            : renderLandingRoomsEmptyState();
    } catch (error) {
        console.error("Failed to render landing rooms", error);
        container.innerHTML = renderLandingRoomsEmptyState();
    }
}

function renderLandingRoomsLoadingState() {
    return `
        <div class="col-12">
            <div class="p-4 p-md-5 bg-light rounded-4 text-center">
                <i class="fa-solid fa-circle-notch fa-spin text-primary-coral mb-3"></i>
                <p class="fw-bold text-muted mb-0">Indlæser nye værelser...</p>
            </div>
        </div>
    `;
}

function renderLandingRoomsEmptyState() {
    return `
        <div class="col-12">
            <div class="p-4 p-md-5 bg-light rounded-4 text-center border">
                <i class="fa-regular fa-face-smile text-primary-coral fs-2 mb-3"></i>
                <h3 class="h5 fw-bold mb-2">Ingen værelser endnu</h3>
                <p class="text-muted mb-4">De første roomies er på vej ind. Du kan allerede oprette din egen annonce gratis.</p>
                <a href="/udlej-vaerelse" data-view="udlej_vaerelse" class="btn btn-primary-coral rounded-pill px-4 py-2 fw-bold">
                    Udlej værelse
                </a>
            </div>
        </div>
    `;
}

function renderLandingRoomCard(room) {
    const id = room._id || room.id || "";
    const title = room.title || "Ledigt værelse";
    const area = formatLandingRoomArea(room);
    const image = getLandingRoomImage(room);
    const avatar = getLandingRoomAvatar(room);
    const host = room.host_name || room.created_by_name || "en roomie";
    const price = Number(room.monthly_price ?? room.price ?? 0);
    const size = Number(room.square_meters ?? 0);
    const detailUrl = `/vaerelse?id=${encodeURIComponent(id)}`;
    const vibes = getLandingRoomVibes(room);

    return `
        <div class="col-12 col-md-6 col-lg-4">
            <article class="card room-card h-100">
                <a class="room-card-detail-link" href="${detailUrl}" aria-label="Se detaljer for ${escapeHtml(title)}"></a>
                <div class="room-thumb-wrapper">
                    <img class="room-photo" src="${image}" alt="${escapeHtml(title)}" loading="lazy">
                    <span class="room-search-available badge bg-white text-dark rounded-pill shadow-sm">
                        <i class="fa-regular fa-calendar me-1 text-primary"></i>${formatLandingAvailableDate(room.available_from)}
                    </span>
                    <img class="avatar-overlap" src="${avatar}" alt="${escapeHtml(host)}" loading="lazy">
                </div>

                <div class="card-body p-4 pt-4 mt-2 d-flex flex-column">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <h3 class="h5 fw-bold mb-2">${escapeHtml(title)}</h3>
                            <p class="text-muted small mb-0"><i class="fa-solid fa-location-dot me-1"></i>${escapeHtml(area)}</p>
                        </div>
                    </div>

                    <strong class="room-search-price d-block mb-3">${formatLandingRoomNumber(price)} <span>kr./md</span></strong>

                    <div class="d-flex flex-wrap gap-2 mb-4">
                        ${vibes.map(vibe => `<span class="vibe-tag">${escapeHtml(vibe)}</span>`).join("")}
                    </div>

                    <div class="room-search-facts d-flex justify-content-between align-items-center small text-muted fw-medium mt-auto pt-3 border-top">
                        <span><i class="fa-regular fa-calendar me-1"></i>${formatLandingRoomCreated(room.created)}</span>
                        <span>${size ? `${formatLandingRoomNumber(size)} m²` : "Størrelse ikke angivet"}</span>
                    </div>
                </div>
            </article>
        </div>
    `;
}

function getLandingRoomVibes(room) {
    const vibes = [];
    if (room.furnished) vibes.push("Møbleret");
    if (room.cpr_registration_allowed) vibes.push("CPR muligt");
    if (room.cleaning_plan) vibes.push("Rengøringsplan");
    if (room.communal_dinners) vibes.push("Fællesspisning");
    if (room.pets_allowed) vibes.push("Kæledyr");
    return vibes.length ? vibes.slice(0, 3) : ["Roomie"];
}

function getLandingRoomAvatar(room) {
    return room.avatar || room.user_avatar || `${basePath}/pics/community-young-woman-1.png`;
}

function getLandingRoomImage(room) {
    const image = Array.isArray(room.images) ? room.images[0] : null;
    const imageName = typeof image === "string" ? image : image?.name || image?.url || image?.src || image?.image_url || image?.cloudflare_url;
    if (!imageName) return `${basePath}/pics/udlej-vaerelse-example-room.png`;
    if (/^https?:\/\//i.test(imageName)) return imageName;
    return `${s3Url}/${String(imageName).replace(/^\/+/, "")}`;
}

function formatLandingRoomArea(room) {
    const postal = [room.postal_number, room.postal_name || room.city].filter(Boolean).join(" ");
    return postal || room.address || "Område ikke angivet";
}

function formatLandingRoomCreated(value) {
    if (!value) return "Ny annonce";

    const date = new Date(Number(value) * 1000);
    if (Number.isNaN(date.getTime())) return "Ny annonce";

    return `Oprettet ${new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "short"}).format(date)}`;
}

function formatLandingAvailableDate(value) {
    if (!value) return "aftale";

    const date = new Date(Number(value) * 1000);
    if (Number.isNaN(date.getTime())) return "aftale";

    return new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "short"}).format(date);
}

function formatLandingRoomNumber(value) {
    return new Intl.NumberFormat("da-DK").format(Number(value || 0));
}

export function loadFeaturedHousings(advertisementData) {
    const container = document.getElementById("featured-housings-container");
    if(!container) return;
    if (typeof generateHousingCard !== "function") {
        document.getElementById('featured-section')?.classList.add('d-none');
        return;
    }

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
    const response = await authFetch("/roomies/advertisement_data");
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
