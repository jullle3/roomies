import { postalData, areaGroups, areaAutocompleteOptions } from '../config/hardcoded_data.js';

export const EXCHANGE_CRITERIA_REQUIRED_MESSAGE = 'Vælg mindst ét ønsket område og flere præferencer for boligen, så vi kan finde relevante byttematches.';
export const AGENT_CRITERIA_REQUIRED_MESSAGE = 'Vælg mindst ét søgekriterie, så vi kan finde relevante boliger til dig.';

// Per-suffix tag state
const _areaSets = {};

function _getAreaSet(suffix) {
    if (!_areaSets[suffix]) _areaSets[suffix] = new Set();
    return _areaSets[suffix];
}

function normalizeAreaId(raw) {
    if (raw === null || raw === undefined) return '';
    return String(raw).trim();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


/**
 * Generates HTML for the criteria form
 * @param {string} context - 'agent' or 'Exchange' to adjust labels/messaging
 * @param {string} suffix - Unique suffix for input IDs to avoid collisions
 * @returns {string} HTML template string
 */
export function generateCriteriaForm(context = 'agent', suffix = 'criteria') {
    const isExchange = context === 'Exchange';

    // Context-specific labels
    const labels = {
        sectionTitle: isExchange ? 'Hvad leder du efter?' : 'Søgekriterier',
        geoTitle: isExchange ? 'Ønskede områder' : 'Geografi',
        geoHelp: isExchange
            ? 'Tilføj postnumre eller vælg et område med ét klik.'
            : 'Tilføj postnumre eller vælg et område med ét klik.',
        priceLabel: isExchange ? 'Maks. kontantpris' : 'Maks. kontantpris',
        monthlyLabel: isExchange ? 'Maks. månedlig ydelse' : 'Maks. månedlig ydelse'
    };

    return `
        <div class="criteria-form-container">
            ${isExchange ? `
                <h5 class="form-section-title mb-3">
                    <i class="fa-solid fa-magnifying-glass me-2 text-primary"></i>${labels.sectionTitle}
                </h5>
                <p class="text-muted small mb-4">Beskriv den bolig du ønsker at bytte til.</p>
            ` : ''}

            <div class="mb-4">
                <h6 class="form-subsection-title small fw-bold text-muted text-uppercase mb-3">
                    <i class="fa-solid fa-location-dot me-2 text-primary opacity-75"></i>${labels.geoTitle}
                </h6>

                <div class="area-tag-container" id="area-tag-container-${suffix}">
                    <div class="area-tags-list" id="area-tags-list-${suffix}"></div>
                    <input
                        type="text"
                        class="area-tag-input"
                        id="area-tag-input-${suffix}"
                        placeholder="Indtast postnr. eller område"
                        inputmode="search"
                        maxlength="60"
                    >
                </div>

                <div class="list-group mt-2 d-none" id="area-suggestions-${suffix}" role="listbox" aria-label="Forslag til områder"></div>

                <div class="area-quick-select mt-3 d-flex flex-wrap gap-2" id="quick-select-areas-${suffix}">
                    ${areaGroups.map(g => `
                        <button type="button"
                            class="area-quick-btn"
                            data-area-id="${g.id}"
                            data-area-label="${g.label}"
                            data-suffix="${suffix}">
                            <i class="${g.icon} me-1"></i>${g.label}
                        </button>
                    `).join('')}
                </div>
            </div>

            <div class="criteria-divider"></div>

            <div class="mb-4">
                <h6 class="form-subsection-title small fw-bold text-muted text-uppercase mb-3">
                    <i class="fa-solid fa-wallet me-2 text-primary opacity-75"></i>Økonomi
                </h6>

                <div class="row g-3">
                    <div class="col-md-6">
                        <label class="form-label small fw-bold text-muted text-uppercase ls-1">${labels.priceLabel}</label>
                        <div class="input-group">
                            <div class="form-floating flex-grow-1">
                                <input id="criteria-price-max-${suffix}" class="form-control criteria-currency-input border-end-0" placeholder="F.eks. 1.500.000" type="text" inputmode="numeric" maxlength="12" style="border-top-right-radius: 0; border-bottom-right-radius: 0;">
                                <label for="criteria-price-max-${suffix}" class="text-secondary">Maks. pris</label>
                            </div>
                            <span class="input-group-text bg-white border-start-0 text-secondary opacity-75">kr.</span>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small fw-bold text-muted text-uppercase ls-1">${labels.monthlyLabel}</label>
                        <div class="input-group">
                            <div class="form-floating flex-grow-1">
                                <input id="criteria-monthly-max-${suffix}" class="form-control criteria-currency-input border-end-0" placeholder="F.eks. 5.000" type="text" inputmode="numeric" maxlength="7" style="border-top-right-radius: 0; border-bottom-right-radius: 0;">
                                <label for="criteria-monthly-max-${suffix}" class="text-secondary">Maks. ydelse</label>
                            </div>
                            <span class="input-group-text bg-white border-start-0 text-secondary opacity-75">kr.</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="criteria-divider"></div>

            <div class="mb-2">
                <h6 class="form-subsection-title small fw-bold text-muted text-uppercase mb-3">
                    <i class="fa-solid fa-house me-2 text-primary opacity-75"></i>Boligens detaljer
                </h6>

                <div class="row g-3 mb-3">
                    <div class="col-md-6">
                        <label class="form-label small fw-bold text-muted text-uppercase ls-1">Størrelse (m²)</label>
                        <div class="input-group">
                            <div class="form-floating w-50">
                                <input id="criteria-sqm-min-${suffix}" class="form-control border-end-0" placeholder="Min" type="number" inputmode="numeric" min="0" max="999" style="border-top-right-radius: 0; border-bottom-right-radius: 0;">
                                <label for="criteria-sqm-min-${suffix}">Min.</label>
                            </div>
                            <div class="form-floating w-50">
                                <input id="criteria-sqm-max-${suffix}" class="form-control" placeholder="Max" type="number" inputmode="numeric" min="0" max="999" style="border-top-left-radius: 0; border-bottom-left-radius: 0;">
                                <label for="criteria-sqm-max-${suffix}">Maks.</label>
                            </div>
                        </div>
                    </div>

                    <div class="col-md-6">
                        <label class="form-label small fw-bold text-muted text-uppercase ls-1">Antal værelser</label>
                        <div class="input-group">
                            <div class="form-floating w-50">
                                <input id="criteria-rooms-min-${suffix}" class="form-control border-end-0" placeholder="Min" type="number" inputmode="numeric" min="0" max="19" style="border-top-right-radius: 0; border-bottom-right-radius: 0;">
                                <label for="criteria-rooms-min-${suffix}">Min.</label>
                            </div>
                            <div class="form-floating w-50">
                                <input id="criteria-rooms-max-${suffix}" class="form-control" placeholder="Max" type="number" inputmode="numeric" min="0" max="19" style="border-top-left-radius: 0; border-bottom-left-radius: 0;">
                                <label for="criteria-rooms-max-${suffix}">Maks.</label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Sets up the Area Tag logic (Smart Områdevælger) for the given suffix.
 * Must be called after the criteria form HTML is in the DOM.
 * @param {string} suffix
 */
export function setupAreaTagLogic(suffix = 'criteria') {
    const set = _getAreaSet(suffix);
    const $container = $(`#area-tag-container-${suffix}`);
    const $input = $(`#area-tag-input-${suffix}`);
    const $suggestions = $(`#area-suggestions-${suffix}`);
    const eventNamespace = `.area-tags-${suffix}`;

    if (!$input.length) return;

    let visibleSuggestions = [];
    let highlightedIndex = -1;
    let isSelectingSuggestion = false;

    function hideSuggestions() {
        visibleSuggestions = [];
        highlightedIndex = -1;
        $suggestions.addClass('d-none').empty();
    }

    function setHighlightedIndex(nextIndex) {
        highlightedIndex = nextIndex;
        $suggestions.children('.area-suggestion-item').removeClass('active');
        if (highlightedIndex >= 0) {
            $suggestions.children('.area-suggestion-item').eq(highlightedIndex).addClass('active');
        }
    }

    function scoreSuggestion(option, query) {
        if (option.id === query) return 0;
        if (option.label.toLowerCase().startsWith(query)) return 1;
        if (option.searchText.startsWith(query)) return 2;
        return 3;
    }

    function renderSuggestions(rawQuery) {
        const query = normalizeAreaId(rawQuery).toLowerCase();
        if (!query) {
            hideSuggestions();
            return;
        }

        visibleSuggestions = areaAutocompleteOptions
            .filter(option => option.searchText.includes(query))
            .sort((a, b) => scoreSuggestion(a, query) - scoreSuggestion(b, query))
            .slice(0, 8);

        if (!visibleSuggestions.length) {
            hideSuggestions();
            return;
        }

        const html = visibleSuggestions.map((option, index) => `
            <button
                type="button"
                class="list-group-item list-group-item-action area-suggestion-item"
                data-id="${escapeHtml(option.id)}"
                role="option"
                aria-selected="${index === 0 ? 'true' : 'false'}"
            >
                ${escapeHtml(option.label)}
            </button>
        `).join('');

        $suggestions.removeClass('d-none').html(html);
        setHighlightedIndex(0);
    }

    function selectSuggestionById(id) {
        const normalizedId = normalizeAreaId(id);
        if (!normalizedId) return;
        const currentQuery = $input.val();
        addArea(normalizedId);
        // Restore input value and re-render suggestions so user can keep picking
        $input.val(currentQuery);
        renderSuggestions(currentQuery);
    }

    function renderTags() {
        const $list = $(`#area-tags-list-${suffix}`);
        $list.empty();
        set.forEach(rawId => {
            const id = normalizeAreaId(rawId);
            if (!id) return;
            // Find human label
            const group = areaGroups.find(g => normalizeAreaId(g.id) === id);
            const label = group ? group.label : (postalData[id] ? `${id} - ${postalData[id]}` : id);
            const $tag = $(`
                <span class="area-tag">
                    <span class="area-tag-label">${label}</span>
                    <button type="button" class="remove-tag" data-id="${id}" aria-label="Fjern ${label}">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </span>
            `);
            $tag.find('.remove-tag').on('click', function() {
                const removeId = normalizeAreaId($(this).attr('data-id'));
                set.delete(removeId);
                renderTags();
                syncQuickSelectButtons(suffix);
            });
            $list.append($tag);
        });
    }

    function addArea(id) {
        const normalizedId = normalizeAreaId(id);
        if (!normalizedId) return;
        set.add(normalizedId);
        renderTags();
        syncQuickSelectButtons(suffix);
        $input.val('');
        $input.focus();
    }

    $input.off(eventNamespace).on(`keydown${eventNamespace}`, function(e) {
        if (e.key === 'ArrowDown' && visibleSuggestions.length) {
            e.preventDefault();
            const next = highlightedIndex < visibleSuggestions.length - 1 ? highlightedIndex + 1 : 0;
            setHighlightedIndex(next);
            return;
        }

        if (e.key === 'ArrowUp' && visibleSuggestions.length) {
            e.preventDefault();
            const next = highlightedIndex > 0 ? highlightedIndex - 1 : visibleSuggestions.length - 1;
            setHighlightedIndex(next);
            return;
        }

        if (e.key === 'Escape' && visibleSuggestions.length) {
            e.preventDefault();
            hideSuggestions();
            return;
        }

        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();

            if (visibleSuggestions.length) {
                const selected = visibleSuggestions[highlightedIndex] || visibleSuggestions[0];
                if (selected) {
                    selectSuggestionById(selected.id);
                    return;
                }
            }

            const val = $(this).val().trim();
            if (/^\d{4}$/.test(val)) {
                addArea(val);
            } else if (val.length > 0) {
                $container.addClass('shake');
                setTimeout(() => $container.removeClass('shake'), 400);
            }
        }
    });

    $input.on(`input${eventNamespace}`, function() {
        renderSuggestions($(this).val());
    });

    $suggestions.off(eventNamespace).on(`mousedown${eventNamespace}`, '.area-suggestion-item', function(e) {
        e.preventDefault();
        e.stopPropagation();
        isSelectingSuggestion = true;
        selectSuggestionById($(this).attr('data-id'));

        window.setTimeout(() => {
            isSelectingSuggestion = false;
        }, 0);
    });

    $(document)
        .off(`mousedown.area-suggestions-${suffix}`)
        .on(`mousedown.area-suggestions-${suffix}`, function(e) {
            if (isSelectingSuggestion) return;
            const isInside = $(e.target).closest(`#area-tag-container-${suffix}, #area-suggestions-${suffix}`).length;
            if (!isInside) hideSuggestions();
        });

    // Focus the container on click (outside tags)
    $container.off(eventNamespace).on(`click${eventNamespace}`, function(e) {
        if (!$(e.target).closest('.area-tag').length) {
            $input.focus();
        }
    });

    // Quick-select buttons
    $(`#quick-select-areas-${suffix} .area-quick-btn`)
        .off(eventNamespace)
        .on(`click${eventNamespace}`, function() {
            const id = normalizeAreaId($(this).attr('data-area-id'));
            if (!id) return;
            if (set.has(id)) {
                set.delete(id);
            } else {
                set.add(id);
            }
            renderTags();
            syncQuickSelectButtons(suffix);
        });

    syncQuickSelectButtons(suffix);
}

