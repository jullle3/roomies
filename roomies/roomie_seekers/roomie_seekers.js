import {s3Url} from "../config/config.js";
import {areaAutocompleteOptions} from "../config/hardcoded_data.js";
import {isLoggedIn} from "../utils.js";
import {showView} from "../views/viewManager.js";
import {ensureRoomieProfile} from "../onboarding/roomie_onboarding.js";
import {getAllRoomieProfiles} from "../profile/roomie_profile.js";

const AREA_SUGGESTION_LIMIT = 6;
// Client-side "load more" pagination: all profiles are fetched once, filtered
// locally, then shown in batches. 18 keeps clean rows across the responsive grid.
const SEEKERS_PER_BATCH = 18;
const AREA_LOOKUP = new Map(areaAutocompleteOptions.map(area => [String(area.id), area]));

let bound = false;
let latestProfiles = [];
let seekersVisible = SEEKERS_PER_BATCH;

export function setupRoomieSeekersView() {
    const form = document.getElementById("roomie-seekers-filter-form");
    const results = document.getElementById("roomie-seekers-results");
    if (!form || !results || bound) return;

    bound = true;
    setupAreaAutocomplete();

    form.addEventListener("submit", event => {
        event.preventDefault();
        applyFilters();
    });

    // One handler drives all live filtering. Radios/selects fire both "input" and
    // "change", so listening to only "input" avoids filtering twice per interaction.
    // Discrete controls (køn) apply instantly; free-text fields (område, husleje)
    // debounce so we don't re-filter on every keystroke.
    const debouncedApply = debounce(applyFilters, 300);
    form.addEventListener("input", event => {
        if (event.target.matches('input[type="radio"], input[type="checkbox"]')) {
            applyFilters();
        } else {
            debouncedApply();
        }
    });

    document.getElementById("roomie-seekers-reset")?.addEventListener("click", () => {
        form.reset();
        const locationInput = document.getElementById("roomie-seekers-location");
        if (locationInput) locationInput.dataset.areaId = "";
        hideAreaSuggestions();
        applyFilters();
    });

    document.getElementById("roomie-seekers-load-more")?.addEventListener("click", handleLoadMore);

    results.addEventListener("click", async event => {
        // Clicking anywhere on the card (or the explicit CTA) sends a message.
        const contactButton = event.target.closest("[data-contact-seeker]");
        if (!contactButton) return;

        event.preventDefault();
        await contactSeeker(contactButton.dataset.contactSeeker);
    });
}

// Exported entry — viewManager calls this each time the view opens. Fetches the
// full profile set once, then renders it through the local filters + pagination.
export async function renderRoomieSeekersView() {
    const results = document.getElementById("roomie-seekers-results");
    const empty = document.getElementById("roomie-seekers-empty");
    const count = document.getElementById("roomie-seekers-count");
    if (!results || !empty || !count) return;

    seekersVisible = SEEKERS_PER_BATCH;
    results.innerHTML = renderLoadingState();
    empty.classList.add("d-none");
    count.textContent = "Henter roomies...";
    renderLoadMore(document.getElementById("roomie-seekers-load-more"), 0, 0);

    try {
        latestProfiles = await fetchProfiles();
        renderResults({animate: true});
    } catch (error) {
        console.error("Kunne ikke hente roomie-profiler:", error);
        results.innerHTML = renderErrorState();
        empty.classList.add("d-none");
        count.textContent = "Kunne ikke hente profiler";
    }
}

// A filter/search changed the result set: reset to the first batch, re-filter
// and re-render locally (no refetch).
function applyFilters() {
    seekersVisible = SEEKERS_PER_BATCH;
    renderResults({animate: true});
}

function handleLoadMore() {
    seekersVisible += SEEKERS_PER_BATCH;
    renderResults();
}

