import {getCachedRooms, onRoomsLoaded} from "../rooms/room_cache.js";
import {s3Url} from "../config/config.js";

const FAVORITES_KEY = "roomies_room_favorites";

let roomFavorites = readFavorites();

export function setupRoomSearchView() {
    const form = document.getElementById("room-search-form");
    const results = document.getElementById("room-search-results");
    if (!form || !results || form.dataset.bound) return;

    form.dataset.bound = "1";

    setupRoomSearchSliders();
    setupRoomSearchFilterDropdown();

    form.addEventListener("submit", event => {
        event.preventDefault();
        renderRoomListings();
    });

    form.addEventListener("change", renderRoomListings);
    document.getElementById("room-search-location")?.addEventListener("input", event => {
        event.currentTarget.dataset.areaId = "";
        renderRoomListings();
    });
    document.getElementById("room-search-reset")?.addEventListener("click", resetRoomSearch);
    document.querySelector("[data-reset-room-search]")?.addEventListener("click", resetRoomSearch);
    onRoomsLoaded(renderRoomListings);

    results.addEventListener("click", event => {
        const button = event.target.closest("[data-room-favorite]");
        if (button) {
            toggleFavorite(button.dataset.roomFavorite);
            renderRoomListings();
            event.preventDefault();
            event.stopPropagation();
        }
    });

    window.openRoomSearch = openRoomSearch;
    renderRoomListings();
}

function openRoomSearch() {
    const landingInput = document.getElementById("landing-room-search-location");
    const landingLocation = landingInput?.value || "";
    const searchLocation = document.getElementById("room-search-location");
    if (searchLocation) {
        searchLocation.value = landingLocation;
        searchLocation.dataset.areaId = landingInput?.dataset.areaId || "";
    }

    window.showView("soeg_vaerelse");
    renderRoomListings();
}

function renderRoomListings() {
    const results = document.getElementById("room-search-results");
    const empty = document.getElementById("room-search-empty");
    const count = document.getElementById("room-search-count");
    if (!results || !empty || !count) return;

    const cachedRooms = getCachedRooms();
    if (cachedRooms === null) {
        results.innerHTML = "";
        empty.classList.add("d-none");
        count.textContent = "Indlæser værelser...";
        return;
    }

    const rooms = getFilteredRooms(cachedRooms);
    updateRoomSearchEmptyState(cachedRooms.length === 0);

    results.innerHTML = rooms.map(renderRoomCard).join("");
    empty.classList.toggle("d-none", rooms.length > 0);
    count.textContent = rooms.length === 1 ? "1 ledigt værelse" : `${rooms.length} ledige værelser`;
}

function updateRoomSearchEmptyState(hasNoFetchedRooms) {
    const icon = document.getElementById("room-search-empty-icon");
    const title = document.getElementById("room-search-empty-title");
    const text = document.getElementById("room-search-empty-text");
    const createButton = document.getElementById("room-search-empty-create");
    const resetButton = document.getElementById("room-search-empty-reset");

    if (!icon || !title || !text || !createButton || !resetButton) return;

    icon.className = hasNoFetchedRooms
        ? "fa-solid fa-house-circle-check mb-3"
        : "fa-solid fa-magnifying-glass mb-3";
    title.textContent = hasNoFetchedRooms
        ? "Ingen værelser endnu"
        : "Ingen værelser matcher endnu";
    text.textContent = hasNoFetchedRooms
        ? "De første roomies er på vej ind. Du kan allerede oprette din egen annonce gratis."
        : "Prøv at udvide dit område eller justere dine filtre.";
    createButton.classList.toggle("d-none", !hasNoFetchedRooms);
    resetButton.classList.toggle("d-none", hasNoFetchedRooms);
}

