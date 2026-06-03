import {authFetch} from "../auth/auth.js";
import {postalData, searchAreaGroups, areaAutocompleteOptions, cityData} from "../config/hardcoded_data.js";
import {
    displayErrorMessage,
    parseFormattedInteger, displaySuccessMessage, currentUser, favoriteHousing, decodeJwt, getShortenedAddress,
    getHousingById
} from "../utils.js";
import {fetchAllAgents} from "../agent/agent.js";
import {getCurrentView, showView} from "../views/viewManager.js";
import {displayHousingsOnMap} from "../housing_map/housing_map.js";
import {basePath, s3Url} from "../config/config.js";
import {
    generateCriteriaForm,
    getCriteriaValues,
    hasConfiguredCriteria,
    hasRequiredExchangeCriteria,
    EXCHANGE_CRITERIA_REQUIRED_MESSAGE,
    populateCriteriaForm, setupAreaTagLogic,
    setupCriteriaCurrencyFormatters,
} from "../components/criteria_form.js";

let page = 0;
const LIST_PAGE_SIZE = 28;
let size = LIST_PAGE_SIZE;
let sharedSearchComponent = null;
let activeHousingView = 'list';
// Cache for autocomplete suggestions
let searchSuggestions = [];
let selectedSearchAreaGroupId = '';
let selectedSearchAreaFilters = [];
let isUserFiltering = false;
// Saved pagination state – used to restore all loaded pages when returning to the list view
let savedListPage = -1;
let scheduledSearchFrame = null;
let scheduledSearchArgs = null;
let housingDataVersion = 0;
let listResultsDirty = true;
let cachedListResultsSignature = null;
let cachedFilteredHousings = [];
let cachedBytteMatchLooseMatchStartIndex = -1;
let renderedListSignature = null;

const BYTTEMATCH_CRITERIA_MODAL_ID = 'byttematch-criteria-modal';
const BYTTEMATCH_CRITERIA_FORM_SUFFIX = 'byttematch-modal';
const LIST_BOLIGMATCH_CTA_DISMISSED_UNTIL_KEY = 'list_boligmatch_cta_dismissed_until_v1';
const LIST_BOLIGMATCH_CTA_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_BOLIGMATCH_FOMO_DISMISSED_UNTIL_KEY = 'list_boligmatch_fomo_dismissed_until_v1';
const LIST_BOLIGMATCH_FOMO_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_BOLIGMATCH_FOMO_MIN_RESULTS = 8;
const LIST_BOLIGMATCH_FOMO_INSERT_INDEX = 4;
const STOR_KOEBENHAVN_AREA_GROUP_ID = '10002500';
const STOR_KOEBENHAVN_POSTAL_RANGE = { min: 1000, max: 2999 };
const DEFAULT_FEED_SALE_SLOTS_BEFORE_EXCHANGE = 2;
const DEFAULT_FEED_EXCHANGE_SLOTS_AFTER_SALE = 2;

// BytteMatch mode state
let byteMatchMode = false;
let userSwapHousing = null;

const priceRanges = [
    { label: 'Pris', value: 'all', min: null, max: null },
    { label: 'Under 500.000 kr.', value: 'under-500000', min: null, max: 500_000 },
    { label: '500.000 - 1.000.000 kr.', value: '500000-1000000', min: 500_000, max: 1_000_000 },
    { label: '1.000.000 - 2.000.000 kr.', value: '1000000-2000000', min: 1_000_000, max: 2_000_000 },
    { label: '2.000.000 - 3.000.000 kr.', value: '2000000-3000000', min: 2_000_000, max: 3_000_000 },
    { label: '3.000.000 - 5.000.000 kr.', value: '3000000-5000000', min: 3_000_000, max: 5_000_000 },
    { label: '5.000.000 - 7.500.000 kr.', value: '5000000-7500000', min: 5_000_000, max: 7_500_000 },
    { label: '7.500.000 - 10.000.000 kr.', value: '7500000-10000000', min: 7_500_000, max: 10_000_000 },
    { label: 'Over 10.000.000 kr.', value: 'over-10000000', min: 10_000_000, max: null },
];

const roomRanges = [
    { label: 'Værelser', value: 'all', min: null, max: null },
    { label: '1-2 værelser', value: '1-2', min: 1, max: 2 },
    { label: '3-4 værelser', value: '3-4', min: 3, max: 4 },
    { label: '5+ værelser', value: '5+', min: 5, max: null },
];

const monthlyFeeRanges = [
    { label: 'Boligafgift', value: 'all', min: null, max: null },
    { label: 'Under 3.000 kr.', value: 'under-3000', min: null, max: 3_000 },
    { label: '3.000 - 5.000 kr.', value: '3000-5000', min: 3_000, max: 5_000 },
    { label: '5.000 - 7.500 kr.', value: '5000-7500', min: 5_000, max: 7_500 },
    { label: '7.500 - 10.000 kr.', value: '7500-10000', min: 7_500, max: 10_000 },
    { label: 'Over 10.000 kr.', value: 'over-10000', min: 10_000, max: null },
];

const squareMeterRanges = [
    { label: 'Størrelse', value: 'all', min: null, max: null },
    { label: 'Under 50 m²', value: 'under-50', min: null, max: 50 },
    { label: '50 - 75 m²', value: '50-75', min: 50, max: 75 },
    { label: '75 - 100 m²', value: '75-100', min: 75, max: 100 },
    { label: '100 - 125 m²', value: '100-125', min: 100, max: 125 },
    { label: 'Over 125 m²', value: 'over-125', min: 125, max: null },
];

const areaGroupLabelById = Object.fromEntries(
    (searchAreaGroups || []).map(group => [String(group.id), group.label])
);

const areaGroupRangeById = Object.fromEntries(
    (searchAreaGroups || [])
        .map(group => {
            const id = String(group.id || '').trim();
            const range = parseAreaGroupRange(id);
            return range ? [id, range] : null;
        })
        .filter(Boolean)
);

const MAX_VISIBLE_SWAP_AREA_CHIPS = 1;

// --- UTILS ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function scheduleSearchData(housingView = activeHousingView, append = false, housingIds = null) {
    if (!append || housingView !== 'list') {
        markListResultsDirty();
    }

    scheduledSearchArgs = { housingView, append, housingIds };

    if (scheduledSearchFrame !== null) {
        return;
    }

    scheduledSearchFrame = requestAnimationFrame(() => {
        const args = scheduledSearchArgs;
        scheduledSearchArgs = null;
        scheduledSearchFrame = null;

        sendSearchData(args.housingView, args.append, args.housingIds);
    });
}

function markListResultsDirty() {
    listResultsDirty = true;
    cachedListResultsSignature = null;
    cachedFilteredHousings = [];
    cachedBytteMatchLooseMatchStartIndex = -1;
    renderedListSignature = null;
}

function cacheListResults(filteredHousings, bytteMatchLooseMatchStartIndex, listResultsSignature) {
    cachedFilteredHousings = filteredHousings;
    cachedBytteMatchLooseMatchStartIndex = bytteMatchLooseMatchStartIndex;
    cachedListResultsSignature = listResultsSignature;
    listResultsDirty = false;
}

function getListResultsSignature(filters, housingIds = null) {
    const user = decodeJwt();

    return JSON.stringify({
        housingDataVersion,
        userSub: user?.sub || null,
        favorites: currentUser?.favorite_advertisements || [],
        filters,
        byteMatchMode,
        userSwapHousingId: userSwapHousing?._id || null,
        userSwapHousingUpdated: userSwapHousing?.updated || null,
        userSwapCriteria: userSwapHousing?.exchange_criteria || null,
        housingIds: housingIds || null
    });
}

function getRenderedListSignature(resultsSignature) {
    return JSON.stringify({
        resultsSignature,
        page,
        size
    });
}

function hasReusableRenderedList() {
    const listingsContainer = document.getElementById('listings-container');
    const noResultsContainer = document.getElementById('no-results');
    if (!listingsContainer) return false;
    if (listResultsDirty || isUserFiltering || !renderedListSignature) return false;

    const filters = buildFilters();
    const resultsSignature = getListResultsSignature(filters);
    const expectedRenderedSignature = getRenderedListSignature(resultsSignature);
    if (renderedListSignature !== expectedRenderedSignature) return false;

    const hasRenderedCards = listingsContainer.querySelector('[data-scroll-anchor-id]') !== null;
    const hasRenderedEmptyState = noResultsContainer?.style.display === 'flex';
    return hasRenderedCards || hasRenderedEmptyState;
}

function getCachedListResults(filters, allHousings, housingIds = null) {
    const listResultsSignature = !housingIds
        ? getListResultsSignature(filters)
        : null;
    const canUseCachedListResults = !housingIds
        && !listResultsDirty
        && cachedListResultsSignature === listResultsSignature
        && Array.isArray(cachedFilteredHousings);

    if (canUseCachedListResults) {
        return {
            filteredHousings: cachedFilteredHousings,
            bytteMatchLooseMatchStartIndex: cachedBytteMatchLooseMatchStartIndex,
            listResultsSignature,
        };
    }

    const filteredHousings = sortHousings(filterHousings(allHousings, filters), filters.sort, filters.housingType);
    const bytteMatchLooseMatchStartIndex = byteMatchMode
        ? filteredHousings.findIndex(housing => !hasConfiguredExchangeCriteria(housing.exchange_criteria))
        : -1;

    if (!housingIds) {
        cacheListResults(filteredHousings, bytteMatchLooseMatchStartIndex, listResultsSignature);
    }

    return {
        filteredHousings,
        bytteMatchLooseMatchStartIndex,
        listResultsSignature
    };
}

function warmDefaultListResultsCache() {
    if (!Array.isArray(window.housings) || window.housings.length === 0) return;
    if (byteMatchMode || isUserFiltering || savedListPage > 0) return;

    const filters = buildFilters();
    getCachedListResults(filters, getAllHousings());
}

function parseAreaGroupRange(areaId) {
    const id = String(areaId || '').trim();
    if (id === STOR_KOEBENHAVN_AREA_GROUP_ID) {
        return {...STOR_KOEBENHAVN_POSTAL_RANGE};
    }

    if (!/^\d{8}$/.test(id)) return null;

    const from = parseInt(id.slice(0, 4), 10);
    const to = parseInt(id.slice(4), 10);
    if (Number.isNaN(from) || Number.isNaN(to)) return null;

    return { min: Math.min(from, to), max: Math.max(from, to) };
}

function getSelectedSearchAreaRange() {
    if (!selectedSearchAreaGroupId) return null;
    return areaGroupRangeById[selectedSearchAreaGroupId] || parseAreaGroupRange(selectedSearchAreaGroupId);
}

function getAreaFilterRange(areaFilter) {
    if (!areaFilter) return null;

    if (areaFilter.type === 'group') {
        return areaGroupRangeById[String(areaFilter.id)] || parseAreaGroupRange(areaFilter.id);
    }

    const postal = parseInt(areaFilter.id, 10);
    if (Number.isNaN(postal)) return null;
    return {min: postal, max: postal};
}

function getSelectedSearchAreaFilters() {
    return selectedSearchAreaFilters
        .map((filter) => ({
            ...filter,
            range: getAreaFilterRange(filter)
        }))
        .filter((filter) => filter.range);
}

function matchesSelectedSearchAreas(postalNumber, selectedAreas) {
    if (!selectedAreas.length) return true;

    const postal = parseInt(postalNumber, 10);
    if (Number.isNaN(postal)) return false;

    return selectedAreas.some(({range}) => postal >= range.min && postal <= range.max);
}