// Render the already-fetched profiles through the current filters + pagination.
function renderResults({animate = false} = {}) {
    const results = document.getElementById("roomie-seekers-results");
    const empty = document.getElementById("roomie-seekers-empty");
    const count = document.getElementById("roomie-seekers-count");
    const loadMore = document.getElementById("roomie-seekers-load-more");
    if (!results || !empty || !count) return;

    const seekers = filterProfiles(latestProfiles, getFilters());
    const shown = Math.min(seekersVisible, seekers.length);

    results.innerHTML = seekers.slice(0, shown).map(renderSeekerCard).join("");
    empty.classList.toggle("d-none", seekers.length > 0);
    count.textContent = getCountLabel(seekers.length);
    renderLoadMore(loadMore, shown, seekers.length);

    // Subtle "results updated" cue, replayed only when a filter/search changed the
    // set. Removing first (and forcing a reflow) restarts the stagger on each
    // change; "load more" leaves it off so appended cards don't re-animate.
    results.classList.remove("roomie-seekers-results-animate");
    if (animate) {
        void results.offsetWidth;
        results.classList.add("roomie-seekers-results-animate");
    }
}

async function fetchProfiles() {
    // Reuse the shared session cache instead of hitting /roomies/users/profile
    // again — the inbox/room-detail profile modal fetches the same set. The
    // directory keeps only public + seeking profiles via filterProfiles below.
    const list = await getAllRoomieProfiles();
    return list.map(normalizeProfile).filter(profile => profile.id);
}

function renderLoadMore(container, shown, total) {
    if (!container) return;

    const remaining = total - shown;
    if (remaining <= 0) {
        container.classList.add("d-none");
        container.disabled = true;
        return;
    }

    container.classList.remove("d-none");
    container.disabled = false;
    container.innerHTML = `<i class="fa-solid fa-arrow-down me-2"></i>Vis flere roomies`;
}

function getFilters() {
    const form = document.getElementById("roomie-seekers-filter-form");
    const data = new FormData(form);
    const areaInput = document.getElementById("roomie-seekers-location");

    return {
        areaId: areaInput?.dataset.areaId || "",
        locationText: normalizeText(data.get("location")),
        roomPrice: parseInteger(data.get("room_price")),
        gender: String(data.get("gender") || "").trim()
    };
}

function filterProfiles(profiles, filters) {
    return profiles
        .filter(profile => profile.seekingRoom === true)
        .filter(profile => matchesLocation(profile, filters))
        .filter(profile => filters.roomPrice == null || profile.monthlyPriceMax == null || profile.monthlyPriceMax >= filters.roomPrice)
        .filter(profile => !filters.gender || profile.gender === filters.gender)
        .sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
}

// A picked area uses range matching; a free-typed string falls back to a substring
// search. They are mutually exclusive: selecting an area also fills the input's
// text with the area label, and applying both would require that label to appear
// in the profile text too — which it never does, so nothing would ever match.
function matchesLocation(profile, filters) {
    if (filters.areaId) return profileMatchesArea(profile, filters.areaId);
    if (filters.locationText) return profile.searchText.includes(filters.locationText);
    return true;
}

export function normalizeProfile(raw) {
    const nested = raw?.roomie_profile && typeof raw.roomie_profile === "object" ? raw.roomie_profile : {};
    const profile = {...nested, ...raw};
    const id = String(raw?.id || raw?._id || raw?.user_id || profile.id || profile._id || "");
    const fullName = String(raw?.full_name || raw?.name || profile.full_name || profile.name || "").trim();
    const firstName = getFirstName(fullName);
    const occupations = normalizeStringList(profile.occupation);
    const interests = Array.isArray(profile.interests) ? profile.interests.map(String) : [];
    const areas = normalizeAreaIds(profile.areas);
    const areaLabels = areas.map(formatAreaLabel);

    return {
        id,
        firstName,
        fullName,
        profilePhoto: profile.profile_photo || null,
        age: parseInteger(profile.age),
        gender: profile.gender || null,
        occupations,
        interests,
        description: String(profile.description || "").trim(),
        seekingRoom: profile.seeking_room === true,
        rentingRoom: profile.renting_room === true,
        monthlyPriceMax: parseInteger(profile.monthly_price_max),
        areas,
        areaLabels,
        updated: profile.updated || raw?.updated || raw?.created || 0,
        searchText: normalizeText([
            firstName,
            fullName,
            profile.gender,
            occupations.join(" "),
            interests.join(" "),
            areaLabels.join(" "),
            profile.description
        ].filter(Boolean).join(" "))
    };
}