function syncQuickSelectButtons(suffix) {
    const set = _getAreaSet(suffix);
    $(`#quick-select-areas-${suffix} .area-quick-btn`).each(function() {
        const id = normalizeAreaId($(this).attr('data-area-id'));
        $(this).toggleClass('active', set.has(id));
    });
}

/**
 * Returns an array of selected area IDs/postal codes for the given suffix.
 * @param {string} suffix
 * @returns {string[]}
 */
export function getSelectedAreas(suffix = 'criteria') {
    return Array.from(_getAreaSet(suffix)).map(id =>
        /^\d+$/.test(id) ? parseInt(id, 10) : id
    );
}

/**
 * Clears and sets the selected areas (used when populating existing data).
 * @param {string} suffix
 * @param {string[]} areas
 */
export function setSelectedAreas(suffix = 'criteria', areas = []) {
    const set = _getAreaSet(suffix);
    set.clear();
    areas.forEach(a => {
        const normalizedId = normalizeAreaId(a);
        if (normalizedId) set.add(normalizedId);
    });
    // Re-render if DOM is ready
    const $list = $(`#area-tags-list-${suffix}`);
    if ($list.length) {
        // Trigger render by rebuilding
        const suffixCopy = suffix;
        setTimeout(() => {
            // setupAreaTagLogic may not have run yet — just update after a tick
            $list.empty();
            set.forEach(rawId => {
                const id = normalizeAreaId(rawId);
                if (!id) return;
                const group = areaGroups.find(g => normalizeAreaId(g.id) === id);
                const label = group ? group.label : (postalData[id] ? `${id} - ${postalData[id]}` : id);
                const $tag = $(`
                    <span class="area-tag">
                        <span class="area-tag-label">${label}</span>
                        <button type="button" class="remove-tag" data-id="${id}" aria-label="Fjern ${label}">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </span>
                `);
                $tag.find('.remove-tag').on('click', function() {
                    const removeId = normalizeAreaId($(this).attr('data-id'));
                    set.delete(removeId);
                    $tag.remove();
                    syncQuickSelectButtons(suffixCopy);
                });
                $list.append($tag);
            });
            syncQuickSelectButtons(suffixCopy);
        }, 0);
    }
}