function getFilteredRooms(cachedRooms) {
    const form = document.getElementById("room-search-form");
    const data = new FormData(form);

    const location = getNormalizedText(data.get("location"));
    const selectedAreaId = document.getElementById("room-search-location")?.dataset.areaId || "";
    const maxRent = Number(data.get("max_rent")) || Infinity;
    const minSize = Number(data.get("min_size")) || 0;

    const rooms = cachedRooms
        .filter(room => room?.visible !== false)
        .filter(room => room?.available !== false)
        .map(normalizeRoomListing)
        .filter(room => {
        const searchableLocation = getNormalizedText(`${room.postal} ${room.area}`);
        const locationMatches = selectedAreaId
            ? roomMatchesSelectedArea(room, selectedAreaId)
            : (!location || searchableLocation.includes(location));

        return locationMatches
            && room.rent <= maxRent
            && room.size >= minSize
            && (!data.has("furnished") || room.furnished)
            && (!data.has("registration_allowed") || room.registrationAllowed)
            && (!data.has("utilities_included") || room.utilitiesIncluded);
        });

    return rooms.sort((a, b) => {
        switch (data.get("sort")) {
            case "rent_asc":
                return a.rent - b.rent;
            case "size_desc":
                return b.size - a.size;
            default:
                return new Date(b.created) - new Date(a.created);
        }
    });
}

function normalizeRoomListing(room) {
    const postal = [room.postal_number, room.postal_name || room.city].filter(Boolean).join(" ");
    const addressParts = [room.street_name, room.house_number, room.floor, room.floor_side].filter(Boolean);
    const area = [addressParts.join(" "), room.postal_name || room.city].filter(Boolean).join(", ");

    return {
        id: room._id || room.id || crypto.randomUUID(),
        title: room.title || "Ledigt værelse",
        postalNumber: Number(room.postal_number),
        postal: postal || room.address || "Adresse ikke angivet",
        area: area || room.address || postal || "",
        rent: Number(room.monthly_price ?? room.price ?? 0),
        size: Number(room.square_meters ?? 0),
        availableFrom: room.available_from ?? null,
        furnished: Boolean(room.furnished),
        registrationAllowed: Boolean(room.cpr_registration_allowed),
        utilitiesIncluded: Boolean(room.utilities_included),
        roommates: Number(room.current_roomies ?? room.rooms ?? 0),
        vibes: getRoomVibes(room),
        image: getRoomImage(room),
        avatar: getRoomAvatar(room),
        host: room.host_name || room.created_by_name || "en roomie",
        created: formatCreatedDate(room.created)
    };
}

function roomMatchesSelectedArea(room, areaId) {
    const postalNumber = Number(room.postalNumber);
    if (!Number.isFinite(postalNumber)) return false;

    const id = String(areaId || "");
    if (/^\d{8}$/.test(id)) {
        const min = Number(id.slice(0, 4));
        const max = Number(id.slice(4, 8));
        return postalNumber >= min && postalNumber <= max;
    }

    return String(postalNumber) === id;
}

function getRoomVibes(room) {
    const vibes = [];
    if (room.communal_dinners) vibes.push("Socialt");
    if (room.cleaning_plan) vibes.push("Rengøringsplan");
    if (room.pets_allowed) vibes.push("Kæledyr");
    if (room.privacy_focused) vibes.push("Stille");
    if (room.furnished) vibes.push("Møbleret");
    return vibes.length ? vibes : ["Roomie"];
}

function getRoomImage(room) {
    const firstImage = Array.isArray(room.images) ? room.images[0] : null;
    if (typeof firstImage === "string" && firstImage) return firstImage;
    if (firstImage?.name) return buildS3ImageUrl(firstImage.name);
    if (firstImage?.url) return firstImage.url;
    if (firstImage?.src) return firstImage.src;
    if (firstImage?.image_url) return firstImage.image_url;
    if (firstImage?.cloudflare_url) return firstImage.cloudflare_url;
    return "/pics/udlej-vaerelse-example-room.png";
}

