import {getCachedRooms, onRoomsLoaded} from "../rooms/room_cache.js";
import {s3Url} from "../config/config.js";
import {renderRoomCard as renderSharedRoomCard} from "../rooms/roomCard.js";
import {decodeJwt} from "../utils.js";
import {areaAutocompleteOptions} from "../config/hardcoded_data.js";

// Client-side "load more" pagination: all rooms loaded and filtered locally, then
// shown in batches. 18 keeps clean rows across the 1/2/3-column responsive grid.
const ROOMS_PER_BATCH = 18;
const AREA_SUGGESTION_LIMIT = 6;
const AREA_LOOKUP = new Map(areaAutocompleteOptions.map(area => [String(area.id), area]));
let roomSearchVisible = ROOMS_PER_BATCH;

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

    form.addEventListener("change", event => {
        // The slider and location field have their own debounced input handlers.
        // Ignore their trailing "change" events (slider release, input blur) so
        // results don't render — and animate — a second time.
        if (event.target.matches(".room-search-native-range, #room-search-location")) return;
        renderRoomListings();
    });
    setupRoomAreaAutocomplete();
    document.getElementById("room-search-reset")?.addEventListener("click", resetRoomSearch);
    document.querySelector("[data-reset-room-search]")?.addEventListener("click", resetRoomSearch);
    document.getElementById("room-search-load-more")?.addEventListener("click", handleLoadMore);
    onRoomsLoaded(renderRoomListings);

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

// Entry point for any filter/search change: results change, so reset to first batch.
function renderRoomListings() {
    roomSearchVisible = ROOMS_PER_BATCH;
    // animate: a filter/search changed the result set — nudge the grid so the
    // (instant, client-side) update is perceptible. "Load more" stays silent.
    renderRoomSearchResults({animate: true});
}

// Coalesce high-frequency inputs (slider drag, location typing) so we only
// re-filter/re-render once the user pauses, instead of on every event.
const debouncedRenderRoomListings = debounce(renderRoomListings, 300);

function debounce(fn, delay) {
    let timer = null;
    const debounced = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
    debounced.cancel = () => {
        clearTimeout(timer);
        timer = null;
    };
    return debounced;
}

function renderRoomSearchResults({animate = false} = {}) {
    const results = document.getElementById("room-search-results");
    const empty = document.getElementById("room-search-empty");
    const count = document.getElementById("room-search-count");
    const loadMore = document.getElementById("room-search-load-more");
    if (!results || !empty || !count) return;

    const cachedRooms = getCachedRooms();
    if (cachedRooms === null) {
        results.innerHTML = renderRoomSearchLoadingState();
        empty.classList.add("d-none");
        renderRoomSearchLoadMore(loadMore, 0, 0);
        count.textContent = "Indlæser værelser...";
        return;
    }

    const rooms = getFilteredRooms(cachedRooms);
    updateRoomSearchEmptyState(cachedRooms.length === 0);

    roomSearchVisible = Math.min(Math.max(roomSearchVisible, ROOMS_PER_BATCH), Math.max(rooms.length, ROOMS_PER_BATCH));
    const shown = Math.min(roomSearchVisible, rooms.length);
    const pageRooms = rooms.slice(0, shown);

    results.innerHTML = pageRooms.map(renderRoomCard).join("");
    empty.classList.toggle("d-none", rooms.length > 0);
    count.textContent = getRoomCountLabel(rooms.length);
    renderRoomSearchLoadMore(loadMore, shown, rooms.length);

    // Re-arm the staggered card-in animation only when a filter/search changed
    // the set. Removing first (and forcing a reflow) restarts it on each change;
    // "load more" leaves it off so appended cards don't re-animate.
    results.classList.remove("room-search-results-animate");
    if (animate) {
        void results.offsetWidth;
        results.classList.add("room-search-results-animate");
    }
}

function renderRoomSearchLoadingState() {
    return `
        <div class="col-12">
            <div class="p-4 p-md-5 bg-light rounded-4 text-center">
                <i class="fa-solid fa-circle-notch fa-spin text-primary-coral mb-3"></i>
                <p class="fw-bold text-muted mb-0">Indlæser værelser...</p>
            </div>
        </div>
    `;
}

function getRoomCountLabel(total) {
    if (total === 0) return "Ingen ledige værelser";
    if (total === 1) return "1 ledigt værelse";
    return `${formatNumber(total)} ledige værelser`;
}

function handleLoadMore() {
    roomSearchVisible += ROOMS_PER_BATCH;
    renderRoomSearchResults();
}