/**
 * Sets up currency formatting for criteria form inputs
 * @param {string} suffix - The suffix used when generating the form
 */
export function setupCriteriaCurrencyFormatters(suffix = 'criteria') {
    const currencyInputs = document.querySelectorAll(`#criteria-price-max-${suffix}, #criteria-monthly-max-${suffix}`);

    currencyInputs.forEach(input => {
        if (!input) return;

        input.addEventListener('input', (e) => {
            // Remove all non-digits
            let val = e.target.value.replace(/\D/g, '');

            // Format with Danish thousand separators
            if (val !== '') {
                e.target.value = new Intl.NumberFormat('da-DK').format(val);
            }
        });
    });
}

/**
 * Extracts criteria values from the form
 * @param {string} suffix - The suffix used when generating the form
 * @returns {object} Criteria object matching backend model
 */
export function getCriteriaValues(suffix = 'criteria') {
    const parseFormattedNumber = (id) => {
        const el = document.getElementById(id);
        if (!el || !el.value) return null;
        const val = parseInt(el.value.replace(/\D/g, ''));
        return isNaN(val) ? null : val;
    };

    const getNumberValue = (id) => {
        const el = document.getElementById(id);
        if (!el || !el.value) return null;
        const val = parseInt(el.value);
        return isNaN(val) ? null : val;
    };

    return {
        areas: getSelectedAreas(suffix),
        price_from: null,                                 // Deprecated
        price_to: parseFormattedNumber(`criteria-price-max-${suffix}`),
        monthly_price_from: null,                         // Deprecated
        monthly_price_to: parseFormattedNumber(`criteria-monthly-max-${suffix}`),
        square_meters_from: getNumberValue(`criteria-sqm-min-${suffix}`),
        square_meters_to: getNumberValue(`criteria-sqm-max-${suffix}`),
        rooms_from: getNumberValue(`criteria-rooms-min-${suffix}`),
        rooms_to: getNumberValue(`criteria-rooms-max-${suffix}`)
    };
}