function matchesByteExchangeCriteria(listing, criteria) {
    if (!criteria) return true;

    const price = listing.price || 0;
    const fee = listing.monthly_fee || 0;
    const sqm = listing.square_meters || 0;
    const rooms = listing.rooms || 0;

    if (criteria.price_to != null && price > criteria.price_to) return false;
    if (criteria.monthly_price_to != null && fee > criteria.monthly_price_to) return false;
    if (criteria.square_meters_from != null && sqm < criteria.square_meters_from) return false;
    if (criteria.square_meters_to != null && sqm > criteria.square_meters_to) return false;
    if (criteria.rooms_from != null && rooms < criteria.rooms_from) return false;
    if (criteria.rooms_to != null && rooms > criteria.rooms_to) return false;

    if (Array.isArray(criteria.areas) && criteria.areas.length > 0) {
        const postalNum = listing.postal_number != null ? parseInt(listing.postal_number, 10) : null;
        if (postalNum == null) return false;

        // Area group IDs encode a postal range as a single integer: MMMMXXXX
        // where MMMM is the 4-digit range start and XXXX is the range end.
        // e.g. 10001499 → 1000–1499, 15001799 → 1500–1799, 18002000 → 1800–2000
        // Note storkøbenhavn is a special case, it has id 2500 but we actually search all postal numbers in range 1000-2999
        const AREA_GROUPS = {
            [STOR_KOEBENHAVN_AREA_GROUP_ID]: [STOR_KOEBENHAVN_POSTAL_RANGE.min, STOR_KOEBENHAVN_POSTAL_RANGE.max],
            10001499: [1000, 1499],
            15001799: [1500, 1799],
            18002000: [1800, 2000],
        };

        const areaMatches = (areaId) => {
            const id = parseInt(areaId, 10);
            if (AREA_GROUPS[id]) {
                const [min, max] = AREA_GROUPS[id];
                return postalNum >= min && postalNum <= max;
            }
            // Plain 4-digit postal code
            return postalNum === id;
        };

        if (!criteria.areas.some(areaMatches)) return false;
    }

    return true;
}

export async function activateByteMatchMode() {
    const jwt = decodeJwt();
    if (!jwt) {
        userSwapHousing = null;
        return;
    }

    const all = getAllHousings();
    const candidates = all
        .filter(h => h?.created_by === jwt.sub && h?.exchange_only && !h?.deleted)
        .sort((a, b) => (b.created || 0) - (a.created || 0));

    userSwapHousing = candidates[0] || null;

    // Fallback for edge cases where cache isn't ready yet
    if (!userSwapHousing) {
        const maybe = await getHousingById(jwt.sub, 'created_by');
        userSwapHousing = maybe?.exchange_only ? maybe : null;
    }
}

function updateByteMatchToggleUI() {
    const btn = document.getElementById('byttematch-toggle');
    if (!btn) return;

    if (byteMatchMode) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="fa-solid fa-right-left"></i><span>Find gensidige BytteMatch</span><i class="fa-solid fa-check ms-1" style="font-size:0.7em;opacity:0.85;"></i>';
        return;
    }

    btn.classList.remove('active');
    btn.innerHTML = '<i class="fa-solid fa-right-left"></i><span>Find gensidige BytteMatch</span>';
}

function updateByteMatchGuidance(housingView = activeHousingView) {
    const el = document.getElementById('mutual-bytte-hint');
    if (!el) return;

    // Show only on list view, with active BytteMatch and valid criteria.
    const shouldShow = byteMatchMode && housingView === 'list' && !shouldShowByteMatchEmptyState();
    el.classList.toggle('d-none', !shouldShow);
}

function isListBoligMatchCtaDismissed() {
    const dismissedUntil = Number(localStorage.getItem(LIST_BOLIGMATCH_CTA_DISMISSED_UNTIL_KEY));

    if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) {
        return true;
    }

    localStorage.removeItem(LIST_BOLIGMATCH_CTA_DISMISSED_UNTIL_KEY);
    return false;
}

function isListBoligMatchFomoDismissed() {
    const dismissedUntil = Number(localStorage.getItem(LIST_BOLIGMATCH_FOMO_DISMISSED_UNTIL_KEY));

    if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) {
        return true;
    }

    localStorage.removeItem(LIST_BOLIGMATCH_FOMO_DISMISSED_UNTIL_KEY);
    return false;
}

function dismissListBoligMatchFomoCard() {
    localStorage.setItem(
        LIST_BOLIGMATCH_FOMO_DISMISSED_UNTIL_KEY,
        String(Date.now() + LIST_BOLIGMATCH_FOMO_DISMISS_MS)
    );

    document.getElementById('list-boligmatch-fomo-card')?.remove();
}

function setListBoligMatchCtaVisible(visible) {
    const cta = document.getElementById('list-boligmatch-cta');
    if (!cta) return;

    cta.classList.toggle('d-none', !visible);

    if (visible) {
        window.listBoligMatchCtaVisible = true;
        document.getElementById('agent-promo-card')?.remove();
    } else {
        window.listBoligMatchCtaVisible = false;
    }
}

async function updateListBoligMatchCta(housingView = activeHousingView) {
    const cta = document.getElementById('list-boligmatch-cta');
    if (!cta) return;

    const user = decodeJwt();
    if (housingView !== 'list' || !user || isListBoligMatchCtaDismissed()) {
        setListBoligMatchCtaVisible(false);
        return;
    }

    if (!Array.isArray(window.agents)) {
        await fetchAllAgents();
    }

    if (housingView !== activeHousingView || housingView !== 'list' || isListBoligMatchCtaDismissed()) {
        setListBoligMatchCtaVisible(false);
        return;
    }

    const shouldShow = Array.isArray(window.agents) && window.agents.length === 0;
    setListBoligMatchCtaVisible(shouldShow);
}

function setupListBoligMatchCta() {
    const cta = document.getElementById('list-boligmatch-cta');
    const closeBtn = document.getElementById('close-list-boligmatch-cta');
    const createBtn = document.getElementById('create-list-boligmatch-cta');

    if (!cta || cta.dataset.bound) return;
    cta.dataset.bound = '1';

    closeBtn?.addEventListener('click', () => {
        localStorage.setItem(LIST_BOLIGMATCH_CTA_DISMISSED_UNTIL_KEY, String(Date.now() + LIST_BOLIGMATCH_CTA_DISMISS_MS));
        localStorage.setItem('agent_promo_dismissed_v1', 'true');
        setListBoligMatchCtaVisible(false);
    });

    createBtn?.addEventListener('click', () => {
        setListBoligMatchCtaVisible(false);
        showView('agent_create');
    });
}

function generateByteMatchEmptyHtml(isLoggedIn) {
    if (!isLoggedIn) {
        return `
        <div class="col-12">
            <div class="byttematch-empty-state">
                <div class="bytte-empty-icon mb-3"><i class="fa-solid fa-right-left fa-2x text-primary"></i></div>
                <h5 class="fw-bold mb-2" style="color: var(--company-dark);">Log ind for at se BytteMatch</h5>
                <p class="text-muted mb-4 small">Log ind og opret en bytteannonce for at se boliger, der matcher dine byttekriterier.</p>
                <button class="btn btn-primary rounded-pill px-4 py-2 fw-semibold shadow-sm" onclick="showView('login')">
                    <i class="fa-solid fa-arrow-right-to-bracket me-2"></i>Log ind
                </button>
            </div>
        </div>`;
    }

    return `
    <div class="col-12">
    <div class="byttematch-empty-state">
        <div class="bytte-empty-icon mb-3"><i class="fa-solid fa-right-left fa-2x text-primary"></i></div>
        <h5 class="fw-bold mb-2" style="color: var(--company-dark);">Find dit perfekte BytteMatch 🤝</h5>
        <p class="text-muted mb-2 small mx-auto" style="max-width: 440px;">
            For at se personlige BytteMatch skal du have en aktiv bytteannonce
            hvor du indtaster hvad du leder efter.
        </p>
        <button class="btn btn-primary rounded-pill px-4 py-2 fw-semibold shadow-sm" onclick="showView('create')">
            <i class="fa-solid fa-plus me-2"></i>Opret bytteannonce
        </button>
    </div>
</div>`;
}

function generateSearchNoResultsHtml() {
    return `
        <div class="byttematch-empty-state mx-auto" style="max-width: 520px;">
            <div class="bytte-empty-icon mb-3"><i class="fa-solid fa-bell fa-2x text-primary"></i></div>
            <h5 class="fw-bold mb-2" style="color: var(--company-dark);">47 boliger fundet den sidste uge</h5>
            <p class="text-muted mb-4 small mx-auto" style="max-width: 420px;">
                Opret en BoligMatch så du får besked med det samme.
            </p>
            <button class="btn btn-primary rounded-pill px-4 py-2 fw-semibold shadow-sm" onclick="showView('agent_create')">
                <i class="fa-solid fa-bell me-2"></i>Opret BoligMatch
            </button>
        </div>`;
}

function buildSwapCriteriaMiniHtml(criteria) {
    if (!criteria) return '';

    const chips = [];

    // Updated 'fa-door-open' to 'fa-bed' to match the rooms icon on the rest of the card
    if (criteria.square_meters_from != null) chips.push(`<i class="fa-solid fa-house text-secondary opacity-75 me-1"></i>Min. ${criteria.square_meters_from} m²`);
    if (criteria.rooms_from != null) chips.push(`<i class="fa-solid fa-bed text-secondary opacity-75 me-1"></i>Min. ${criteria.rooms_from} vær.`);
    if (criteria.monthly_price_to != null) chips.push(`<i class="fa-solid fa-coins text-secondary opacity-75 me-1"></i>Max ${criteria.monthly_price_to.toLocaleString('da-DK')} /md`);
    if (criteria.price_to != null) chips.push(`<i class="fa-solid fa-tag text-secondary opacity-75 me-1"></i>Max ${criteria.price_to.toLocaleString('da-DK')} kr`);

    if (chips.length === 0) return '';

    // Smart Truncation (Prevent UI flooding on mobile)
    const MAX_CHIPS = 3;
    let visibleChips = chips.slice(0, MAX_CHIPS);
    let hiddenCount = chips.length - MAX_CHIPS;

    let chipsHtml = visibleChips.map(c => `<span class="swap-criteria-chip">${c}</span>`).join('');

    if (hiddenCount > 0) {
        // Add a muted 'more' chip
        chipsHtml += `<span class="swap-criteria-chip" style="background: transparent; border-color: transparent; color: var(--bs-primary); padding-left: 0.2rem;">+${hiddenCount} mere</span>`;
    }

    return `
        <div class="swap-criteria-mini mt-3">
            <div class="swap-criteria-header">
                <div class="swap-criteria-icon">
                    <i class="fa-solid fa-magnifying-glass opacity-75"></i>
                </div>
                <div class="swap-criteria-mini-label">Sælger søger</div>
            </div>
            <div class="d-flex flex-wrap gap-2">
                ${chipsHtml}
            </div>
        </div>`;
}

function hasConfiguredExchangeCriteria(criteria) {
    return hasConfiguredCriteria(criteria);
}

function hasValidExchangeCriteria(criteria) {
    return hasRequiredExchangeCriteria(criteria);
}

function shouldShowByteMatchEmptyState() {
    if (!byteMatchMode) return false;
    if (!userSwapHousing) return true;
    return !hasValidExchangeCriteria(userSwapHousing.exchange_criteria);
}

function ensureBytteCriteriaModal() {
    let modalEl = document.getElementById(BYTTEMATCH_CRITERIA_MODAL_ID);
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.className = 'modal fade';
    modalEl.id = BYTTEMATCH_CRITERIA_MODAL_ID;
    modalEl.tabIndex = -1;
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.innerHTML = `
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content border-0 rounded-4 shadow-sm">
                <div class="modal-header border-0 pb-0">
                    <h5 class="modal-title fw-bold" style="color: var(--company-dark);">
                        <i class="fa-solid fa-right-left me-2 text-primary"></i>Opdater dine bytte ønsker
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body pt-3">
                    ${generateCriteriaForm('Exchange', BYTTEMATCH_CRITERIA_FORM_SUFFIX)}
                </div>
                <div class="modal-footer border-0 pt-0">
                    <button type="button" class="btn btn-light rounded-pill px-4" data-bs-dismiss="modal">Annuller</button>
                    <button type="button" id="save-byttematch-criteria-btn" class="btn btn-primary rounded-pill px-4">
                        <i class="fa-solid fa-check me-2"></i>Gem kriterier
                    </button>
                </div>
            </div>
        </div>
    `;
    setupAreaTagLogic('Exchange');
    setupCriteriaCurrencyFormatters('Exchange');

    document.body.appendChild(modalEl);

    setupAreaTagLogic(BYTTEMATCH_CRITERIA_FORM_SUFFIX);
    setupCriteriaCurrencyFormatters(BYTTEMATCH_CRITERIA_FORM_SUFFIX);

    const saveBtn = modalEl.querySelector('#save-byttematch-criteria-btn');
    if (saveBtn && !saveBtn.dataset.bound) {
        saveBtn.dataset.bound = '1';
        saveBtn.addEventListener('click', saveBytteCriteriaFromModal);
    }

    return modalEl;
}