export function renderSeekerCard(profile) {
    const avatar = renderAvatar(profile);
    const name = profile.firstName || "Roomie";
    const meta = [
        profile.age ? `${profile.age} år` : null,
        profile.occupations.length ? profile.occupations.join(", ") : null,
        capitalizeFirst(profile.gender)
    ].filter(Boolean).join(" · ") || "Boligsøgende roomie";
    // Show at most 1 area + a "+ X andre" counter so the row never overflows the
    // card; the full list lives in the hover tooltip (title) for the curious. No
    // areas means the user hasn't decided yet, so we omit the row entirely.
    const hasAreas = profile.areaLabels.length > 0;
    const areasTooltip = hasAreas ? profile.areaLabels.join(", ") : "";
    const areasDisplay = !hasAreas
        ? ""
        : profile.areaLabels.length === 1
            ? profile.areaLabels[0]
            : `${profile.areaLabels[0]} + ${profile.areaLabels.length - 1} andre`;
    const budget = profile.monthlyPriceMax ? `Maks ${formatNumber(profile.monthlyPriceMax)} kr./md` : "Budget efter aftale 🤝";
    // Max 4 vibe tags keeps the card scannable (design system constraint).
    const vibes = profile.interests.slice(0, 4).map(interest => `<span>${escapeHtml(interest)}</span>`).join("");
    // Warm first-person fallback reads like a real person, not a database row.
    const description = profile.description
        ? escapeHtml(profile.description)
        : "Jeg leder efter et hyggeligt sted at bo og nogle skønne roomies. Skriv endelig til mig! 👋";

    return `
        <div class="col-12 col-md-6 col-xl-4">
            <article class="roomie-seeker-card h-100">
                <button type="button" class="roomie-seeker-card-link" data-contact-seeker="${escapeAttribute(profile.id)}" aria-label="Send besked til ${escapeAttribute(name)}"></button>
                <div class="roomie-seeker-card-head">
                    ${avatar}
                    <div class="roomie-seeker-identity">
                        <h3 class="text-truncate" title="${escapeAttribute(name)}">${escapeHtml(name)}</h3>
                        <p class="text-truncate" title="${escapeAttribute(meta)}">${escapeHtml(meta)}</p>
                    </div>
                </div>

                <div class="roomie-seeker-match-grid">
                    ${hasAreas ? `<div>
                        <i class="fa-solid fa-location-dot"></i>
                        <span class="text-truncate" title="${escapeAttribute(areasTooltip)}">${escapeHtml(areasDisplay)}</span>
                    </div>` : ""}
                    <div>
                        <i class="fa-solid fa-wallet"></i>
                        <span class="text-truncate" title="${escapeAttribute(budget)}">${escapeHtml(budget)}</span>
                    </div>
                </div>

                ${vibes ? `<div class="roomie-seeker-vibes">${vibes}</div>` : ""}

                <p class="roomie-seeker-description">${description}</p>

                <button type="button" class="roomie-seeker-cta btn btn-primary-coral rounded-pill fw-bold w-100 py-3 mt-auto shadow-sm" data-contact-seeker="${escapeAttribute(profile.id)}">
                    <i class="fa-regular fa-paper-plane me-2"></i>Send besked
                </button>
            </article>
        </div>
    `;
}

function renderAvatar(profile) {
    if (profile.profilePhoto) {
        const src = buildImageUrl(profile.profilePhoto);
        return `<img class="roomie-seeker-avatar" src="${escapeAttribute(src)}" alt="${escapeAttribute(profile.firstName || "Roomie")}" loading="lazy">`;
    }

    return `
        <div class="roomie-seeker-avatar roomie-seeker-avatar-fallback" aria-hidden="true">
            <i class="fa-regular fa-user"></i>
        </div>
    `;
}

export async function contactSeeker(userId) {
    if (!userId) return;

    if (isLoggedIn() && !(await ensureRoomieProfile("contact"))) {
        return;
    }

    await showView("conversations", new URLSearchParams({
        modtager: userId,
        source: "seeker"
    }));
}

function setupAreaAutocomplete() {
    const input = document.getElementById("roomie-seekers-location");
    const suggestions = document.getElementById("roomie-seekers-area-suggestions");
    if (!input || !suggestions || input.dataset.bound === "1") return;

    input.dataset.bound = "1";

    input.addEventListener("input", () => {
        input.dataset.areaId = "";
        renderAreaSuggestions(input.value);
    });
    input.addEventListener("focus", () => renderAreaSuggestions(input.value));
    input.addEventListener("keydown", event => {
        const options = [...suggestions.querySelectorAll("[data-seeker-area-option]")];
        if (!options.length) return;

        if (event.key === "Enter") {
            event.preventDefault();
            selectArea(options[0].dataset.seekerAreaOption);
        } else if (event.key === "Escape") {
            hideAreaSuggestions();
        }
    });

    suggestions.addEventListener("mousedown", event => {
        const option = event.target.closest("[data-seeker-area-option]");
        if (!option) return;

        event.preventDefault();
        selectArea(option.dataset.seekerAreaOption);
    });

    document.addEventListener("click", event => {
        if (event.target === input || suggestions.contains(event.target)) return;
        hideAreaSuggestions();
    });
}