function renderRoomSearchLoadMore(container, shown, total) {
    if (!container) return;

    const remaining = total - shown;
    if (remaining <= 0) {
        container.classList.add("d-none");
        container.disabled = true;
        return;
    }

    container.classList.remove("d-none");
    container.disabled = false;
    container.innerHTML = `<i class="fa-solid fa-arrow-down me-2"></i>Vis mere`;
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
    const maxDeposit = Number(data.get("max_deposit")) || Infinity;
    const availableBefore = parseAvailableBefore(data.get("available_before"));

    const rooms = cachedRooms
        .filter(room => room?.visible !== false)
        .map(normalizeRoomListing)
        .filter(room => {
        const searchableLocation = getNormalizedText(`${room.postal} ${room.area}`);
        const locationMatches = selectedAreaId
            ? roomMatchesSelectedArea(room, selectedAreaId)
            : (!location || searchableLocation.includes(location));

        // Rooms without an available_from are treated as "available now" so the
        // move-in filter never hides listings that simply lack the date.
        const availableInTime = availableBefore === Infinity
            || !room.availableFrom
            || Number(room.availableFrom) <= availableBefore;

        return locationMatches
            && room.rent <= maxRent
            && room.size >= minSize
            && room.upfront <= maxDeposit
            && availableInTime
            && (!data.has("furnished") || room.furnished)
            && (!data.has("pets_allowed") || room.petsAllowed)
            && (!data.has("washing_machine") || room.washingMachine)
            && (!data.has("dishwasher") || room.dishwasher);
        });

    const currentUserId = decodeJwt()?.sub || "";
    rooms.forEach(room => {
        room.isOwn = Boolean(currentUserId && room.createdBy === currentUserId);
    });

    return rooms.sort((a, b) => {
        // The user's own listings always float to the top.
        if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;

        switch (data.get("sort")) {
            case "rent_asc":
                return a.rent - b.rent;
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
        createdBy: String(room.created_by || ""),
        title: room.title || "Ledigt værelse",
        postalNumber: Number(room.postal_number),
        postal: postal || room.address || "Adresse ikke angivet",
        area: area || room.address || postal || "",
        // Always show total incl. aconto on cards (matches detail view).
        rent: Number(room.total_monthly_price ?? (Number(room.monthly_price ?? room.price ?? 0) + Number(room.acconto_monthly_price ?? 0))),
        size: Number(room.square_meters ?? 0),
        available: room.available !== false,
        availableFrom: room.available_from ?? null,
        furnished: Boolean(room.furnished),
        petsAllowed: Boolean(room.pets_allowed),
        washingMachine: Boolean(room.washing_machine),
        dishwasher: Boolean(room.dishwasher),
        // "Indskud" = depositum + forudbetalt husleje (the upfront sum)
        upfront: Number(room.deposit ?? 0) + Number(room.prepaid_rent ?? 0),
        roommates: Number(room.current_roomies ?? room.rooms ?? 0),
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

function getRoomImage(room) {
    const firstImage = Array.isArray(room.images) ? room.images[0] : null;
    if (typeof firstImage === "string" && firstImage) return buildS3ImageUrl(firstImage);
    if (firstImage?.name) return buildS3ImageUrl(firstImage.name);
    if (firstImage?.url) return firstImage.url;
    if (firstImage?.src) return firstImage.src;
    if (firstImage?.image_url) return firstImage.image_url;
    if (firstImage?.cloudflare_url) return firstImage.cloudflare_url;
    return "/pics/room_default1.webp";
}

function buildS3ImageUrl(imageName) {
    if (!imageName) return "";
    if (/^https?:\/\//i.test(imageName)) return imageName;
    return `${s3Url}/${String(imageName).replace(/^\/+/, "")}`;
}

function getRoomAvatar(room) {
    // Only show a real owner photo. No placeholder avatar — we don't want fake faces.
    if (typeof room.profile_photo === "string" && room.profile_photo.trim()) {
        return buildS3ImageUrl(room.profile_photo.trim());
    }
    return "";
}

function formatCreatedDate(value) {
    if (!value) return "1970-01-01";
    if (typeof value === "number") {
        return new Date(value * 1000).toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
}

function renderRoomCard(room) {
    return renderSharedRoomCard({
        id: room.id,
        title: room.title,
        image: room.image,
        location: room.postal,
        price: room.rent,
        size: room.size,
        available: room.available,
        availableFrom: room.availableFrom,
        furnished: room.furnished,
        petsAllowed: room.petsAllowed,
        avatar: room.avatar,
        host: room.host,
        isOwn: room.isOwn
    });
}

function resetRoomSearch() {
    document.getElementById("room-search-form")?.reset();
    const locationInput = document.getElementById("room-search-location");
    if (locationInput) locationInput.dataset.areaId = "";
    hideRoomAreaSuggestions();
    setRoomSearchSliderValue("room-search-rent-slider", 10000);
    setRoomSearchSliderValue("room-search-size-slider", 5);
    debouncedRenderRoomListings.cancel();
    renderRoomListings();
}

function setupRoomAreaAutocomplete() {
    const input = document.getElementById("room-search-location");
    const suggestions = document.getElementById("room-search-area-suggestions");
    if (!input || !suggestions || input.dataset.areaAutocompleteBound === "1") return;

    input.dataset.areaAutocompleteBound = "1";

    input.addEventListener("input", () => {
        input.dataset.areaId = "";
        renderRoomAreaSuggestions(input.value);
        debouncedRenderRoomListings();
    });

    input.addEventListener("focus", () => {
        renderRoomAreaSuggestions(input.value);
    });

    input.addEventListener("keydown", event => {
        const options = [...suggestions.querySelectorAll("[data-room-area-option]")];
        if (!options.length) return;

        const currentIndex = options.findIndex(option => option.classList.contains("is-active"));

        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveRoomAreaOption(options, currentIndex + 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveRoomAreaOption(options, currentIndex - 1);
        } else if (event.key === "Enter") {
            const active = suggestions.querySelector("[data-room-area-option].is-active") || options[0];
            if (active) {
                event.preventDefault();
                selectRoomArea(active.dataset.roomAreaOption);
            }
        } else if (event.key === "Escape") {
            hideRoomAreaSuggestions();
        }
    });

    suggestions.addEventListener("mousedown", event => {
        const option = event.target.closest("[data-room-area-option]");
        if (!option) return;

        event.preventDefault();
        selectRoomArea(option.dataset.roomAreaOption);
    });

    document.addEventListener("click", event => {
        if (event.target === input || suggestions.contains(event.target)) return;
        hideRoomAreaSuggestions();
    });
}

function renderRoomAreaSuggestions(rawQuery = "") {
    const suggestions = document.getElementById("room-search-area-suggestions");
    if (!suggestions) return;

    const query = normalizeAreaSearchText(rawQuery);
    const matches = areaAutocompleteOptions
        .filter(area => !query || normalizeAreaSearchText(area.searchText || area.label).includes(query))
        .slice(0, AREA_SUGGESTION_LIMIT);

    if (!matches.length) {
        suggestions.innerHTML = `
            <div class="room-search-area-empty">
                <i class="fa-regular fa-face-smile me-2"></i>Prøv et postnummer eller område
            </div>
        `;
        suggestions.classList.add("is-open");
        return;
    }

    suggestions.innerHTML = matches.map((area, index) => `
        <button type="button"
                class="room-search-area-option ${index === 0 ? "is-active" : ""}"
                data-room-area-option="${escapeHtml(area.id)}"
                role="option"
                aria-selected="${index === 0 ? "true" : "false"}">
            <i class="${escapeHtml(area.icon || "fa-solid fa-location-dot")}"></i>
            <span>${escapeHtml(area.label)}</span>
        </button>
    `).join("");
    suggestions.classList.add("is-open");
}

function selectRoomArea(areaId) {
    const input = document.getElementById("room-search-location");
    const area = AREA_LOOKUP.get(String(areaId));
    if (!input || !area) return;

    input.value = area.label;
    input.dataset.areaId = String(area.id);
    hideRoomAreaSuggestions();
    renderRoomListings();
}

function setActiveRoomAreaOption(options, nextIndex) {
    const boundedIndex = (nextIndex + options.length) % options.length;
    options.forEach((option, index) => {
        const isActive = index === boundedIndex;
        option.classList.toggle("is-active", isActive);
        option.setAttribute("aria-selected", String(isActive));
        if (isActive) option.scrollIntoView({block: "nearest"});
    });
}

function hideRoomAreaSuggestions() {
    const suggestions = document.getElementById("room-search-area-suggestions");
    if (!suggestions) return;

    suggestions.classList.remove("is-open");
    suggestions.innerHTML = "";
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
        openLabel: "10.000+",
        formatValue: value => `${formatNumber(value)} kr.`
    });

    // Minimum room size (m²). Resting at the low end means "no minimum".
    setupRoomSearchSlider({
        sliderId: "room-search-size-slider",
        inputId: "room-search-min-size",
        outputId: "room-search-size-value",
        start: 5,
        range: {min: 5, max: 30},
        step: 1,
        isOpenEnd: value => value <= 5,
        openLabel: "5 m²+",
        formatValue: value => `${formatNumber(value)} m2`
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
        debouncedRenderRoomListings();
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

function formatNumber(value) {
    return new Intl.NumberFormat("da-DK").format(value);
}

function getNormalizedText(value) {
    return String(value || "").trim().toLocaleLowerCase("da-DK");
}

function normalizeAreaSearchText(value) {
    return getNormalizedText(value)
        .replaceAll("æ", "ae")
        .replaceAll("ø", "oe")
        .replaceAll("å", "aa")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

// "Indflytning senest" date (YYYY-MM-DD) → end-of-day epoch seconds, or Infinity
// when unset so the filter is a no-op. Matches room.available_from (epoch seconds).
function parseAvailableBefore(value) {
    if (!value) return Infinity;
    const epoch = Math.floor(new Date(`${value}T23:59:59`).getTime() / 1000);
    return Number.isFinite(epoch) ? epoch : Infinity;
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
}