function openBytteCriteriaModal() {
    if (!decodeJwt()) {
        showView('login');
        return;
    }

    if (!userSwapHousing || !userSwapHousing._id) {
        displayErrorMessage('Opret først en bytteannonce, før du kan redigere kriterier.');
        return;
    }

    const modalEl = ensureBytteCriteriaModal();
    populateCriteriaForm(userSwapHousing.exchange_criteria || {}, BYTTEMATCH_CRITERIA_FORM_SUFFIX);
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

function buildBytteAdvertisementPayload(baseHousing, criteria) {
    return {
        title: baseHousing.title || '',
        description: baseHousing.description || '',
        price: Number(baseHousing.price) || 0,
        monthly_fee: Number(baseHousing.monthly_fee) || 0,
        improvements_price: Number(baseHousing.improvements_price) || 0,
        square_meters: Number(baseHousing.square_meters) || 0,
        rooms: Number(baseHousing.rooms) || 0,
        construction_year: baseHousing.construction_year ?? null,
        energy_label: baseHousing.energy_label ?? null,
        datafordeler_id: baseHousing.datafordeler_id ?? null,
        postal_name: baseHousing.postal_name ?? null,
        street_name: baseHousing.street_name ?? null,
        house_number: baseHousing.house_number ?? null,
        floor: baseHousing.floor ?? null,
        floor_side: baseHousing.floor_side ?? null,
        city: baseHousing.city ?? null,
        postal_number: baseHousing.postal_number ?? null,
        address: baseHousing.address || '',
        location: baseHousing.location ?? null,
        pets_allowed: !!baseHousing.pets_allowed,
        balcony: !!baseHousing.balcony,
        parking_included: !!baseHousing.parking_included,
        elevator: !!baseHousing.elevator,
        located_at_top: !!baseHousing.located_at_top,
        smoke_free: !!baseHousing.smoke_free,
        images: Array.isArray(baseHousing.images)
            ? baseHousing.images.map(img => ({
                name: img.name,
                thumbnail_name: img.thumbnail_name
            }))
            : [],
        exchange_only: true,
        exchange_criteria: criteria,
        reserved: !!baseHousing.reserved,
        sold: !!baseHousing.sold,
        marketing_package: baseHousing.marketing_package || 'free'
    };
}

async function saveBytteCriteriaFromModal() {
    if (!userSwapHousing || !userSwapHousing._id) {
        displayErrorMessage('Kunne ikke finde din bytteannonce. Prøv igen.');
        return;
    }

    const saveBtn = document.getElementById('save-byttematch-criteria-btn');
    const originalButtonHtml = saveBtn ? saveBtn.innerHTML : '';

    const criteria = getCriteriaValues(BYTTEMATCH_CRITERIA_FORM_SUFFIX);
    if (!hasValidExchangeCriteria(criteria)) {
        displayErrorMessage(EXCHANGE_CRITERIA_REQUIRED_MESSAGE, 12000);
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Gemmer...';
    }

    try {
        const payload = buildBytteAdvertisementPayload(userSwapHousing, criteria);

        // Use the same update strategy as housing_create.js: POST /advertisement
        const response = await authFetch('/advertisement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            let errorMessage = 'Kunne ikke gemme kriterier. Prøv igen.';
            try {
                const body = await response.json();
                if (body?.detail) errorMessage = body.detail;
            } catch (_) {
                // Fallback message.
            }
            displayErrorMessage(errorMessage);
            return;
        }

        let savedHousingId = userSwapHousing._id;
        const responseBody = await response.json();

        if (typeof responseBody === 'string') {
            savedHousingId = responseBody;
        } else if (responseBody && typeof responseBody === 'object' && responseBody._id) {
            savedHousingId = responseBody._id;
        }

        // Re-fetch full model exactly like create flow does.
        let updatedHousing = {
            ...userSwapHousing,
            exchange_only: true,
            exchange_criteria: criteria,
            updated: Math.floor(Date.now() / 1000)
        };

        const reloadResponse = await authFetch(`/advertisement/${savedHousingId}`);
        if (reloadResponse.ok) {
            updatedHousing = await reloadResponse.json();
        }

        userSwapHousing = updatedHousing;
        updateLocalHousing(updatedHousing);

        const modalEl = document.getElementById(BYTTEMATCH_CRITERIA_MODAL_ID);
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.hide();
        }

        displaySuccessMessage('Dine bytte ønsker er nu opdateret');
        isUserFiltering = true;
        scheduleSearchData(activeHousingView);
    } catch (error) {
        console.error('Failed to save BytteMatch criteria:', error);
        displayErrorMessage('Der opstod en fejl. Prøv igen.');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalButtonHtml;
        }
    }
}

function buildSelectOptions(options) {
    return options.map(option => `<option value="${option.value}">${option.label}</option>`).join('');
}

function getRangeFromSelect(selectEl, ranges) {
    if (!selectEl) return { min: null, max: null };
    return ranges.find(range => range.value === selectEl.value) || { min: null, max: null };
}

function filterByRange(value, { min, max }) {
    if (min !== null && value < min) return false;
    if (max !== null && value > max) return false;
    return true;
}

function enrichHousingSearchCache(housing) {
    if (!housing || typeof housing !== 'object') return housing;

    housing._search = {
        postalNumber: String(housing.postal_number || ""),
        postalNameNorm: normalizePostalName(getHousingPostalName(housing)),
        cityNorm: normalizePostalName(housing?.city || ""),
        streetLower: String(housing.street_name || "").toLowerCase(),
        cityLower: String(housing.city || "").toLowerCase(),
        postalLower: String(housing.postal_name || "").toLowerCase(),
    };

    return housing;
}

function enrichHousingsSearchCache(housings) {
    if (!Array.isArray(housings)) return [];
    housings.forEach(enrichHousingSearchCache);
    return housings;
}

function getAllHousings() {
    return window.housings || [];
}

function getFilterElements() {
    return {
        text: document.getElementById('housing-list-search'),
        price: document.getElementById('price-filter'),
        rooms: document.getElementById('rooms-filter'),
        monthly: document.getElementById('monthly-fee-filter'),
        sqm: document.getElementById('square-meters-filter'),
        balcony: document.getElementById('filter-balcony'),
        petsAllowed: document.getElementById('filter-pets-allowed'),
        rogfri: document.getElementById('filter-rogfri'),
        favorites: document.getElementById('filter-favorites'),
        downsize: document.getElementById('filter-downsize'), // NYT
        upsize: document.getElementById('filter-upsize'), // NYT
        typeRadios: document.querySelectorAll('input[name="filter-type"]'),
        sort: document.getElementById('sort-options'),
    };
}

function getRawFilterValues() {
    const filters = getFilterElements();
    const selectedType = Array.from(filters.typeRadios || []).find(r => r.checked)?.value || 'all';

    return {
        text: filters.text?.value?.trim() || '',
        selectedAreaGroupId: selectedSearchAreaGroupId,
        selectedAreaFilters: getSelectedSearchAreaFilters(),
        price: filters.price?.value || 'all',
        rooms: filters.rooms?.value || 'all',
        monthly: filters.monthly?.value || 'all',
        sqm: filters.sqm?.value || 'all',
        balcony: filters.balcony?.checked || false,
        petsAllowed: filters.petsAllowed?.checked || false,
        rogfri: filters.rogfri?.checked || false,
        favorites: filters.favorites?.checked || false,
        downsize: filters.downsize?.checked || false, // NYT
        upsize: filters.upsize?.checked || false, // NYT
        housingType: selectedType,
        sort: filters.sort?.value || 'created-desc',
    };
}

function buildFilters() {
    const filters = getFilterElements();
    const raw = getRawFilterValues();

    return {
        text: raw.text,
        selectedAreaRange: getSelectedSearchAreaRange(),
        selectedAreaFilters: raw.selectedAreaFilters,
        priceRange: getRangeFromSelect(filters.price, priceRanges),
        roomRange: getRangeFromSelect(filters.rooms, roomRanges),
        monthlyFeeRange: getRangeFromSelect(filters.monthly, monthlyFeeRanges),
        squareMeterRange: getRangeFromSelect(filters.sqm, squareMeterRanges),
        onlyBalcony: raw.balcony,
        onlyPetsAllowed: raw.petsAllowed,
        onlyRogfri: raw.rogfri,
        onlyFavorites: raw.favorites,
        onlyDownsize: raw.downsize, // NYT
        onlyUpsize: raw.upsize, // NYT
        housingType: raw.housingType,
        sort: raw.sort,
    };
}

function clearAllFilters() {
    const filters = getFilterElements();

    if (byteMatchMode) {
        byteMatchMode = false;
        userSwapHousing = null;
        updateByteMatchToggleUI();
    }

    if (filters.text) filters.text.value = '';
    selectedSearchAreaGroupId = '';
    selectedSearchAreaFilters = [];
    renderSelectedSearchAreaChips();
    if (filters.price) filters.price.value = 'all';
    if (filters.rooms) filters.rooms.value = 'all';
    if (filters.monthly) filters.monthly.value = 'all';
    if (filters.sqm) filters.sqm.value = 'all';

    if (filters.balcony) filters.balcony.checked = false;
    if (filters.petsAllowed) filters.petsAllowed.checked = false;
    if (filters.rogfri) filters.rogfri.checked = false;
    if (filters.favorites) filters.favorites.checked = false;
    if (filters.downsize) filters.downsize.checked = false; // NYT
    if (filters.upsize) filters.upsize.checked = false; // NYT

    if (filters.typeRadios) {
        const defaultRadio = Array.from(filters.typeRadios).find(r => r.value === 'all');
        if (defaultRadio) defaultRadio.checked = true;
    }

    if (filters.sort) filters.sort.value = 'created-desc';

    updateClearFiltersButton();
    isUserFiltering = true;
    scheduleSearchData(activeHousingView);
}


function hasAnyActiveFilters() {
    const raw = getRawFilterValues();
    return (
        byteMatchMode ||
        raw.text.length > 0 ||
        raw.selectedAreaFilters.length > 0 ||
        raw.price !== 'all' ||
        raw.rooms !== 'all' ||
        raw.monthly !== 'all' ||
        raw.sqm !== 'all' ||
        raw.balcony || raw.petsAllowed ||
        raw.rogfri ||
        raw.favorites ||
        raw.downsize || raw.upsize || // NYT
        raw.housingType !== 'all' ||
        (activeHousingView === 'list' && raw.sort !== 'created-desc')
    );
}


/**
 * Sorts housings.
 * PRIORITY 0: The user's own listings are always shown at the absolute top.
 * PRIORITY 1: BytteMatch mode stays exchange-focused and does not use feed balancing.
 * PRIORITY 2: Explicit "Kun salg" / "Kun bytte" filters stay focused on that type.
 * PRIORITY 3: Default "Salg & Bytte" feed blends sale and exchange lanes so buyers
 *             do not land on a bytte-heavy first page. Paid listings still rank at
 *             the top of their own sale/bytte lane before the lanes are blended.
 * @param {Array} housings - The array of housing objects to sort.
 * @param {String} sortValue - The selected sort criteria (e.g., 'created-desc', 'price-asc').
 * @param {String} housingType - The active type filter: 'all', 'sale', or 'exchange'.
 * @returns {Array} A new array with the sorted housings.
 */