function buildS3ImageUrl(imageName) {
    if (!imageName) return "";
    if (/^https?:\/\//i.test(imageName)) return imageName;
    return `${s3Url}/${String(imageName).replace(/^\/+/, "")}`;
}

function getRoomAvatar(room) {
    return room.avatar || room.user_avatar || "/pics/community-young-woman-1.png";
}

function formatCreatedDate(value) {
    if (!value) return "1970-01-01";
    if (typeof value === "number") {
        return new Date(value * 1000).toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
}

function renderRoomCard(room) {
    const isFavorite = roomFavorites.has(room.id);
    const favoriteLabel = isFavorite ? "Fjern fra gemte værelser" : "Gem værelse";
    const favoriteIcon = isFavorite ? "fa-solid" : "fa-regular";
    const detailUrl = `/vaerelse?id=${encodeURIComponent(room.id)}`;

    return `
        <div class="col-12 col-md-6 col-xl-4">
            <article class="card room-card h-100">
                <a class="room-card-detail-link" href="${detailUrl}" data-room-detail-id="${room.id}" aria-label="Se detaljer for ${escapeHtml(room.title)}"></a>
                <div class="room-thumb-wrapper">
                    <img class="room-photo" src="${room.image}" alt="${escapeHtml(room.title)}" loading="lazy">
                    <button class="room-search-favorite" type="button" data-room-favorite="${room.id}" aria-label="${favoriteLabel}" title="${favoriteLabel}">
                        <i class="${favoriteIcon} fa-heart"></i>
                    </button>
                    <span class="room-search-available badge bg-white text-dark rounded-pill shadow-sm">
                        <i class="fa-regular fa-calendar me-1 text-primary"></i>${formatAvailableDate(room.availableFrom)}
                    </span>
                    <img class="avatar-overlap" src="${room.avatar}" alt="${escapeHtml(room.host)}" loading="lazy">
                </div>
                <div class="card-body p-4 pt-4 mt-2 d-flex flex-column">
                    <h3 class="h5 fw-bold mb-2">${escapeHtml(room.title)}</h3>
                    <p class="text-muted small mb-3">
                        <i class="fa-solid fa-location-dot me-1"></i>${escapeHtml(room.postal)}
                    </p>
                    <div class="d-flex align-items-end justify-content-between gap-3 mb-3">
                        <strong class="room-search-price">${formatNumber(room.rent)} <span>kr./md</span></strong>
                        <span class="text-muted fw-bold">${room.size} m²</span>
                    </div>
                    <div class="d-flex flex-wrap gap-2 mb-4">
                        ${room.vibes.map(vibe => `<span class="vibe-tag">${getVibeEmoji(vibe)} ${escapeHtml(vibe)}</span>`).join("")}
                    </div>
                    <div class="room-search-facts d-flex flex-wrap gap-3 mt-auto pt-3 border-top">
                        <span><i class="fa-regular fa-user me-1"></i>${room.roommates} roomie${room.roommates === 1 ? "" : "s"}</span>
                        ${room.furnished ? '<span><i class="fa-solid fa-couch me-1"></i>Møbleret</span>' : ""}
                        ${room.utilitiesIncluded ? '<span><i class="fa-solid fa-bolt me-1"></i>Forbrug inkl.</span>' : ""}
                    </div>
                    <p class="room-search-host small mb-0 mt-3"><i class="fa-regular fa-face-smile me-1"></i> Bo med <strong>${escapeHtml(room.host)}</strong></p>
                </div>
            </article>
        </div>
    `;
}

function resetRoomSearch() {
    document.getElementById("room-search-form")?.reset();
    const locationInput = document.getElementById("room-search-location");
    if (locationInput) locationInput.dataset.areaId = "";
    setRoomSearchSliderValue("room-search-rent-slider", 10000);
    setRoomSearchSliderValue("room-search-size-slider", 5);
    renderRoomListings();
}

function setupRoomSearchSliders() {
    setupRoomSearchSlider({
        sliderId: "room-search-rent-slider",
        inputId: "room-search-max-rent",
        outputId: "room-search-rent-value",
        start: 10000,
        range: {min: 2000, max: 10000},
        step: 250,
        isOpenEnd: value => value >= 10000,
        openLabel: "Alle priser",
        formatValue: value => `${formatNumber(value)} kr.`
    });

    setupRoomSearchSlider({
        sliderId: "room-search-size-slider",
        inputId: "room-search-min-size",
        outputId: "room-search-size-value",
        start: 5,
        range: {min: 5, max: 30},
        step: 1,
        isOpenEnd: value => value <= 5,
        openLabel: "Alle størrelser",
        formatValue: value => `${formatNumber(value)} m²`
    });
}

function setupRoomSearchFilterDropdown() {
    const toggle = document.getElementById("room-search-filter-toggle");
    if (!toggle) return;

    toggle.addEventListener("shown.bs.dropdown", () => {
        requestAnimationFrame(refreshRoomSearchSliders);
    });
}

function refreshRoomSearchSliders() {
    ["room-search-rent-slider", "room-search-size-slider"].forEach(updateNativeSliderFill);
}

function setupRoomSearchSlider(config) {
    const slider = document.getElementById(config.sliderId);
    const input = document.getElementById(config.inputId);
    const output = document.getElementById(config.outputId);
    if (!slider || !input || !output || slider.dataset.nativeSliderBound === "1") return;

    slider.dataset.nativeSliderBound = "1";
    slider.dataset.openLabel = config.openLabel;
    slider.dataset.formatKind = config.formatValue(config.start).includes("m²") ? "size" : "rent";
    slider.dataset.isOpenAt = config.isOpenEnd(config.range.min) ? "min" : "max";

    const range = document.createElement("input");
    range.type = "range";
    range.className = "room-search-native-range";
    range.min = String(config.range.min);
    range.max = String(config.range.max);
    range.step = String(config.step);
    range.value = String(config.start);
    range.setAttribute("aria-label", slider.getAttribute("aria-label") || "");

    slider.innerHTML = "";
    slider.appendChild(range);

    const syncValue = () => {
        const value = Number(range.value);
        const isOpenEnd = config.isOpenEnd(value);
        input.value = isOpenEnd ? "" : String(value);
        output.value = isOpenEnd ? config.openLabel : config.formatValue(value);
        updateNativeSliderFill(config.sliderId);
        renderRoomListings();
    };

    range.addEventListener("input", syncValue);
    syncValue();
}

function setRoomSearchSliderValue(sliderId, value) {
    const range = document.querySelector(`#${sliderId} .room-search-native-range`);
    if (!range) return;

    range.value = String(value);
    range.dispatchEvent(new Event("input", {bubbles: true}));
}

function updateNativeSliderFill(sliderId) {
    const range = document.querySelector(`#${sliderId} .room-search-native-range`);
    if (!range) return;

    const min = Number(range.min);
    const max = Number(range.max);
    const value = Number(range.value);
    const percent = ((value - min) / (max - min)) * 100;
    range.style.setProperty("--room-search-range-progress", `${Math.max(0, Math.min(100, percent))}%`);
}

function toggleFavorite(roomId) {
    if (roomFavorites.has(roomId)) {
        roomFavorites.delete(roomId);
    } else {
        roomFavorites.add(roomId);
    }

    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...roomFavorites]));
}

function readFavorites() {
    try {
        const favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
        return new Set(Array.isArray(favorites) ? favorites : []);
    } catch {
        return new Set();
    }
}

function formatAvailableDate(value) {
    const date = parseDateValue(value);
    if (Number.isNaN(date.getTime())) return "Efter aftale";
    return new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "short"}).format(date);
}

function parseDateValue(value) {
    if (!value) return new Date(NaN);

    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && String(value).trim() !== "") {
        return new Date(numericValue < 10000000000 ? numericValue * 1000 : numericValue);
    }

    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T00:00:00`);
    }

    return new Date(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat("da-DK").format(value);
}

function getNormalizedText(value) {
    return String(value || "").trim().toLocaleLowerCase("da-DK");
}

function getVibeEmoji(vibe) {
    return {
        "Socialt": "🍻",
        "Rengøringsplan": "🧹",
        "Studievenligt": "🎓",
        "Kæledyr": "🐾",
        "Stille": "🤫",
        "Vegan": "🌿"
    }[vibe] || "✨";
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
}