/**
 * Checks whether at least one search criterion has been configured.
 * Supports both the current `areas` model and legacy location fields.
 * @param {object} criteria
 * @returns {boolean}
 */
export function hasConfiguredCriteria(criteria) {
    if (!criteria || typeof criteria !== 'object') return false;

    const hasNonEmptyValue = (value) => {
        if (value == null) return false;
        if (typeof value === 'string') return value.trim() !== '';
        return true;
    };

    if (Array.isArray(criteria.areas) && criteria.areas.some(area => normalizeAreaId(area) !== '')) return true;

    const numericOrLocationKeys = [
        'price_to',
        'monthly_price_to',
        'square_meters_from', 'square_meters_to',
        'rooms_from', 'rooms_to'
    ];

    if (numericOrLocationKeys.some(key => hasNonEmptyValue(criteria[key]))) return true;

    return false;
}

export function hasRequiredExchangeCriteria(criteria) {
    if (!criteria || typeof criteria !== 'object') return false;

    const hasArea = Array.isArray(criteria.areas)
        && criteria.areas.some(area => normalizeAreaId(area) !== '');

    const hasPositiveNumber = (value) => {
        if (value == null) return false;
        const numberValue = Number(value);
        return Number.isFinite(numberValue) && numberValue > 0;
    };

    const hasAdditionalPreference = [
        'price_to',
        'monthly_price_to',
        'square_meters_from',
        'square_meters_to',
        'rooms_from',
        'rooms_to'
    ].some(key => hasPositiveNumber(criteria[key]));

    return hasArea && hasAdditionalPreference;
}