function sortHousings(housings, sortValue, housingType = 'all') {
    if (!housings || !Array.isArray(housings)) return [];

    // Hent den nuværende brugers ID (sub) fra deres JWT-token
    const jwt = decodeJwt();
    const userSub = jwt ? jwt.sub : null;

    // --- 0. Adskil brugerens egne annoncer for at placere dem øverst ---
    const userHousings = userSub ? housings.filter(h => h.created_by === userSub) : [];
    const otherHousings = userSub ? housings.filter(h => h.created_by !== userSub) : housings;

    // Sorter brugerens egne annoncer indbyrdes, så den nyeste altid vises først
    userHousings.sort((a, b) => (b.created || 0) - (a.created || 0));

    // --- BytteMatch mode: prioritise listings with configured criteria ---
    if (byteMatchMode) {
        otherHousings.sort((a, b) => {
            const aHasCriteria = hasConfiguredExchangeCriteria(a.exchange_criteria) ? 1 : 0;
            const bHasCriteria = hasConfiguredExchangeCriteria(b.exchange_criteria) ? 1 : 0;
            if (aHasCriteria !== bHasCriteria) return bHasCriteria - aHasCriteria;

            // Within same group, newest first
            return (b.created || 0) - (a.created || 0);
        });
        return [...userHousings, ...otherHousings];
    }

    const [field, direction] = (sortValue || 'created-desc').split('-');

    const compareBySelectedSort = (a, b) => {
        const aVal = a[field];
        const bVal = b[field];

        if (aVal === undefined || aVal === null) return 1;
        if (bVal === undefined || bVal === null) return -1;

        if (typeof aVal === 'string' || typeof bVal === 'string') {
            return direction === 'asc'
                ? String(aVal).localeCompare(String(bVal), 'da')
                : String(bVal).localeCompare(String(aVal), 'da');
        }

        return direction === 'asc' ? aVal - bVal : bVal - aVal;
    };

    const sortLane = (items) => [...items].sort((a, b) => {
        const aPaid = !!a.marketing_paid;
        const bPaid = !!b.marketing_paid;
        if (aPaid !== bPaid) return aPaid ? -1 : 1;

        // Keep sold/reserved visible, but do not let unavailable free listings
        // dominate the buyer-focused feed before active listings.
        const aUnavailable = !!(a.sold || a.reserved);
        const bUnavailable = !!(b.sold || b.reserved);
        if (aUnavailable !== bUnavailable) return aUnavailable ? 1 : -1;

        return compareBySelectedSort(a, b);
    });

    const saleLane = sortLane(otherHousings.filter(h => !h.exchange_only));
    const exchangeLane = sortLane(otherHousings.filter(h => h.exchange_only));

    if (housingType !== 'all') {
        return [...userHousings, ...sortLane(otherHousings)];
    }

    const blendedHousings = [];
    let saleIndex = 0;
    let exchangeIndex = 0;

    while (saleIndex < saleLane.length || exchangeIndex < exchangeLane.length) {
        for (
            let i = 0;
            i < DEFAULT_FEED_SALE_SLOTS_BEFORE_EXCHANGE && saleIndex < saleLane.length;
            i += 1
        ) {
            blendedHousings.push(saleLane[saleIndex]);
            saleIndex += 1;
        }

        for (
            let i = 0;
            i < DEFAULT_FEED_EXCHANGE_SLOTS_AFTER_SALE && exchangeIndex < exchangeLane.length;
            i += 1
        ) {
            blendedHousings.push(exchangeLane[exchangeIndex]);
            exchangeIndex += 1;
        }

        if (saleIndex >= saleLane.length && exchangeIndex < exchangeLane.length) {
            blendedHousings.push(...exchangeLane.slice(exchangeIndex));
            break;
        }
    }

    return [...userHousings, ...blendedHousings];
}



function filterHousings(housings, filters) {
    const rawText = filters.text || '';
    const query = rawText.trim().toLowerCase();
    const selectedAreaRange = filters.selectedAreaRange;
    const selectedAreaFilters = filters.selectedAreaFilters || [];

    // Tjek om soegeteksten indeholder et postnummer-spaend (f.eks. "1000-1499").
    const rangeMatch = rawText.match(/(\d{4})\s*-\s*(\d{4})/);
    const postalCodeQuery = !rangeMatch ? rawText.match(/\d+/)?.[0] : null;

    const postalNameNorm = normalizePostalName(rawText);
    const isExactPlaceName = rawText.length > 1 && POSTAL_NAME_NORM_SET.has(postalNameNorm);

    const isPlaceMatch = (target, q) => {
        if (!target) return false;
        return target === q ||
            target.startsWith(q + " ") ||
            target.endsWith(" " + q) ||
            target.includes(" " + q + " ");
    };

    return housings.filter((housing) => {
        const search = housing._search || enrichHousingSearchCache(housing)._search;
        const p = parseInt(search.postalNumber, 10);

        if (selectedAreaFilters.length > 0 && !matchesSelectedSearchAreas(p, selectedAreaFilters)) {
            return false;
        }

        if (rawText) {
            if (selectedAreaFilters.length === 0 && selectedAreaRange) {
                if (isNaN(p) || p < selectedAreaRange.min || p > selectedAreaRange.max) return false;
            }
            // Haandtering af postnummer-spaend i soegetekst
            else if (rangeMatch) {
                const min = parseInt(rangeMatch[1], 10);
                const max = parseInt(rangeMatch[2], 10);
                if (isNaN(p) || p < min || p > max) return false;
            }
            // Håndtering af specifikt postnummer
            else if (postalCodeQuery) {
                if (!search.postalNumber.startsWith(postalCodeQuery)) return false;
            }
            // Håndtering af præcise bynavne
            else if (isExactPlaceName) {
                if (!isPlaceMatch(search.postalNameNorm, postalNameNorm) && !isPlaceMatch(search.cityNorm, postalNameNorm)) {
                    return false;
                }
            }
            // Håndtering af fritekst
            else {
                const streetMatch = search.streetLower.includes(query);
                const cityMatch = search.cityLower.includes(query);
                const postalMatch = search.postalLower.includes(query);
                if (query && !streetMatch && !cityMatch && !postalMatch) return false;
            }
        }

        if (!filterByRange(housing.price || 0, filters.priceRange)) return false;
        if (!filterByRange(housing.rooms || 0, filters.roomRange)) return false;
        if (!filterByRange(housing.monthly_fee || 0, filters.monthlyFeeRange)) return false;
        if (!filterByRange(housing.square_meters || 0, filters.squareMeterRange)) return false;

        if (filters.onlyBalcony && !housing.balcony) return false;
        if (filters.onlyPetsAllowed && !housing.pets_allowed) return false;
        if (filters.onlyFavorites && !isHousingFavorite(housing._id)) return false;

        if (filters.housingType === 'exchange' && !housing.exchange_only) return false;
        if (filters.housingType === 'sale' && housing.exchange_only) return false;

        if (byteMatchMode) {
            if (!housing.exchange_only) return false;
            if (userSwapHousing) {
                if (housing._id === userSwapHousing._id) return false;
                if (userSwapHousing.exchange_criteria &&
                    !matchesByteExchangeCriteria(housing, userSwapHousing.exchange_criteria)) {
                    return false;
                }
                if (housing.exchange_criteria &&
                    !matchesByteExchangeCriteria(userSwapHousing, housing.exchange_criteria)) {
                    return false;
                }
            }
        }

        return true;
    });
}

function updateClearFiltersButton(externalFilterActive = false) {
    const btn = document.getElementById('clear-filters');
    if (!btn) return;

    const active = hasAnyActiveFilters() || externalFilterActive;
    btn.classList.toggle('d-none', !active);
}

function prepareSearchSuggestions() {
    if (searchSuggestions.length > 0) return;

    const suggestions = [];
    const seen = new Set();

    (areaAutocompleteOptions || []).forEach((option) => {
        const id = String(option.id || '').trim();
        const type = option.type === 'group' ? 'group' : 'postal';
        const key = `${type}:${id}`;
        if (!id || seen.has(key)) return;

        seen.add(key);
        suggestions.push({
            id,
            type,
            label: option.label,
            icon: option.icon || 'fa-solid fa-location-dot',
            description: type === 'group' ? 'Søg i omrade' : 'Søg via postnummer',
            searchText: `${option.searchText || ''} ${option.label || ''}`.toLowerCase(),
        });
    });

    searchSuggestions = suggestions;
}

function getAreaFilterKey(item) {
    const type = item?.type === 'group' ? 'group' : 'postal';
    return `${type}:${String(item?.id || '').trim()}`;
}

function syncSelectedSearchAreaGroupId() {
    const groupSelections = selectedSearchAreaFilters.filter((filter) => filter.type === 'group');
    selectedSearchAreaGroupId = groupSelections.length === 1 && selectedSearchAreaFilters.length === 1
        ? String(groupSelections[0].id)
        : '';
}

function addSelectedSearchAreaFilter(item) {
    const id = String(item?.id || '').trim();
    if (!id) return;

    const type = item.type === 'group' ? 'group' : 'postal';
    const key = getAreaFilterKey({id, type});

    if (selectedSearchAreaFilters.some((filter) => getAreaFilterKey(filter) === key)) {
        return;
    }

    selectedSearchAreaFilters.push({
        id,
        type,
        label: item.label || id,
        icon: item.icon || (type === 'group' ? 'fa-solid fa-map' : 'fa-solid fa-location-dot')
    });
    syncSelectedSearchAreaGroupId();
    renderSelectedSearchAreaChips();
}

function removeSelectedSearchAreaFilter(key) {
    selectedSearchAreaFilters = selectedSearchAreaFilters.filter((filter) => getAreaFilterKey(filter) !== key);
    syncSelectedSearchAreaGroupId();
    renderSelectedSearchAreaChips();
    isUserFiltering = true;
    scheduleSearchData(activeHousingView);
}

function renderSelectedSearchAreaChips() {
    const container = document.getElementById('selected-search-area-chips');
    if (!container) return;

    container.innerHTML = selectedSearchAreaFilters.map((filter) => {
        const key = getAreaFilterKey(filter);
        return `
            <button type="button"
                    class="selected-search-area-chip"
                    data-area-filter-key="${key}"
                    aria-label="Fjern ${filter.label}">
                <i class="${filter.icon}" aria-hidden="true"></i>
                <span>${filter.label}</span>
                <i class="fa-solid fa-xmark selected-search-area-chip-remove" aria-hidden="true"></i>
            </button>
        `;
    }).join('');

    container.classList.toggle('d-none', selectedSearchAreaFilters.length === 0);
}

function setupSelectedSearchAreaChips() {
    const container = document.getElementById('selected-search-area-chips');
    if (!container || container.dataset.bound) return;

    container.dataset.bound = '1';
    container.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-area-filter-key]');
        if (!chip) return;

        event.preventDefault();
        removeSelectedSearchAreaFilter(chip.dataset.areaFilterKey);
    });
}