function renderAreaSuggestions(query = "") {
    const suggestions = document.getElementById("roomie-seekers-area-suggestions");
    if (!suggestions) return;

    const normalizedQuery = normalizeText(query);
    const matches = areaAutocompleteOptions
        .filter(area => !normalizedQuery || area.searchText.includes(normalizedQuery))
        .slice(0, AREA_SUGGESTION_LIMIT);

    suggestions.innerHTML = matches.map(area => `
        <button type="button" class="roomie-seekers-area-option" data-seeker-area-option="${escapeAttribute(area.id)}">
            <i class="${escapeAttribute(area.icon || "fa-solid fa-location-dot")}"></i>
            <span>${escapeHtml(area.label)}</span>
        </button>
    `).join("");
    suggestions.classList.toggle("is-open", matches.length > 0);
}

function selectArea(areaId) {
    const area = AREA_LOOKUP.get(String(areaId));
    const input = document.getElementById("roomie-seekers-location");
    if (!area || !input) return;

    input.value = area.label;
    input.dataset.areaId = String(area.id);
    hideAreaSuggestions();
    renderRoomieSeekersView();
}

function hideAreaSuggestions() {
    const suggestions = document.getElementById("roomie-seekers-area-suggestions");
    if (!suggestions) return;

    suggestions.classList.remove("is-open");
    suggestions.innerHTML = "";
}

function profileMatchesArea(profile, areaId) {
    if (!profile.areas.length) return true;
    return profile.areas.some(candidateId => areaIdsOverlap(areaId, candidateId));
}

function areaIdsOverlap(left, right) {
    const a = toAreaRange(left);
    const b = toAreaRange(right);
    if (!a || !b) return String(left) === String(right);
    return a.min <= b.max && b.min <= a.max;
}

function toAreaRange(areaId) {
    const id = String(areaId || "");
    if (/^\d{8}$/.test(id)) {
        return {min: Number(id.slice(0, 4)), max: Number(id.slice(4, 8))};
    }
    if (/^\d{4}$/.test(id)) {
        const value = Number(id);
        return {min: value, max: value};
    }
    return null;
}

function renderLoadingState() {
    return `
        <div class="col-12">
            <div class="roomie-seekers-state-card">
                <span class="spinner-border spinner-border-sm text-primary-coral" aria-hidden="true"></span>
                <strong>Henter boligsøgende roomies...</strong>
            </div>
        </div>
    `;
}

function renderErrorState() {
    return `
        <div class="col-12">
            <div class="roomie-seekers-state-card roomie-seekers-state-card-error">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <strong>Vi kunne ikke hente profilerne lige nu.</strong>
                <span>Prøv igen om lidt.</span>
            </div>
        </div>
    `;
}

function getCountLabel(total) {
    if (total === 0) return "Ingen boligsøgende roomies fundet";
    if (total === 1) return "1 boligsøgende roomie";
    return `${formatNumber(total)} boligsøgende roomies`;
}

function buildImageUrl(imageName) {
    const value = String(imageName || "");
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    return `${s3Url}/${value.replace(/^\/+/, "")}`;
}

function normalizeAreaIds(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(id => String(id))
        .filter(id => AREA_LOOKUP.has(id));
}

function formatAreaLabel(areaId) {
    return AREA_LOOKUP.get(String(areaId))?.label || String(areaId);
}

function normalizeStringList(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return value ? [String(value)] : [];
}

function getFirstName(fullName) {
    return String(fullName || "").trim().split(/\s+/)[0] || "Roomie";
}

function capitalizeFirst(value) {
    if (!value) return null;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseInteger(value) {
    const parsed = Number.parseInt(String(value || "").replace(/\./g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value) {
    return new Intl.NumberFormat("da-DK").format(Number(value || 0));
}

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value ?? "");
    return element.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
}