export function hasRequiredAgentCriteria(criteria, exchangeOnly = false) {
    if (exchangeOnly) return hasRequiredExchangeCriteria(criteria);
    if (!criteria || typeof criteria !== 'object') return false;

    const hasArea = Array.isArray(criteria.areas)
        && criteria.areas.some(area => normalizeAreaId(area) !== '');

    if (hasArea) return true;

    const hasPositiveNumber = (value) => {
        if (value == null) return false;
        const numberValue = Number(value);
        return Number.isFinite(numberValue) && numberValue > 0;
    };

    return [
        'price_to',
        'monthly_price_to',
        'square_meters_from',
        'square_meters_to',
        'rooms_from',
        'rooms_to'
    ].some(key => hasPositiveNumber(criteria[key]));
}

/**
 * Populates criteria form with existing values
 * @param {object} criteria - Criteria object from backend
 * @param {string} suffix - The suffix used when generating the form
 */
export function populateCriteriaForm(criteria, suffix = 'criteria') {
    if (!criteria) return;

    const setFormattedValue = (id, value) => {
        const el = document.getElementById(id);
        if (el && value != null) {
            el.value = new Intl.NumberFormat('da-DK').format(value);
        }
    };

    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el && value != null) {
            el.value = value;
        }
    };

    if (criteria.areas && Array.isArray(criteria.areas) && criteria.areas.length > 0) {
        setSelectedAreas(suffix, criteria.areas);
    }

    setFormattedValue(`criteria-price-max-${suffix}`, criteria.price_to);
    setFormattedValue(`criteria-monthly-max-${suffix}`, criteria.monthly_price_to);

    // Populate all physical boundaries
    setValue(`criteria-sqm-min-${suffix}`, criteria.square_meters_from);
    setValue(`criteria-sqm-max-${suffix}`, criteria.square_meters_to);
    setValue(`criteria-rooms-min-${suffix}`, criteria.rooms_from);
    setValue(`criteria-rooms-max-${suffix}`, criteria.rooms_to);
}