function setupMainSearchAutocomplete() {
    const $input = $("#housing-list-search");
    if (!$input.length || $input.data('autocompleteBound')) return;

    $input.data('autocompleteBound', '1');

    $input.on('keydown', function(e) {
        if (e.keyCode === 9) { // Tab key
            const instance = $(this).data("ui-autocomplete");
            if (instance && instance.menu && instance.menu.element.is(":visible")) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (instance.menu.active && instance.menu.active.length > 0) {
                    instance.menu.next(e);
                } else {
                    instance.menu.focus(e, instance.menu.element.children().first());
                }
            }
        }
    });

    $input.autocomplete({
        source: function(request, response) {
            const term = String(request.term || '').trim().toLowerCase();
            const selectedKeys = new Set(selectedSearchAreaFilters.map(getAreaFilterKey));

            let matches;
            if (!term) {
                // Show quick area groups by default to guide users.
                matches = (searchAreaGroups || []).map((group) => ({
                    id: String(group.id),
                    type: 'group',
                    label: group.label,
                    icon: group.icon || 'fa-solid fa-map',
                    description: 'Søg i omrade',
                    searchText: `${group.label} ${group.id}`.toLowerCase(),
                })).filter((item) => !selectedKeys.has(getAreaFilterKey(item)));
            } else {
                matches = searchSuggestions.filter(item =>
                    item.searchText.includes(term) && !selectedKeys.has(getAreaFilterKey(item))
                );

                // Sortering: Områdegrupper først, derefter starter-med, og til sidst alfabetisk
                matches.sort((a, b) => {
                    if (a.type === 'group' && b.type !== 'group') return -1;
                    if (a.type !== 'group' && b.type === 'group') return 1;

                    const aLower = String(a.label || '').toLowerCase();
                    const bLower = String(b.label || '').toLowerCase();

                    const aStarts = aLower.startsWith(term);
                    const bStarts = bLower.startsWith(term);

                    if (aStarts && !bStarts) return -1;
                    if (!aStarts && bStarts) return 1;

                    return aLower.localeCompare(bLower, 'da');
                });
            }

            response(matches.slice(0, 12));
        },
        delay: 0,
        minLength: 0,
        focus: function(event, ui) {
            event.preventDefault();
            return false;
        },
        select: function(event, ui) {
            addSelectedSearchAreaFilter(ui.item);
            this.value = '';
            // FIX: Added flag here so the fade-in effect works on select
            isUserFiltering = true;
            scheduleSearchData(activeHousingView);
            return false;
        },
        change: function(event, ui) {
            if (!ui.item && selectedSearchAreaFilters.length === 0) {
                selectedSearchAreaGroupId = '';
            }
        }
    }).focus(function () {
        $(this).autocomplete('search', '');
    });

    // Custom rendering for at gøre dropdown'en lækker og i tråd med resten af designet
    $input.data("ui-autocomplete")._renderItem = function(ul, item) {
        const isGroup = item.type === 'group';
        const iconClass = item.icon || (isGroup ? "fa-solid fa-map" : "fa-solid fa-location-dot");
        const helperText = item.description || (isGroup ? 'Søg i omrade' : 'Postnummer');

        const html = `
            <div class="d-flex align-items-center py-2 px-3 autocomplete-custom-item">
                <div class="d-flex align-items-center justify-content-center bg-primary bg-opacity-10 text-primary rounded-circle me-3 flex-shrink-0" style="width: 36px; height: 36px;">
                    <i class="${iconClass}"></i>
                </div>
                <div>
                    <div class="fw-bold text-dark" style="font-size: 0.95rem; line-height: 1.2;">${item.label}</div>
                    <div class="small text-muted" style="font-size: 0.8rem;">
                        ${helperText}
                    </div>
                </div>
            </div>
        `;

        return $("<li>")
            .append(html)
            .appendTo(ul);
    };
}

export function setupHousingListView() {
    const searchInput = document.getElementById('housing-list-search');
    if (searchInput) {
        const debouncedSearch = debounce(() => {
            isUserFiltering = true; // User typed
            scheduleSearchData(activeHousingView);
        }, 300);
        searchInput.addEventListener('input', debouncedSearch);
    }

    setupSelectedSearchAreaChips();
    renderSelectedSearchAreaChips();

    const dropdownIds = [
        'price-filter', 'rooms-filter', 'monthly-fee-filter', 'square-meters-filter'
    ];
    dropdownIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                isUserFiltering = true; // User selected a dropdown
                scheduleSearchData(activeHousingView);
            });
        }
    });

    const filterCheckboxes = document.querySelectorAll('.extra-filter-checkbox');
    filterCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
            isUserFiltering = true; // User clicked a checkbox
            scheduleSearchData(activeHousingView);
        });
    });

    const typeRadios = document.querySelectorAll('.extra-filter-radio');
    typeRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            isUserFiltering = true; // User clicked a radio button
            scheduleSearchData(activeHousingView);
        });
    });

    const sortSelect = document.getElementById('sort-options');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            isUserFiltering = true; // User changed sorting
            scheduleSearchData('list');
        });
    }

    const clearBtn = document.getElementById('clear-filters');
    if (clearBtn && !clearBtn.dataset.bound) {
        clearBtn.dataset.bound = '1';
        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearAllFilters();
        });
    }

    const byteMatchToggle = document.getElementById('byttematch-toggle');
    if (byteMatchToggle && !byteMatchToggle.dataset.bound) {
        byteMatchToggle.dataset.bound = '1';
        byteMatchToggle.addEventListener('click', async function () {
            byteMatchMode = !byteMatchMode;

            if (byteMatchMode) {
                this.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:0.85rem;height:0.85rem;"></span><span>BytteMatch</span>';
                await activateByteMatchMode();
            } else {
                userSwapHousing = null;
            }

            updateByteMatchToggleUI();
            updateByteMatchGuidance(activeHousingView);
            isUserFiltering = true;
            updateClearFiltersButton();
            scheduleSearchData(activeHousingView);
        });
    }

    const openCriteriaBtn = document.getElementById('open-byttematch-criteria-modal');
    if (openCriteriaBtn && !openCriteriaBtn.dataset.bound) {
        openCriteriaBtn.dataset.bound = '1';
        openCriteriaBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openBytteCriteriaModal();
        });
    }

    updateByteMatchToggleUI();
    updateByteMatchGuidance(activeHousingView);
    setupListBoligMatchCta();
    setupHousingCardImageGalleries();
    updateListBoligMatchCta(activeHousingView);

    updateClearFiltersButton();
    prepareSearchSuggestions();
    setupMainSearchAutocomplete();
    setupAllAutoCompletes();

    document.addEventListener('housings:loaded', () => {
        const currentView = getCurrentView();
        if (currentView !== 'housing_list' && currentView !== 'housing_map') {
            warmDefaultListResultsCache();
            return;
        }

        sendSearchData(currentView === 'housing_map' ? 'map' : 'list');
    });
}

function setupHousingCardImageGalleries() {
    if (document.documentElement.dataset.cardGalleryBound) return;

    document.documentElement.dataset.cardGalleryBound = '1';

    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-card-gallery-action]');
        if (!button) return;

        event.preventDefault();
        event.stopPropagation();

        const gallery = button.closest('[data-card-gallery]');
        const scroller = gallery?.querySelector('[data-gallery-scroller]');
        if (!scroller) return;

        const direction = Number(button.dataset.scrollDir || 0);
        if (!direction) return;

        scroller.scrollBy({
            left: direction * scroller.clientWidth,
            behavior: 'smooth'
        });
    });

    document.addEventListener('pointerdown', (event) => {
        const scroller = event.target.closest('[data-gallery-scroller]');
        if (!scroller) return;

        scroller.dataset.pointerStartX = String(event.clientX);
        scroller.dataset.pointerStartScrollLeft = String(scroller.scrollLeft);
    }, {passive: true});

    document.addEventListener('click', (event) => {
        const scroller = event.target.closest('[data-gallery-scroller]');
        if (!scroller || event.target.closest('[data-card-gallery-action]')) return;

        const gallery = scroller.closest('[data-card-gallery]');
        const housingId = gallery?.dataset.galleryHousingId;
        if (!housingId) return;

        const pointerDelta = Math.abs(event.clientX - Number(scroller.dataset.pointerStartX || event.clientX));
        const scrollDelta = Math.abs(scroller.scrollLeft - Number(scroller.dataset.pointerStartScrollLeft || scroller.scrollLeft));
        if (pointerDelta > 8 || scrollDelta > 8) return;

        event.preventDefault();
        event.stopPropagation();
        showView('detail', new URLSearchParams({ id: housingId }));
    });

    initHousingCardGalleryObservers(document);

    const mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    initHousingCardGalleryObservers(node);
                }
            });
        });
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
}

function initHousingCardGalleryObservers(root) {
    const galleries = root.matches?.('[data-card-gallery]')
        ? [root]
        : Array.from(root.querySelectorAll?.('[data-card-gallery]') || []);

    galleries.forEach((gallery) => {
        if (gallery.dataset.galleryObserverReady === '1') return;

        const scroller = gallery.querySelector('[data-gallery-scroller]');
        const items = Array.from(gallery.querySelectorAll('[data-gallery-index]'));
        if (!scroller || items.length === 0) return;

        gallery.dataset.galleryObserverReady = '1';

        const setActiveDot = (index) => {
            gallery
                .querySelectorAll('[data-gallery-dot]')
                .forEach((dot) => dot.classList.toggle('active', Number(dot.dataset.galleryDot) === index));
        };

        setActiveDot(0);

        if (!('IntersectionObserver' in window)) {
            scroller.addEventListener('scroll', () => {
                const index = Math.round(scroller.scrollLeft / Math.max(scroller.clientWidth, 1));
                setActiveDot(index);
            }, {passive: true});
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            const visibleEntry = entries
                .filter(entry => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

            if (!visibleEntry) return;
            setActiveDot(Number(visibleEntry.target.dataset.galleryIndex || 0));
        }, {
            root: scroller,
            threshold: 0.5
        });

        items.forEach((item) => observer.observe(item));
    });
}

/**
 * Persist the current pagination depth so that returning to the list view
 * (e.g. after opening a detail page) re-renders all pages the user had loaded.
 * Call this right before navigating away from the housing_list view.
 */
export function persistListScrollState() {
    savedListPage = page;
}

export async function ensureHousingListRendered() {
    if (hasReusableRenderedList()) {
        updateClearFiltersButton();
        updateByteMatchGuidance('list');
        updateListBoligMatchCta('list');
        return;
    }

    await sendSearchData('list');
}


