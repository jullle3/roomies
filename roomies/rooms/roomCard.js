// Shared listing-card markup, used by both the search view (ledige_vaerelser)
// and the landing "Nye værelser" section. Each caller normalizes its own data
// into the model shape below, so the HTML lives in exactly one place.
//
// model: { id, title, image, location, price, size, available, availableFrom,
//          furnished, petsAllowed, avatar, host, isOwn }

import {roomDetailPath} from "./roomUrl.js";

const EXAMPLE_ROOM_IMAGE = "/pics/room_default1.webp";

// Max number of fact chips shown at the bottom of the card.
const MAX_FACT_CHIPS = 3;

export function renderRoomCard(model) {
    const detailUrl = roomDetailPath(model);

    return `
        <div class="col-12 col-md-6 col-xl-4">
            <article class="card room-card">
                <a class="room-card-detail-link" href="${detailUrl}" data-room-detail-id="${escapeAttribute(model.id)}" aria-label="Se detaljer for ${escapeHtml(model.title)}"></a>
                <div class="room-thumb-wrapper">
                    <img class="room-photo" src="${model.image || EXAMPLE_ROOM_IMAGE}" alt="${escapeHtml(model.title)}" loading="lazy">
                    ${model.available === false ? `<span class="room-card-status-badge room-card-status-rented badge rounded-pill shadow-sm"><i class="fa-solid fa-handshake me-1"></i>Udlejet</span>` : ""}
                    ${model.isOwn ? `<span class="room-search-own badge rounded-pill shadow-sm"><i class="fa-solid fa-user-check me-1"></i>Din annonce</span>` : ""}
                    ${model.avatar ? `<img class="avatar-overlap" src="${model.avatar}" alt="${escapeHtml(model.host)}" loading="lazy">` : ""}
                </div>
                <div class="card-body p-4 pt-4 mt-2 d-flex flex-column">
                    <h3 class="h5 fw-bold mb-2">${escapeHtml(model.title)}</h3>
                    <p class="text-muted small mb-3">
                        <i class="fa-solid fa-location-dot me-1"></i>${escapeHtml(model.location)}
                    </p>
                    <div class="d-flex align-items-end justify-content-between gap-3 mb-3">
                        <strong class="room-search-price">${formatNumber(model.price)} <span>kr./md</span></strong>
                        <span class="text-muted fw-bold">${model.size ? `${formatNumber(model.size)} m²` : "- m²"}</span>
                    </div>
                    <div class="room-search-facts d-flex flex-wrap gap-3 mt-auto pt-3 border-top">
                        ${buildFactChips(model).join("")}
                    </div>
                </div>
            </article>
        </div>
    `;
}

// Bottom-of-card chips, prioritized and capped at MAX_FACT_CHIPS.
// Availability always comes first; the rest fill remaining slots by priority.
function buildFactChips(model) {
    const chips = [
        model.available === false
            ? `<span><i class="fa-solid fa-handshake me-1"></i>Udlejet</span>`
            : `<span><i class="fa-regular fa-calendar me-1"></i>Ledig ${formatAvailableDate(model.availableFrom)}</span>`
    ];

    const candidates = [];
    if (model.furnished) candidates.push(facilityChip("fa-solid fa-couch", "Møbleret"));
    if (model.petsAllowed) candidates.push(facilityChip("fa-solid fa-paw", "Kæledyr"));

    return chips.concat(candidates).slice(0, MAX_FACT_CHIPS);
}

function facilityChip(icon, label) {
    return `<span><i class="${icon} me-1"></i>${label}</span>`;
}

function formatAvailableDate(value) {
    if (value == null || value === "") return "Efter aftale";

    const numericValue = Number(value);
    const date = Number.isFinite(numericValue) && String(value).trim() !== ""
        ? new Date(numericValue < 10000000000 ? numericValue * 1000 : numericValue)
        : new Date(value);

    if (Number.isNaN(date.getTime())) return "Efter aftale";
    // Already available (date today or in the past) reads as "Ledig nu".
    if (isTodayOrPast(date)) return "nu";
    return new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "short"}).format(date);
}

// True when the given date falls on or before today (compared by calendar day).
function isTodayOrPast(date) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfDate = new Date(date);
    startOfDate.setHours(0, 0, 0, 0);
    return startOfDate <= startOfToday;
}

function formatNumber(value) {
    return new Intl.NumberFormat("da-DK").format(Number(value || 0));
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
}