export async function sendSearchData(housingView, append = false, housing_ids = null) {
    const listingsContainer = document.getElementById('listings-container');
    const countElement = document.getElementById('search-result-count');

    // --- START VISUAL DELAY (Labor Illusion) ---
    // We only want the delay if we aren't appending pages (infinite scroll)
    if (!append && isUserFiltering) {
        if (listingsContainer) listingsContainer.classList.add('is-updating');
        if (countElement) countElement.classList.add('count-updating');

        // Wait 250ms so the user registers that work is being done
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    // --- END VISUAL DELAY ---

    const allHousings = housing_ids ? getAllHousings().filter(h => housing_ids.includes(h._id)) : getAllHousings();

    // When returning to the list after navigating away (e.g. from detail view),
    // we want to restore ALL pages the user had previously loaded, not just page 0.
    // restoredPage >= 0 signals this case and is used below to fix up `page` after slicing.
    let restoredPage = -1;

    if (housingView === 'list') {
        size = LIST_PAGE_SIZE;
        if (!append && savedListPage > 0) {
            // Restore path: show all previously loaded pages in one render pass.
            restoredPage = savedListPage;
            savedListPage = -1;
            page = 0;                            // start = 0 × bigSize = 0
            size = (restoredPage + 1) * LIST_PAGE_SIZE;      // bigSize covers every loaded page at once
        } else {
            page = append ? page + 1 : 0;
        }
    } else {
        page = 0;
        size = 10_000;
    }

    const filters = buildFilters();
    updateClearFiltersButton(!!housing_ids);

    let filteredHousings;
    let bytteMatchLooseMatchStartIndex;
    let listResultsSignature = null;

    if (housingView === 'list') {
        const listResults = getCachedListResults(filters, allHousings, housing_ids);
        filteredHousings = listResults.filteredHousings;
        bytteMatchLooseMatchStartIndex = listResults.bytteMatchLooseMatchStartIndex;
        listResultsSignature = listResults.listResultsSignature;
    } else {
        filteredHousings = sortHousings(filterHousings(allHousings, filters), filters.sort, filters.housingType);
        bytteMatchLooseMatchStartIndex = byteMatchMode
            ? filteredHousings.findIndex(housing => !hasConfiguredExchangeCriteria(housing.exchange_criteria))
            : -1;
    }

    const total_object_count = filteredHousings.length;
    const start = housingView === 'list' ? page * size : 0;
    const end = housingView === 'list' ? start + size : filteredHousings.length;
    const objects = filteredHousings.slice(start, end);

    if (countElement) countElement.innerText = total_object_count;

    const labelContainer = document.getElementById('search-result-label');
    if (labelContainer) {
        if (byteMatchMode) {
            labelContainer.innerHTML = `
                <span class="d-none d-sm-inline">BytteMatch fundet</span>
                <span class="d-inline d-sm-none">BytteMatch</span>
            `;
        } else if (filters.housingType === 'exchange') {
            labelContainer.innerHTML = `
                <span class="d-none d-sm-inline">andelsboliger til bytte</span>
                <span class="d-inline d-sm-none">til bytte</span>
            `;
        } else if (filters.housingType === 'sale') {
            labelContainer.innerHTML = `
                <span class="d-none d-sm-inline">andelsboliger til salg</span>
                <span class="d-inline d-sm-none">til salg</span>
            `;
        } else {
            labelContainer.innerHTML = `
                <span class="d-none d-sm-inline">andelsboliger (salg & bytte)</span>
                <span class="d-inline d-sm-none">salg & bytte</span>
            `;
        }
    }

    updateByteMatchGuidance(housingView);

    const response_json = { objects, total_object_count, start, bytteMatchLooseMatchStartIndex };

    // BytteMatch mode: when the user has no swap listing to match against,
    // show a targeted empty state instead of the generic no-results image.
    if (shouldShowByteMatchEmptyState()) {
        const listingsContainer = document.getElementById('listings-container');
        const noResultsContainer = document.getElementById('no-results');
        if (listingsContainer) {
            listingsContainer.innerHTML = generateByteMatchEmptyHtml(decodeJwt() !== null);
            listingsContainer.classList.remove('row', 'g-4');
        }
        if (noResultsContainer) noResultsContainer.style.display = 'none';
        if (countElement) countElement.innerText = '0';
        $('#next-page-button').addClass('d-none');

        if (housingView === 'map' && window.googlemap) {
            displayHousingsOnMap({ objects: [], total_object_count: 0 });
        }

        // --- REMOVE VISUAL DELAY ---
        if (!append && isUserFiltering) {
            if (listingsContainer) listingsContainer.classList.remove('is-updating');
            if (countElement) countElement.classList.remove('count-updating');
        }
        isUserFiltering = false;
        return;
    }

    if (housingView === 'list') {
        displayHousingsOnList(response_json, append, true);
        updateListBoligMatchCta('list');
        // After the restore render, set page back to where the user was so that
        // subsequent "Flere boliger" clicks continue from the correct position.
        if (restoredPage >= 0) {
            page = restoredPage;
        }
        renderedListSignature = getRenderedListSignature(listResultsSignature);
    } else if (housingView === 'map') {
        if (window.housings !== null) {
            displayHousingsOnMap(response_json);
        }
    }

    // --- REMOVE VISUAL DELAY ---
    if (!append && isUserFiltering) {
        if (listingsContainer) listingsContainer.classList.remove('is-updating');
        if (countElement) countElement.classList.remove('count-updating');
    }
    isUserFiltering = false;
}

function setupPostalAutocomplete(suffix, postalData) {
    $("#radius-postalnumber" + suffix).autocomplete({
        delay: 0,
        minLength: 0,
        source(request, response) {
            const term = request.term.trim().toLowerCase();

            const matches = $.map(postalData, (cityName, postalCode) => {
                const label = `${postalCode} - ${cityName}`;
                if (label.toLowerCase().includes(term)) {
                    return label;
                }
            });

            response(matches);
        },
        select(event, ui) {
            const [code, city] = ui.item.value.split(" - ");
            $("#radius-postalnumber" + suffix).val(code);

            if (!suffix.includes('agent')) {
                // FIX: Added flag here as well
                isUserFiltering = true;
                scheduleSearchData(activeHousingView);
            }
            return false;
        }
    }).focus(function () {
        $(this).autocomplete("search", "");
    });
}

function setupAllAutoCompletes() {
    setupPostalAutocomplete("", postalData);
    setupPostalAutocomplete("-agenteditview", postalData);
    setupPostalAutocomplete("-agentcreateview", postalData);
}

export function displayHousingsOnList(response, append = false, triggerPopup = false) {
    const housings = response.objects;
    const listingsContainer = document.getElementById('listings-container');
    const noResultsContainer = document.getElementById('no-results');
    const shouldInsertFomoCard = shouldShowListBoligMatchFomoCard(response, append);
    const looseBytteMatchCardIndex = getLooseBytteMatchCardIndex(response);

    if (!listingsContainer.classList.contains('row')) {
        listingsContainer.classList.add('row', 'g-4');
    }

    if (!append) {
        listingsContainer.innerHTML = '';
    }

    if (window.housings === null) {
        noResultsContainer.style.display = 'none';
        $("#next-page-button").addClass('d-none');
        listingsContainer.innerHTML = `
            <div class="d-flex justify-content-center align-items-center w-100 py-5">
                <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>`;
        return;
    }

    if (housings.length === 0 && listingsContainer.children.length === 0) {
        noResultsContainer.innerHTML = generateSearchNoResultsHtml();
        noResultsContainer.style.display = 'flex';
        $("#next-page-button").addClass('d-none');
        return;
    }

    noResultsContainer.style.display = 'none';

    const cardHtml = [];
    housings.forEach((housing, index) => {
        if (shouldInsertFomoCard && index === LIST_BOLIGMATCH_FOMO_INSERT_INDEX) {
            cardHtml.push(generateListBoligMatchFomoCard(isCopenhagenRelevantResultSet(response.objects)));
        }

        if (index === looseBytteMatchCardIndex) {
            cardHtml.push(generateLooseBytteMatchExplanationCard());
        }

        cardHtml.push(generateHousingCard(housing, "data-housing-id-list", index));
    });

    if (shouldInsertFomoCard && housings.length <= LIST_BOLIGMATCH_FOMO_INSERT_INDEX) {
        cardHtml.push(generateListBoligMatchFomoCard(isCopenhagenRelevantResultSet(response.objects)));
    }

    const htmlString = cardHtml.join('');

    listingsContainer.insertAdjacentHTML('beforeend', htmlString);
    setupListBoligMatchFomoCard();

    const displayedCount = listingsContainer.querySelectorAll('[data-scroll-anchor-id]').length;
    if (response.total_object_count > displayedCount) {
        $("#next-page-button").removeClass('d-none');
    } else {
        $("#next-page-button").addClass('d-none');
    }
}

function getLooseBytteMatchCardIndex(response) {
    if (!byteMatchMode || activeHousingView !== 'list') return -1;

    const fallbackStart = Number(response?.bytteMatchLooseMatchStartIndex);
    const pageStart = Number(response?.start || 0);

    if (!Number.isInteger(fallbackStart) || fallbackStart < 0) return -1;
    if (!Array.isArray(response?.objects) || response.objects.length === 0) return -1;

    const localIndex = fallbackStart - pageStart;
    return localIndex >= 0 && localIndex < response.objects.length ? localIndex : -1;
}

function generateLooseBytteMatchExplanationCard() {
    return `
    <article class="col-12" aria-label="Mulige BytteMatch">
        <div class="card border-0 rounded-4 shadow-sm p-3 p-md-4" style="background: #f8fbff; border: 1px solid rgba(45, 75, 242, 0.12) !important;">
            <div class="d-flex flex-column flex-md-row align-items-start gap-3">
                <div class="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                     style="width: 48px; height: 48px; background: rgba(45, 75, 242, 0.1); color: var(--bs-primary);">
                    <i class="fa-solid fa-circle-info fs-5"></i>
                </div>
                <div class="flex-grow-1">
                    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                        <h3 class="h6 fw-bold mb-0" style="color: var(--company-dark);">Mulige BytteMatch</h3>
                        <span class="badge rounded-pill bg-primary bg-opacity-10 text-primary border border-primary border-opacity-25">
                            <i class="fa-solid fa-right-left me-1"></i>Udvidet match
                        </span>
                    </div>
                    <p class="text-muted small mb-0" style="line-height: 1.55; max-width: 760px;">
                        De næste boliger har ikke udfyldt konkrete bytteønsker endnu. De er derfor ikke nødvendigvis perfekte matches,
                        men vises fordi de potentielt kunne have din interesse.
                    </p>
                </div>
            </div>
        </div>
    </article>`;
}

function shouldShowListBoligMatchFomoCard(response, append) {
    if (append || activeHousingView !== 'list' || byteMatchMode || isListBoligMatchFomoDismissed()) {
        return false;
    }

    if (!response?.objects || response.objects.length < LIST_BOLIGMATCH_FOMO_MIN_RESULTS) {
        return false;
    }

    const user = decodeJwt();
    if (!user) {
        return true;
    }

    return Array.isArray(window.agents) && window.agents.length === 0;
}

function isCopenhagenRelevantResultSet(housings = []) {
    const selectedAreas = selectedSearchAreaFilters.length > 0
        ? selectedSearchAreaFilters
        : (selectedSearchAreaGroupId ? [{id: selectedSearchAreaGroupId, type: 'group'}] : []);

    if (selectedAreas.length > 0) {
        const hasCopenhagenArea = selectedAreas.some((area) => {
            const areaLabel = areaGroupLabelById[String(area.id)] || area.label || '';
            const range = getAreaFilterRange(area);

            return /københavn|frederiksberg/i.test(areaLabel)
                || (range && range.min <= STOR_KOEBENHAVN_POSTAL_RANGE.max && range.max >= STOR_KOEBENHAVN_POSTAL_RANGE.min);
        });

        if (hasCopenhagenArea) return true;
    }

    if (selectedSearchAreaGroupId) {
        const areaLabel = areaGroupLabelById[String(selectedSearchAreaGroupId)] || '';
        if (/københavn|frederiksberg/i.test(areaLabel)) return true;

        const range = areaGroupRangeById[String(selectedSearchAreaGroupId)];
        if (range && range.min <= STOR_KOEBENHAVN_POSTAL_RANGE.max && range.max >= STOR_KOEBENHAVN_POSTAL_RANGE.min) return true;
    }

    return housings.some((housing) => {
        const postalNumber = Number(housing?.postal_number);
        const city = `${housing?.city || ''} ${housing?.postal_name || ''}`;

        return (Number.isFinite(postalNumber) && postalNumber >= STOR_KOEBENHAVN_POSTAL_RANGE.min && postalNumber <= STOR_KOEBENHAVN_POSTAL_RANGE.max)
            || /københavn|frederiksberg/i.test(city);
    });
}

function generateListBoligMatchFomoCard(isCopenhagenRelevant) {
    const bodyText = isCopenhagenRelevant
        ? 'I København får attraktive andelsboliger mange henvendelser inden for den første time. Med BoligMatch overvåger vi markedet for dig og giver besked, i det minut boligen ligges op.'
        : 'Populære andelsboliger får mange henvendelser på få timer. Med BoligMatch overvåger vi markedet for dig og giver besked, i det minut boligen ligges op.';

    return `
    <article class="col-12 col-sm-6 col-lg-4 col-xl-4 col-xxl-3" id="list-boligmatch-fomo-card" aria-label="Opret BoligMatch">
        <div class="card housing-card list-boligmatch-fomo-card h-100 p-0 position-relative">
            <button type="button" class="btn btn-light rounded-circle list-boligmatch-fomo-close" aria-label="Luk BoligMatch forslag">
                <i class="fa-solid fa-xmark"></i>
            </button>

            <div class="list-boligmatch-fomo-visual">
                <div class="list-boligmatch-fomo-radar" aria-hidden="true">
                    <i class="fa-solid fa-satellite-dish"></i>
                </div>
                <div class="list-boligmatch-fomo-line"></div>
            </div>

            <div class="card-body p-4 d-flex flex-column">
                <div class="mb-3">
                    <span class="list-boligmatch-fomo-eyebrow">
                        <i class="fa-solid fa-bolt"></i> BoligMatch
                    </span>
                    <h2 class="h5 fw-bold mt-3 mb-2" style="color: var(--company-dark); line-height: 1.15;">De bedste boliger forsvinder hurtigt</h2>
                    <p class="small text-muted mb-0" style="line-height: 1.55;">${bodyText}</p>
                </div>

                <div class="list-boligmatch-fomo-chips mb-4">
                    <span><i class="fa-solid fa-satellite-dish"></i> Live overvågning</span>
                    <span><i class="fa-regular fa-bell"></i> Besked med det samme</span>
                    <span><i class="fa-solid fa-circle-check"></i> Gratis at oprette</span>
                </div>

                <button type="button" class="btn btn-primary rounded-pill fw-bold py-2 px-4 mt-auto list-boligmatch-fomo-create">
                    <i class="fa-solid fa-plus me-2"></i>Opret BoligMatch
                </button>
            </div>
        </div>
    </article>
    `;
}

function setupListBoligMatchFomoCard() {
    const card = document.getElementById('list-boligmatch-fomo-card');
    if (!card || card.dataset.bound) return;

    card.dataset.bound = '1';

    card.querySelector('.list-boligmatch-fomo-create')?.addEventListener('click', (event) => {
        event.preventDefault();
        showView('agent_create');
    });

    card.querySelector('.list-boligmatch-fomo-close')?.addEventListener('click', (event) => {
        event.preventDefault();
        dismissListBoligMatchFomoCard();
    });
}

function generateSearchComponents() {
    const filterButton = `
      <button
        class="search-filter-btn"
        type="button"
        data-bs-toggle="collapse"
        data-bs-target="#extra-filters"
        aria-expanded="false"
        aria-controls="extra-filters"
        aria-label="Filtre"
        title="Åben filtre"
        tabindex="-1"
      >
        <i class="fa-solid fa-sliders" style="font-size: 1.1rem;"></i>
      </button>`;

    return `
<div class="container pb-3">
  
<h1 class="view-title text-center pt-4 pb-2">
    Find din næste <span class="view-title-highlight">andelsbolig</span>
</h1>

<p class="text-center text-muted fs-5 opacity-75 mx-auto mb-4" style="max-width: 550px; font-size: 0.95rem; line-height: 1.6;">
    Søg blandt andelsboliger til salg og bytte i hele landet. Find dit drømmehjem på Andelsbolig&nbsp;Basen
</p>

  <div class="housing-search-card shadow-sm rounded-4 p-3 p-md-4">
    <div class="d-flex flex-column gap-3">

      <div class="position-relative">
        <i class="fa-solid fa-magnifying-glass search-icon"></i>
        
        <input class="form-control search-input search-input-with-btn ps-5" 
               type="text" 
               id="housing-list-search" 
               placeholder="By, postnr. eller vejnavn">
               
        ${filterButton}
      </div>

      <div id="selected-search-area-chips" class="selected-search-area-chips d-none" aria-label="Valgte områder"></div>

      <div class="d-flex align-items-center gap-2 flex-wrap">
        <button id="byttematch-toggle"
                type="button"
                class="btn rounded-pill px-3 py-2 d-flex align-items-center gap-2 fw-semibold byttematch-btn"
                title="Vis boliger der matcher din bytteannonce">
          <i class="fa-solid fa-right-left"></i><span>BytteMatch</span>
        </button>
        <span class="byttematch-hint text-muted small">
          <span class="d-inline d-sm-none">Vis boliger der matcher din bytteannonce</span>
          <span class="d-none d-sm-inline">Vis boliger der matcher din bytteannonce</span>
        </span>
      </div>

<!--
       <div class="d-flex flex-column flex-sm-row gap-2 mt-2">
        <input type="checkbox" class="btn-check extra-filter-checkbox" id="filter-upsize" autocomplete="off">
        <label class="btn rounded-pill border px-3 py-2 d-flex align-items-center justify-content-center justify-content-sm-start gap-2 bg-white text-secondary fw-medium shadow-sm transition-all bytte-quick-filter" for="filter-upsize">
            <i class="fa-solid fa-arrow-trend-up text-company-blue"></i> Sælger vil bytte til større
        </label>

        <input type="checkbox" class="btn-check extra-filter-checkbox" id="filter-downsize" autocomplete="off">
        <label class="btn rounded-pill border px-3 py-2 d-flex align-items-center justify-content-center justify-content-sm-start gap-2 bg-white text-secondary fw-medium shadow-sm transition-all bytte-quick-filter" for="filter-downsize">
            <i class="fa-solid fa-arrow-trend-down text-company-blue"></i> Sælger vil bytte til mindre
        </label>
       </div>
   -->  
   
      <div class="collapse" id="extra-filters">
        <div class="pt-3 d-flex flex-column gap-4">

            <div class="d-flex justify-content-center">
                <div class="segmented-control shadow-sm">
                    <input type="radio" class="btn-check extra-filter-radio" name="filter-type" id="filter-type-all" value="all" checked autocomplete="off">
                    <label class="btn btn-sm flex-fill px-4 py-2 segment-label fw-medium" for="filter-type-all">Salg & Bytte</label>

                    <input type="radio" class="btn-check extra-filter-radio" name="filter-type" id="filter-type-sale" value="sale" autocomplete="off">
                    <label class="btn btn-sm flex-fill px-4 py-2 segment-label fw-medium" for="filter-type-sale">Kun salg</label>

                    <input type="radio" class="btn-check extra-filter-radio" name="filter-type" id="filter-type-exchange" value="exchange" autocomplete="off">
                    <label class="btn btn-sm flex-fill px-4 py-2 segment-label fw-medium" for="filter-type-exchange">Kun bytte</label>
                </div>
            </div>
            
            <div class="row g-2">
                <div class="col-6 col-md-3">
                  <select class="form-select filter-select" id="monthly-fee-filter">
                    ${buildSelectOptions(monthlyFeeRanges)}
                  </select>
                </div>
                <div class="col-6 col-md-3">
                  <select class="form-select filter-select" id="price-filter">
                    ${buildSelectOptions(priceRanges)}
                  </select>
                </div>
                <div class="col-6 col-md-3">
                  <select class="form-select filter-select" id="square-meters-filter">
                    ${buildSelectOptions(squareMeterRanges)}
                  </select>
                </div>
                <div class="col-6 col-md-3">
                  <select class="form-select filter-select" id="rooms-filter">
                    ${buildSelectOptions(roomRanges)}
                  </select>
                </div>
            </div>

            <div class="row g-3">
                <div class="col-6 col-md-4">
                  <input type="checkbox" class="btn-check extra-filter-checkbox" id="filter-pets-allowed" autocomplete="off">
                  <label class="facility-card shadow-sm" for="filter-pets-allowed">
                    <i class="fa-solid fa-paw text-secondary"></i>
                    <span>Husdyr tilladt</span>
                  </label>
                </div>

                <div class="col-6 col-md-4">
                  <input type="checkbox" class="btn-check extra-filter-checkbox" id="filter-balcony" autocomplete="off">
                  <label class="facility-card shadow-sm" for="filter-balcony">
                    <i class="fa-regular fa-sun text-secondary"></i>
                    <span>Altan/Terrasse</span>
                  </label>
                </div>

                <div class="col-12 col-md-4">
                  <input type="checkbox" class="btn-check extra-filter-checkbox" id="filter-favorites" autocomplete="off">
                  <label class="facility-card shadow-sm" for="filter-favorites">
                    <i class="fa-solid fa-heart text-secondary"></i>
                    <span>Kun favoritter</span>
                  </label>
                </div>
            </div>

        </div>
      </div>

    </div>
  </div>

  <div class="d-flex align-items-center justify-content-between mt-3 gap-2 mx-auto" style="max-width: 950px;">
    
    <div class="d-flex align-items-center gap-2 text-nowrap">
      <div style="line-height: 1; font-size: 0.9rem;">
          <span id="search-result-count" class="fw-bold text-company-dark" style="font-size: 1.1em;">0</span>
          <span id="search-result-label" class="text-secondary fw-medium ms-1">
              <span class="d-none d-sm-inline">andelsboliger (salg & bytte)</span>
              <span class="d-inline d-sm-none">salg & bytte</span>
          </span>
      </div>
      
      <button type="button"
              class="btn btn-link btn-sm p-0 d-none clear-filters-link"
              id="clear-filters">
        <i class="fa-solid fa-xmark"></i>
          <span class="d-none d-sm-inline">Ryd filtre</span>
          <span class="d-inline d-sm-none">Ryd</span>
      </button>
    </div>

    <div class="d-flex align-items-center gap-2">
      <select class="form-select filter-select w-auto view-only-list" id="sort-options" style="height: 40px; padding-top: 4px; padding-bottom: 4px;">
        <option value="created-desc">Nyeste først</option>
        <option value="created-asc">Ældste først</option>
        <option value="price-asc">Billigste pris</option>
        <option value="price-desc">Dyreste pris</option>
        <option value="monthly_fee-asc">Laveste husleje</option>
        <option value="monthly_fee-desc">Højeste husleje</option>
        <option value="square_meters-asc">Mindste m²</option>
        <option value="square_meters-desc">Største m²</option>
      </select>
      
      <button id="showVisibleListBtn" class="btn btn-primary rounded-pill view-only-map text-nowrap shadow-sm">
        Se på liste
      </button>
    </div>

  </div>

  <div id="mutual-bytte-hint" class="bytte-guidance-card d-none mt-3 mx-auto" style="max-width: 950px;">
    <span class="text-muted">
      Du kan ændre dine ønsker for at se flere BytteMatch
      <button type="button" id="open-byttematch-criteria-modal" class="btn btn-link bytte-guidance-link p-0 align-baseline">her</button>
    </span>
  </div>

  <section id="list-boligmatch-cta" class="list-boligmatch-cta d-none mt-3 mx-auto" aria-label="Opret BoligMatch" style="max-width: 950px;">
    <div class="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
      <div class="d-flex align-items-start gap-3">
        <div class="list-boligmatch-cta-icon flex-shrink-0">
          <i class="fa-regular fa-bell"></i>
        </div>
        <div>
          <h2 class="h6 fw-bold mb-1" style="color: var(--company-dark);">Få besked når en ny bolig matcher</h2>
          <p class="small text-muted mb-0" style="line-height: 1.5;">
            Du har ingen aktive BoligMatch. Opret et så får du besked i det øjeblik en relevant andelsbolig bliver sat til salg.
          </p>
        </div>
      </div>
      <div class="d-flex align-items-center gap-2 flex-shrink-0">
        <button type="button" id="create-list-boligmatch-cta" class="btn btn-primary rounded-pill fw-semibold px-4 text-nowrap">
          <i class="fa-solid fa-plus me-2"></i>Opret BoligMatch
        </button>
        <button type="button" id="close-list-boligmatch-cta" class="btn btn-light rounded-circle list-boligmatch-cta-close" aria-label="Luk BoligMatch forslag">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  </section>
</div>
`;
}

function toggleViewSpecificControls(view) {
    const isMap = view === 'map';
    document.querySelectorAll('.view-only-map').forEach(el => el.classList.toggle('d-none', !isMap));

    document.querySelectorAll('.view-only-list').forEach(el => {
        if (isMap) {
            el.classList.add('d-none');
            if (el.classList.contains('d-md-block')) {
                el.classList.remove('d-md-block');
                el.dataset.restoreMdBlock = 'true';
            }
        } else {
            el.classList.remove('d-none');
            if (el.dataset.restoreMdBlock) {
                el.classList.add('d-md-block');
                delete el.dataset.restoreMdBlock;
            }
        }
    });
}

export function insertSearchComponents() {
    const templateWrapper = document.createElement('div');
    templateWrapper.innerHTML = generateSearchComponents();
    sharedSearchComponent = templateWrapper.firstElementChild;

    const listContainer = document.querySelector('#housing_list .search-components-container');
    if (sharedSearchComponent && listContainer) {
        listContainer.innerHTML = '';
        listContainer.appendChild(sharedSearchComponent);
        toggleViewSpecificControls('list');
    }
}


export function attachSearchComponentToView(viewName) {
    if (!sharedSearchComponent) return;

    const targetContainer = document.querySelector(`#${viewName} .search-components-container`);
    if (!targetContainer) return;

    // ONLY append if it is not already in the correct container.
    // Moving it with appendChild automatically removes it from the previous container safely.
    if (sharedSearchComponent.parentElement !== targetContainer) {
        targetContainer.appendChild(sharedSearchComponent);
    }

    activeHousingView = viewName === 'housing_map' ? 'map' : 'list';
    toggleViewSpecificControls(activeHousingView);
    updateByteMatchGuidance(activeHousingView);
    updateListBoligMatchCta(activeHousingView);
}

export function isHousingFavorite(housing_id) {
    if (currentUser === null) {
        return false
    }
    return currentUser.favorite_advertisements.includes(housing_id);
}

function getHousingCardImageUrls(housing) {
    if (!Array.isArray(housing?.images) || housing.images.length === 0) {
        return [];
    }

    return housing.images
        .filter(img => img?.name)
        .map(img => `${s3Url}/${img.name}`);
}

function escapeHtmlAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function generateHousingCardGalleryControls(imageCount) {
    return `
        <button type="button"
                class="housing-card-gallery-control housing-card-gallery-control-prev"
                data-card-gallery-action="prev"
                data-scroll-dir="-1"
                aria-label="Forrige billede">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
        <button type="button"
                class="housing-card-gallery-control housing-card-gallery-control-next"
                data-card-gallery-action="next"
                data-scroll-dir="1"
                aria-label="Næste billede">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
    `;
}

function generateHousingCardGalleryDots(imageCount) {
    if (imageCount <= 1) return '';

    return `
        <div class="gallery-pagination-dots" aria-hidden="true">
            ${Array.from({length: imageCount}, (_, index) => `
                <span class="gallery-pagination-dot ${index === 0 ? 'active' : ''}" data-gallery-dot="${index}"></span>
            `).join('')}
        </div>
    `;
}

function generateHousingCardGalleryImages(imageUrls, imageAltTemplate, cardHeading, cardIndex) {
    const cappedImageUrls = imageUrls.slice(0, 6);
    const imageCount = cappedImageUrls.length;

    return cappedImageUrls.map((imageUrl, imageIndex) => {
        const isFirstImage = imageIndex === 0;
        const priorityAttribute = isFirstImage && (cardIndex === 0 || cardIndex === 1)
            ? 'fetchpriority="high"'
            : '';
        const lazyAttribute = isFirstImage ? '' : 'loading="lazy"';
        const altText = imageCount > 1
            ? imageAltTemplate.replace('{index}', String(imageIndex + 1)).replace('{total}', String(imageCount))
            : escapeHtmlAttribute(cardHeading);

        return `
            <img src="${imageUrl}"
                 alt="${altText}"
                 class="gallery-snap-item"
                 data-gallery-index="${imageIndex}"
                 ${priorityAttribute}
                 ${lazyAttribute}
                 width="1200"
                 height="800">
        `;
    }).join('');
}

export function generateHousingCard(housing, housingHTMLId, index) {
    setupHousingCardImageGalleries();

    let jwt = decodeJwt();
    const isOwner = jwt && housing.created_by === jwt.sub;
    const shortened_address = getShortenedAddress(housing);

    const ageDays = (Date.now() / 1000 - housing.created) / (60 * 60 * 24);
    const isNew = ageDays < 7;
    const isExchange = housing.exchange_only === true;

    let statusBadgeHtml = '';
    if (housing.sold) {
        statusBadgeHtml = `<span class="badge-glass badge-sold"><i class="fa-solid fa-handshake"></i><span>Solgt</span></span>`;
    } else if (housing.reserved) {
        statusBadgeHtml = `<span class="badge-glass badge-reserved"><i class="fa-solid fa-hourglass-half"></i><span>Reserveret</span></span>`;
    }

    // --- NYT: Markedsførings-badges og kort-styling ---
    let upsellBadgeHtml = '';
    let upsellCardClass = '';

    // Tjek om annoncen er betalt
    if (housing.marketing_paid) {
        upsellCardClass = 'is-boosted'; // Vi beholder CSS-klassenavnet 'is-boosted' for designet
        upsellBadgeHtml = `<span class="badge-boosted"><i class="fa-solid fa-star"></i><span>Fremhævet</span></span>`;
    }
    // ---------------------------------------------------

    const imageUrls = getHousingCardImageUrls(housing);
    const galleryImageUrls = (imageUrls.length > 0 ? imageUrls : [`${basePath}/pics/default4.webp`]).slice(0, 6);
    const hasMultipleImages = galleryImageUrls.length > 1;

    const priceFormatted = housing.price ? housing.price.toLocaleString('da-DK') : "-";
    const feeFormatted = housing.monthly_fee ? housing.monthly_fee.toLocaleString('da-DK') : "-";
    const roomsFormatted = housing.rooms ? `${housing.rooms} værelser` : "- værelser";
    const sqmFormatted = housing.square_meters ? `${housing.square_meters} m²` : "- m²";

    const detailUrl = `/detaljer?id=${housing._id}`;
    const isFav = isHousingFavorite(housing._id);

    const cardHeading = housing.title || housing.street_name || "Andelsbolig";
    const addressText = housing.address || shortened_address || "";

    const actionKeyword = isExchange ? "Bytte andelsbolig" : "Andelsbolig til salg";
    let locationKeyword = "";
    if (housing.postal_number && housing.city) {
        locationKeyword = ` i ${housing.postal_number} ${housing.city}`;
    } else if (housing.city) {
        locationKeyword = ` i ${housing.city}`;
    }
    const seoPrefix = `${actionKeyword}${locationKeyword}`;
    const seoLinkText = addressText ? `${seoPrefix} - ${cardHeading}, ${addressText}` : `${seoPrefix} - ${cardHeading}`;
    const imageAltBase = escapeHtmlAttribute(`${seoPrefix} - ${cardHeading}`.replace(/\s+/g, ' ').trim());
    const imageAltTemplate = `${imageAltBase} - Billede {index} af {total}`;

    return `
    <article class="col-12 col-sm-6 col-lg-4 col-xl-4 col-xxl-3" data-scroll-anchor-id="${housing._id}">
        <div class="card housing-card h-100 p-0 position-relative ${upsellCardClass}">
            
            <div class="housing-thumb">
                <div class="housing-card-gallery"
                     data-card-gallery
                     data-gallery-housing-id="${escapeHtmlAttribute(housing._id)}">
                    <div class="housing-card-scroller" data-gallery-scroller>
                        ${generateHousingCardGalleryImages(galleryImageUrls, imageAltTemplate, cardHeading, index)}
                    </div>
                    ${hasMultipleImages ? generateHousingCardGalleryControls(galleryImageUrls.length) : ''}
                    ${generateHousingCardGalleryDots(galleryImageUrls.length)}
                </div>
                <div class="position-absolute" 
                     style="top: 12px; right: 12px; z-index: 5;"
                     onclick="favoriteHousing('${housingHTMLId}', '${housing._id}'); event.preventDefault();">
                     <div class="favorite-btn-circle ${isFav ? 'active' : ''}" ${housingHTMLId}="${housing._id}">
                        <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                     </div>
                </div>

                <div class="position-absolute top-0 start-0 m-3 d-flex flex-column align-items-start gap-2" style="z-index: 5;">
                     
                     ${upsellBadgeHtml}
                     
                     <div class="d-flex flex-column gap-2">
                         ${statusBadgeHtml}
                         ${isNew ? `<span class="badge-glass badge-new">✨ Nyhed</span>` : ''}
                         ${isExchange ? `<span class="badge-glass badge-exchange"><i class="fa-solid fa-arrow-right-arrow-left"></i><span>Bytte</span></span>` : ''}
                         ${isOwner ? `<button class="btn badge-glass badge-edit text-decoration-none" onclick="showView('create'); event.preventDefault();">🖊️ Rediger</button>` : ''}
                     </div>

                </div>
            </div>

            <div class="card-body p-4 d-flex flex-column">
                <div class="mb-3">
                    <div class="d-flex justify-content-between align-items-start mb-1">
                        <h2 class="h6 fw-bold text-company-dark mb-0 title-truncate-2 pe-2" style="font-size: 0.95rem; letter-spacing: -0.01em; line-height: 1.2;" title="${cardHeading}">
                            ${cardHeading}
                        </h2>
                        <span class="fw-bolder text-company-blue text-nowrap mt-1" style="font-size: 1.25rem; line-height: 1;">
                            ${priceFormatted} <span style="font-size: 0.8rem; font-weight: 600;">kr.</span>
                        </span>
                    </div>
                    
                    <div class="d-flex align-items-center">
                        <span class="small text-muted text-truncate" title="${housing.address || shortened_address}">${shortened_address}</span>
                    </div>
                </div>

                <div class="mt-auto">
                    <hr class="opacity-10 my-3">
                    
                    <div class="d-flex justify-content-between align-items-center small text-company-dark opacity-75 fw-medium">
                        <div class="d-flex align-items-center gap-2" title="Størrelse">
                            <i class="fa-solid fa-house meta-icon"></i>
                            <span>${sqmFormatted}</span>
                        </div>
                        
                        <div class="d-flex align-items-center gap-2" title="Værelser">
                            <i class="fa-solid fa-bed meta-icon"></i>
                            <span>${roomsFormatted}</span>
                        </div>

                        <div class="d-flex align-items-center gap-2" title="Månedlig ydelse">
                            <i class="fa-solid fa-coins meta-icon"></i>
                            <span>${feeFormatted !== "-" ? feeFormatted + "/md" : "-/md"}</span>
                        </div>
                    </div>

                    ${isExchange ? buildSwapCriteriaMiniHtml(housing.exchange_criteria) : ''}
                </div>

                <a href="${detailUrl}" class="stretched-link" aria-label="${seoLinkText}">
                    <span class="visually-hidden">${seoLinkText}</span>
                </a>
            </div>
        </div>
    </article>
    `;
}

export function handleCardClick(cardElement, housingId) {
    cardElement.classList.add('tap-flash');
    setTimeout(() => {
        cardElement.classList.remove('tap-flash');
    }, 300);

    setTimeout(() => {
        showView('detail', new URLSearchParams({ id: housingId }));
    }, 100);
}

function extractDkPostalCodeInt(q) {
    const m = String(q || '').match(/\d+/);
    if (!m) return null;
    return parseInt(m[0], 10);
}

function normalizePostalName(s) {
    return String(s ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replaceAll("æ", "ae")
        .replaceAll("ø", "oe")
        .replaceAll("å", "aa");
}

function getCityNamesFromCityData(cityData) {
    if (Array.isArray(cityData)) return cityData;
    if (cityData && typeof cityData === "object") return Object.values(cityData);
    return [];
}


const POSTAL_NAME_NORM_SET = new Set(
    [...Object.values(postalData), ...getCityNamesFromCityData(cityData)]
        .filter(Boolean)
        .map(normalizePostalName)
        .filter(Boolean)
);

function getHousingPostalName(housing) {
    return (
        housing?.postal_name ??
        postalData[String(housing?.postal_number ?? "")] ??
        ""
    );
}

export function fetchAllAdvertisements(options = {}) {
    const force = options?.force === true;

    if (window.housingFetchPromise && !force){
        console.log("Promise already running")
        return window.housingFetchPromise
    }

    window.housingFetchPromise = (async () => {
        try {
            const response = await authFetch("/advertisement?page=0&size=10000");

            if (!response.ok) {
                console.error('Failed to fetch advertisements');
                window.housings = [];
            } else {
                const data = await response.json();
                window.housings = enrichHousingsSearchCache(data.objects);
            }
            housingDataVersion += 1;
            markListResultsDirty();
        } catch (error) {
            console.error('Error fetching advertisements:', error);
            window.housings = [];
            housingDataVersion += 1;
            markListResultsDirty();
        } finally {
            document.dispatchEvent(new CustomEvent('housings:loaded'));
        }
    })();

    return window.housingFetchPromise;
}

export async function fetchAllAdvertisementsSimple() {
    const response = await authFetch("/advertisement?page=0&size=10000");

    if (!response.ok) {
        console.error('Failed to fetch advertisements');
        window.housings = [];
    } else {
        const data = await response.json();
        window.housings = enrichHousingsSearchCache(data.objects);
    }
    housingDataVersion += 1;
    markListResultsDirty();
}

export function updateLocalHousing(updatedHousing) {
    if (!window.housings || !Array.isArray(window.housings)) {
        return;
    }

    enrichHousingSearchCache(updatedHousing);
    const index = window.housings.findIndex(h => h._id === updatedHousing._id);

    if (index !== -1) {
        console.log("Replacing housing entry")
        window.housings[index] = updatedHousing;
    } else {
        window.housings.unshift(updatedHousing);
    }
    housingDataVersion += 1;
    markListResultsDirty();
}

window.handleCardClick = handleCardClick;
window.sendSearchData = sendSearchData;



