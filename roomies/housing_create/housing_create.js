import { authFetch } from "../auth/auth.js";
import {
    currentUser,
    decodeJwt,
    displayErrorMessage,
    displaySuccessMessage, isLoggedIn,
    showConfirmationModal
} from "../utils.js";
import {displayLoginModal, showView} from "../views/viewManager.js";
import {
    updateLocalHousing,
    activateByteMatchMode
} from "../housing_list/housing_list.js";
import {s3Url} from "../config/config.js";
import {
    generateCriteriaForm,
    setupCriteriaCurrencyFormatters,
    getCriteriaValues,
    hasRequiredExchangeCriteria,
    EXCHANGE_CRITERIA_REQUIRED_MESSAGE,
    populateCriteriaForm,
    setupAreaTagLogic,
    getSelectedAreas
} from "../components/criteria_form.js";


// Global State variables ...
let currentImages = [];
let activeHousingId = null;
export let usersCurrentActiveHousing = null; // New global variable to store the users created housing
let currentSwapAgent = null;
let location = null;
let isDragDropSetup = false;
const SESSION_KEY = 'temp_create_housing_data';
let isHousingVisible = false; // New global state for visibility
let lastLoadedUser = null;
let createHousingDataLoaded = false;
let createHousingDataPromise = null;
let createHousingDataPromiseUserId = null;

export function setupCreateHousingView() {
    setupAddressAutocomplete();
    setupCurrencyFormatters();
    setupImageHandling();
    setupExchangeToggle();
    setupUpsellPackageSelection();
    setupFormSubmit();
    setupDeleteHandler();
    setupVisibilityHandler();
    setupAdminStatusListeners();
    setupPetsAllowedToggle();
}

export function preloadCreateHousingData(options = {}) {
    return ensureHousingDataLoaded(options.forceReload === true);
}

function setupUpsellPackageSelection() {
    const radios = document.querySelectorAll('input[name="modal_marketing_package"]');
    if (radios.length === 0) return;

    radios.forEach(radio => {
        radio.addEventListener('change', syncUpsellPackageButtons);
    });

    syncUpsellPackageButtons();
}

function syncUpsellPackageButtons() {
    document.querySelectorAll('.upsell-modal-card').forEach(card => {
        const radio = card.querySelector('input[name="modal_marketing_package"]');
        const button = card.querySelector('.upsell-btn');
        if (!radio || !button) return;

        if (radio.checked) {
            button.innerHTML = '<i class="fa-solid fa-check me-2"></i>Valgt';
            return;
        }

        button.textContent = button.dataset.defaultLabel || 'Vælg pakke';
    });
}

function updatePetsAllowedLabel() {
    const checkbox = document.getElementById('pets_allowed_create');
    const label = document.getElementById('pets_allowed_create_label');
    if (!checkbox || !label) return;
    label.textContent = checkbox.checked ? 'Husdyr tilladt' : 'Husdyr ikke tilladt';
}

function setupPetsAllowedToggle() {
    const checkbox = document.getElementById('pets_allowed_create');
    if (!checkbox) return;
    checkbox.addEventListener('change', updatePetsAllowedLabel);
    updatePetsAllowedLabel(); // Sync on setup
}

export async function performPopulateHousing() {
    if (isLoggedIn()) {
        const jwt = decodeJwt();
        const response = await authFetch(`/advertisement/${jwt.sub}?query_by_created_by=true`);

        if (!response.ok && response.status !== 204) {
            displayErrorMessage("Der opstod en fejl");
            return;
        }

        if (response.status === 204) {
            return;
        }

        const stored_housing = await response.json();

        if (stored_housing) {
            activeHousingId = stored_housing._id;
            usersCurrentActiveHousing = stored_housing; // Store in global variable

            // Opdater det globale cache-array med det nyeste fetch!
            updateLocalHousing(stored_housing);

            // Population now handles exchange data directly from the housing object
            populateHousingData(stored_housing);
            updateAdminDashboardUI(stored_housing);

            document.getElementById('deleteHousingBtn').classList.remove('d-none');
            document.getElementById('deleteHousingBtn').dataset.housingId = stored_housing._id;

            const viewBtn = document.getElementById('viewHousingBtn');

            // Dont show "Se din annonce" for housings with visible = false
            if (stored_housing.visible) {
                viewBtn.classList.remove('d-none');
                viewBtn.onclick = (e) => {
                    e.preventDefault();
                    showView('detail', new URLSearchParams({ id: stored_housing._id }));
                };
            } else {
                viewBtn.classList.add('d-none');
            }
        }
    }
}

// 1. Update resetForm to hide the new button
function resetForm() {
    document.getElementById('form-create').reset();
    currentImages = [];
    activeHousingId = null;
    currentSwapAgent = null; // Reset agent
    isHousingVisible = false; // Reset visibility
    document.getElementById('imagePreview_create').innerHTML = '';
    document.getElementById('address-dropdown').style.display = 'none';

    // Hide conditional buttons (Delete & View)
    const deleteBtn = document.getElementById('deleteHousingBtn');
    if (deleteBtn) deleteBtn.classList.add('d-none');

    // NEW: Hide View Button
    const viewBtn = document.getElementById('viewHousingBtn');
    if (viewBtn) viewBtn.classList.add('d-none');

    // Reset hidden currency inputs
    ['price_create', 'monthly_fee_create', 'improvements_price_create'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    // Reset Exchange toggle and criteria
    const exchangeToggle = document.getElementById('exchange_toggle');
    if (exchangeToggle) exchangeToggle.checked = false;

    const exchangeContainer = document.getElementById('exchange-criteria-container');
    if (exchangeContainer) {
        exchangeContainer.innerHTML = '';
        exchangeContainer.classList.remove('active', 'expanded');
        exchangeContainer.style.maxHeight = '';
    }
    const infoContainer = document.getElementById('exchange-info-container');
    if (infoContainer) {
        infoContainer.classList.remove('active');
        infoContainer.style.maxHeight = '';
    }
    // Skjul dashboardet ved at sende null
    updateAdminDashboardUI(null);
}

function getCurrentCreateUserId() {
    const user = decodeJwt();
    return user ? user.sub : null;
}

/* -------------------------------------------------------------------------- */
/* Data Loading (Edit Mode & Session Restore)                                 */
/* -------------------------------------------------------------------------- */
function populateHousingData(stored_housing) {
    location = stored_housing.location
    isHousingVisible = stored_housing.visible === true;
    updateVisibilityUI();
    // Text & Number Inputs
    const textFields = {
        "datafordeler_id": stored_housing.datafordeler_id,
        "postal_name": stored_housing.postal_name,
        "street_name": stored_housing.street_name,
        "house_number": stored_housing.house_number,
        'title_create': stored_housing.title,
        'description_create': stored_housing.description,
        'address_create': stored_housing.address,
        'square_meters_create': stored_housing.square_meters,
        'rooms_create': stored_housing.rooms,
        'construction_year_create': stored_housing.construction_year,
        'energy_label_create': stored_housing.energy_label,
        'floor_create': stored_housing.floor,
        'side_create': stored_housing.floor_side
    };

    for (const [id, value] of Object.entries(textFields)) {
        const el = document.getElementById(id);
        if (el && value) {
            el.value = value;
        }
    }

    // Handle Postnr & City (Combined display)
    if (stored_housing.postal_number && stored_housing.city) {
        const zipCityEl = document.getElementById('zip_city_create');
        if (zipCityEl) {
            zipCityEl.value = `${stored_housing.postal_number} - ${stored_housing.city}`;
        }
    }

    // Formatted Money Inputs
    updateCurrencyField('display_price_create', stored_housing.price);
    updateCurrencyField('display_monthly_fee_create', stored_housing.monthly_fee);
    updateCurrencyField('display_improvements_price_create', stored_housing.improvements_price);

    // Checkboxes / Facilities
    const checkboxes = {
        'pets_allowed_create': stored_housing.pets_allowed,
        'balcony_create': stored_housing.balcony,
        'parking_included_create': stored_housing.parking_included,
        'elevator_create': stored_housing.elevator,
        'located_at_top_create': stored_housing.located_at_top,
        'smoke_free_create': stored_housing.smoke_free,
    };

    for (const [id, isChecked] of Object.entries(checkboxes)) {
        const el = document.getElementById(id);
        if (el) {
            // Nu gennemtvinger vi enten true eller false (ved at bruge !!),
            // så den også fjerner standard-fluebenet, hvis isChecked er false.
            el.checked = !!isChecked;
        }
    }

    // Sync pets_allowed label text to the loaded checkbox state
    updatePetsAllowedLabel();

    // Load Existing Images
    if (stored_housing.images && Array.isArray(stored_housing.images)) {
        currentImages = []
        stored_housing.images.forEach(img => {
            currentImages.push({
                type: 'existing',
                name: img.name,
                thumbnail_name: img.thumbnail_name,
                url: `${s3Url}/${img.thumbnail_name}`,
                status: 'uploaded'
            });
        });
        renderImagePreviews();
    }

    // Refactored: Load Exchange (Swap) data
    // We check for criteria regardless of exchange_only flag to ensure persistence
    if (stored_housing.exchange_criteria) {
        // 1. Render the form (Hidden by default unless expanded)
        const container = document.getElementById('exchange-criteria-container');
        if (container) {
            container.innerHTML = generateCriteriaForm('Exchange', 'Exchange');
            setupAreaTagLogic('Exchange');
            setupCriteriaCurrencyFormatters('Exchange');
            populateCriteriaForm(stored_housing.exchange_criteria, 'Exchange');
        }

        // 2. Set Toggle State & Visibility
        const toggle = document.getElementById('exchange_toggle');
        if (toggle) {
            toggle.checked = stored_housing.exchange_only;

            if (stored_housing.exchange_only) {
                // If active, expand the UI
                if (container) {
                    container.classList.add('active', 'expanded');
                    container.style.maxHeight = 'none';
                }
                const infoContainer = document.getElementById('exchange-info-container');
                if (infoContainer) {
                    infoContainer.classList.add('active');
                    infoContainer.style.maxHeight = 'none';
                }
            } else {
                // Ensure collapsed but populated
                if (container) {
                    container.classList.remove('active', 'expanded');
                    container.style.maxHeight = '';
                }
            }
        }
    }
}

function updateCurrencyField(displayId, value) {
    if (!value) return;
    const displayInput = document.getElementById(displayId);
    const hiddenInput = document.getElementById(displayId.replace('display_', ''));

    if (displayInput && hiddenInput) {
        displayInput.value = value;
        hiddenInput.value = value;
        // Trigger formatting
        displayInput.dispatchEvent(new Event('input'));
    }
}
function restoreSessionData() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;

    try {
        const data = JSON.parse(raw);
        // Populate housing directly from session data
        populateHousingData(data);
    } catch (e) {
        console.error("Failed to restore session data", e);
    }
}
/* -------------------------------------------------------------------------- */
/* Submit Logic (Unified & Simplified)                                        */
/* -------------------------------------------------------------------------- */

// Helper to gather form data (used for both Save-to-Session and Submit)
function getFormData() {
    // Extract Postal Code and City from the combined input
    const zipCityValue = document.getElementById('zip_city_create').value || '';
    let postalNumber = null;
    let cityValue = null;

    if (zipCityValue.includes(' - ')) {
        const parts = zipCityValue.split(' - ');
        postalNumber = parseInt(parts[0].trim());
        cityValue = parts[1].trim();
    }

    // Check exchange toggle
    const isExchange = document.getElementById('exchange_toggle')?.checked || false;

    return {
        title: document.getElementById('title_create').value,
        description: document.getElementById('description_create').value,

        // Parse numbers to ensure they are sent as Integers/Floats
        price: parseInt(document.getElementById('price_create').value) || 0,
        monthly_fee: parseInt(document.getElementById('monthly_fee_create').value) || 0,
        improvements_price: parseInt(document.getElementById('improvements_price_create').value) || 0,

        square_meters: parseInt(document.getElementById('square_meters_create').value) || 0,
        rooms: parseInt(document.getElementById('rooms_create').value) || 0,

        // Optional text fields
        construction_year: document.getElementById('construction_year_create').value || null,
        energy_label: document.getElementById('energy_label_create').value || null,

        datafordeler_id: document.getElementById('datafordeler_id').value || null,
        postal_name: document.getElementById('postal_name').value || null,
        street_name: document.getElementById('street_name').value || null,
        house_number: document.getElementById('house_number').value || null,
        floor: document.getElementById('floor_create').value || null,
        floor_side: document.getElementById('side_create').value || null,
        city: cityValue,
        postal_number: postalNumber,
        address: document.getElementById('address_create').value,
        location: location,

        // Facilities (Booleans)
        pets_allowed: document.getElementById('pets_allowed_create').checked,
        balcony: document.getElementById('balcony_create').checked,
        parking_included: document.getElementById('parking_included_create').checked,
        elevator: document.getElementById('elevator_create').checked,
        located_at_top: document.getElementById('located_at_top_create').checked,
        smoke_free: document.getElementById('smoke_free_create')?.checked,

        // Images: Only uploaded ones are safe to save/send
        images: currentImages
            .filter(img => img.status === 'uploaded')
            .map(img => ({
                name: img.name,
                thumbnail_name: img.thumbnail_name
            })),

        // Exchange Data (Refactored: Always capture criteria to allow persistence)
        exchange_only: isExchange,
        exchange_criteria: getCriteriaValues('Exchange'),

        // Hvis brugeren redigerer en annonce, beholder vi dens nuværende status. Ellers false.
        reserved: usersCurrentActiveHousing ? !!usersCurrentActiveHousing.reserved : false,
        sold: usersCurrentActiveHousing ? !!usersCurrentActiveHousing.sold : false,

        marketing_package: usersCurrentActiveHousing?.marketing_package ? usersCurrentActiveHousing.marketing_package : "free"
    };
}

function validateExchangeCriteriaBeforeSubmit() {
    const isExchange = document.getElementById('exchange_toggle')?.checked || false;
    if (!isExchange) return true;

    const criteria = getCriteriaValues('Exchange');
    if (hasRequiredExchangeCriteria(criteria)) return true;

    const container = document.getElementById('exchange-criteria-container');
    const infoContainer = document.getElementById('exchange-info-container');

    if (container) {
        container.classList.add('active', 'expanded');
        container.style.maxHeight = 'none';
        container.scrollIntoView({behavior: 'smooth', block: 'center'});
    }

    if (infoContainer) {
        infoContainer.classList.add('active');
        infoContainer.style.maxHeight = 'none';
    }

    document.getElementById('area-tag-input-Exchange')?.focus({preventScroll: true});
    displayErrorMessage(EXCHANGE_CRITERIA_REQUIRED_MESSAGE, 12000);
    return false;
}

function hasSelectedStructuredAddress() {
    const requiredFieldIds = [
        'datafordeler_id',
        'postal_name',
        'street_name',
        'house_number'
    ];

    const hasRequiredStructuredFields = requiredFieldIds.every(id => {
        const value = document.getElementById(id)?.value;
        return typeof value === 'string' && value.trim() !== '';
    });

    const zipCityValue = document.getElementById('zip_city_create')?.value || '';
    return hasRequiredStructuredFields && /^\d{4}\s+-\s+.+/.test(zipCityValue.trim());
}

function clearStructuredAddressFields() {
    ['datafordeler_id', 'postal_name', 'street_name', 'house_number'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    location = null;
}

function focusAddressField() {
    const addressInput = document.getElementById('address_create');
    if (!addressInput) return;

    addressInput.scrollIntoView({behavior: 'smooth', block: 'center'});
    window.setTimeout(() => {
        addressInput.focus({preventScroll: true});
        addressInput.select();
    }, 350);
}

function promptMissingStructuredAddress(onContinueAnyway) {
    showConfirmationModal(
        'Vælg adresse fra listen',
        'Vi kan se, at adressen ikke er valgt fra adresseforslagene.\n\nVælg gerne adressen fra listen, så boligen bliver vist korrekt og for flest mulige købere.',
        focusAddressField,
        'btn-primary'
    );

    const $modal = $('#genericConfirmationModal');
    const $confirmButton = $('#confirmActionButton');
    const $cancelButton = $modal.find('[data-bs-dismiss="modal"]').first();

    const originalConfirmText = $confirmButton.html();
    const originalCancelText = $cancelButton.html();
    let shouldContinueAnyway = false;

    $confirmButton.html('<i class="fa-solid fa-location-dot me-2"></i>Ret adresse');
    $cancelButton.text('Fortsæt alligevel');

    $cancelButton.off('click.address-warning').on('click.address-warning', () => {
        shouldContinueAnyway = true;
    });

    $modal.off('hidden.bs.modal.address-warning').one('hidden.bs.modal.address-warning', async () => {
        $cancelButton.off('click.address-warning');
        $confirmButton.html(originalConfirmText);
        $cancelButton.html(originalCancelText);

        if (shouldContinueAnyway) {
            await onContinueAnyway();
        }
    });
}

function descriptionSuggestsExchangeListing() {
    const exchangeToggle = document.getElementById('exchange_toggle');
    if (exchangeToggle?.checked) return false;

    const title = document.getElementById('title_create')?.value || '';
    const description = document.getElementById('description_create')?.value || '';
    const text = `${title} ${description}`.toLocaleLowerCase('da-DK');

    return /(^|[^a-zæøå])bytte[a-zæøå]*|(^|[^a-zæøå])boligbytte([^a-zæøå]|$)/i.test(text);
}

function enableExchangeCriteriaFromPrompt() {
    const exchangeToggle = document.getElementById('exchange_toggle');
    if (!exchangeToggle) return;

    exchangeToggle.checked = true;
    exchangeToggle.dispatchEvent(new Event('change'));

    window.setTimeout(() => {
        const container = document.getElementById('exchange-criteria-container');
        if (container) {
            container.scrollIntoView({behavior: 'smooth', block: 'center'});
        }
        document.getElementById('area-tag-input-Exchange')?.focus({preventScroll: true});
    }, 150);
}

function promptPossibleExchangeListing(onContinueAsSale) {
    showConfirmationModal(
        'Er det en bytteannonce?',
        'Du nævner "bytte" i annoncen, men annoncen er ikke markeret som bytte.\n\nHvis det er en bytteannonce, kan andre bedre matche med dig, når du udfylder dine bytteønsker.',
        enableExchangeCriteriaFromPrompt,
        'btn-primary'
    );

    const $modal = $('#genericConfirmationModal');
    const $confirmButton = $('#confirmActionButton');
    const $cancelButton = $modal.find('[data-bs-dismiss="modal"]').first();

    const originalConfirmText = $confirmButton.html();
    const originalCancelText = $cancelButton.html();
    let shouldContinueAsSale = false;

    $confirmButton.html('<i class="fa-solid fa-right-left me-2"></i>Ja, markér som bytte');
    $cancelButton.text('Nej, fortsæt som salg');

    $cancelButton.off('click.possible-exchange').on('click.possible-exchange', () => {
        shouldContinueAsSale = true;
    });

    $modal.off('hidden.bs.modal.possible-exchange').one('hidden.bs.modal.possible-exchange', async () => {
        $cancelButton.off('click.possible-exchange');
        $confirmButton.html(originalConfirmText);
        $cancelButton.html(originalCancelText);

        if (shouldContinueAsSale) {
            await onContinueAsSale();
        }
    });
}

/* -------------------------------------------------------------------------- */
/* Submit Logic (Med Upsell Modal & Stripe Integration)                       */
/* -------------------------------------------------------------------------- */

async function setupFormSubmit() {
    const form = document.getElementById('form-create');

    // Hent modal og knap-elementer fra DOM
    const upsellModalElement = document.getElementById('upsellModal');
    // For at forhindre crash, hvis HTML'en mangler, tjekker vi om elementet findes:
    const upsellModal = upsellModalElement ? new bootstrap.Modal(upsellModalElement) : null;
    const btnConfirmAndCreate = document.getElementById('btn-confirm-and-create');

    // 1. Lyt på den oprindelige form submit (når brugeren trykker 'Opret Annonce' i bunden af siden)
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await continueCreateSubmit(false);
    });

    async function continueCreateSubmit(skipPossibleExchangePrompt, skipAddressWarning = false) {
        // A. Validering af formular
        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            displayErrorMessage("Udfyld venligst alle påkrævede felter.");
            return;
        }

        if (!skipAddressWarning && !hasSelectedStructuredAddress()) {
            promptMissingStructuredAddress(() => continueCreateSubmit(skipPossibleExchangePrompt, true));
            return;
        }

        if (currentImages.some(img => img.status === 'uploading')) {
            displayErrorMessage("Vent venligst til alle billeder er uploadet.");
            return;
        }

        if (!validateExchangeCriteriaBeforeSubmit()) {
            return;
        }

        if (!skipPossibleExchangePrompt && descriptionSuggestsExchangeListing()) {
            promptPossibleExchangeListing(() => continueCreateSubmit(true, true));
            return;
        }

        // B. Tjek Login-status FØR vi viser upsell (så de ikke vælger pakke forgæves)
        if (!isLoggedIn()) {
            const payload = getFormData();
            localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
            displayLoginModal('create');
            return;
        }

        // C. Vis Upsell Modalen (hvis brugeren opretter ny annonce).
        // Hvis vi bare redigerer (activeHousingId findes), skipper vi ofte upsell.
        if (upsellModal && !activeHousingId) {
            upsellModal.show();
        } else {
            // Fallback: Direkte oprettelse/opdatering (hvis ingen modal findes, eller hvis vi bare opdaterer eksisterende)
            await executeSubmission("free");
        }
    }

    // 2. Lyt på "Opret Annonce Nu" knappen INDE i modalen
    if (btnConfirmAndCreate) {
        btnConfirmAndCreate.addEventListener('click', async function() {
            // Aflæs den valgte marketingpakke
            const selectedPackageRadio = document.querySelector('input[name="modal_marketing_package"]:checked');
            const selectedPackage = selectedPackageRadio ? selectedPackageRadio.value : "free";

            // Sæt knappen til loading-tilstand for at forhindre dobbeltklik
            const originalText = btnConfirmAndCreate.innerHTML;
            btnConfirmAndCreate.disabled = true;
            btnConfirmAndCreate.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i>Forbereder...';

            try {
                // Udfør selve API kaldet
                await executeSubmission(selectedPackage);

                // Skjul modalen, hvis alt gik godt (og det var gratis pakken)
                if (selectedPackage === "free") {
                    upsellModal.hide();
                }
            } catch (err) {
                console.error("Fejl i opsætning:", err);
            } finally {
                // Reset knap (hvis vi får en fejl, eller det var gratis pakken)
                btnConfirmAndCreate.disabled = false;
                btnConfirmAndCreate.innerHTML = originalText;
            }
        });
    }
}


// Hjælpefunktion der udfører selve netværkskaldet til backenden (API'et)
async function executeSubmission(marketingPackage) {
    // 1. Byg payload med alt indtastet data
    const payload = getFormData();

    // Tilføj den valgte marketingpakke til vores payload
    payload.marketing_package = marketingPackage;

    // 2. Send Annoncen til FastAPI Backend
    const response = await authFetch("/advertisement", {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (response.status === 401) {
        displayErrorMessage("Du skal logge ind først");
        throw new Error("Unauthorized");
    }

    if (!response.ok) {
        displayErrorMessage("Der gik noget galt ved oprettelse af annoncen");
        throw new Error("API Error");
    }

    // 3. Modtag svar fra backenden
    const responseData = await response.json();

    // Sikker håndtering afhængig af hvordan din backend returnerer data:
    // Formoder at data enten er et ID string, eller det nye JSON objekt: { _id: "...", stripe_checkout_url: "..." }
    const savedHousingId = typeof responseData === 'object' ? responseData._id : responseData;

    // Ryd op i lokal session backup
    localStorage.removeItem(SESSION_KEY);

    // 4. STRIPE REDIRECT (Hvis en betalt pakke blev valgt)
    if (marketingPackage !== "free" && responseData.stripe_checkout_url) {
        const modalBtn = document.getElementById('btn-confirm-and-create');
        if (modalBtn) modalBtn.innerHTML = '<i class="fa-solid fa-lock me-2"></i>Viderestiller til betaling...';

        // Viderestil brugeren fysisk til Stripe
        window.location.href = responseData.stripe_checkout_url;
        return; // Afbryd funktionen, så vi ikke viser standard success-besked
    }

    // 5. STANDARD GRATIS FLOW (eller hvis vi bare opdaterer annoncen)
    displaySuccessMessage(activeHousingId ? "Annonce opdateret" : "Annonce oprettet!");

    const response2 = await authFetch(`/advertisement/${savedHousingId}`);
    const new_updated_housing = await response2.json();
    updateLocalHousing(new_updated_housing);

    // Refresh BytteMatch swap-housing reference so the listing view
    // picks up any changes to the user's exchange criteria / status.
    await activateByteMatchMode();

    // Naviger til den nye annonce-visning
    setTimeout(() => {
        showView('detail', new URLSearchParams({ id: new_updated_housing._id }));
    }, 500);

    // Genindlæs data til UI'en
    performPopulateHousing();
}

/* -------------------------------------------------------------------------- */
/* Image Handling (Instant Upload & Global Drag UX)                           */
/* -------------------------------------------------------------------------- */

function setupImageHandling() {
    const trigger = document.getElementById('upload-trigger');
    const input = document.getElementById('create-images_create');

    // Only setup listeners once to prevent stacking events if user navigates back/forth
    if (isDragDropSetup) return;
    isDragDropSetup = true;

    // --- 1. Standard Input Handling ---
    trigger.addEventListener('click', () => {
        if (!canUploadImages()) return;
        input.click();
    });
    input.addEventListener('change', (e) => {
        processFiles(e.target.files);
        input.value = '';
    });

    // --- 2. Global Drag Detection (UX Improvement) ---
    // Detects if a file is dragged anywhere on the screen to highlight the drop zone
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
        // Only activate if the Create view is actually visible
        if (document.getElementById('create').offsetParent === null) return;

        dragCounter++;
        trigger.classList.add('global-drag-active');
    });

    window.addEventListener('dragleave', (e) => {
        if (document.getElementById('create').offsetParent === null) return;

        dragCounter--;
        if (dragCounter <= 0) {
            trigger.classList.remove('global-drag-active');
            dragCounter = 0; // Reset to be safe
        }
    });

    window.addEventListener('drop', (e) => {
        // Reset global state on drop
        dragCounter = 0;
        trigger.classList.remove('global-drag-active');
        trigger.classList.remove('drag-over');
        e.preventDefault(); // Prevent browser from opening the file
    });

    window.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
    });


    // --- 3. Specific Drop Zone Handlers ---

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        trigger.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    trigger.addEventListener('dragenter', () => trigger.classList.add('drag-over'));
    trigger.addEventListener('dragover', () => trigger.classList.add('drag-over'));

    trigger.addEventListener('dragleave', () => trigger.classList.remove('drag-over'));

    trigger.addEventListener('drop', (e) => {
        trigger.classList.remove('drag-over');
        trigger.classList.remove('global-drag-active');
        dragCounter = 0;

        if (e.dataTransfer && e.dataTransfer.files) {
            if (!canUploadImages()) return;
            processFiles(e.dataTransfer.files);
        }
    });
}

function canUploadImages() {
    if (isLoggedIn()) return true;

    displayErrorMessage("Du skal være logget ind for at uploade billeder til din annonce. Log ind eller opret en profil, og prøv igen.");
    return false;
}


// Add these variables to the top of your file near your other global state:
let isProcessingUploadQueue = false;
const uploadQueue = [];

async function processFiles(fileList) {
    if (!canUploadImages()) return;

    const files = Array.from(fileList);

    // Strikte tilladte typer
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    for (const file of files) {
        // 1. Validering
        if (!allowedTypes.includes(file.type)) {
            displayErrorMessage(`Filen "${file.name}" er ikke understøttet. Brug venligst JPG, PNG eller WEBP.`);
            continue;
        }

        // 2. Max grænse
        if (currentImages.length >= 40) {
            displayErrorMessage("Du kan maks uploade 40 billeder.");
            break;
        }

        // 3. Forhindr duplicates
        const isDuplicate = currentImages.some(img =>
            img.file && img.file.name === file.name && img.file.size === file.size
        );

        if (!isDuplicate) {
            // Opret optimistic Image Object
            const imageObj = {
                type: 'new',
                file: file,
                url: URL.createObjectURL(file),
                status: 'uploading',
                thumbnail_name: null
            };

            currentImages.push(imageObj);

            // Opdater UI med spinner med det samme
            renderImagePreviews();

            // AWAIT sikrer, at telefonens processor og RAM får ro til at færdiggøre ét billede,
            // før den åbner for de tunge beregninger af næste billede.
            await uploadSingleFile(file, imageObj);
        }
    }
}

async function processNextInQueue() {
    // If the queue is empty or already running, do nothing
    if (isProcessingUploadQueue || uploadQueue.length === 0) return;

    isProcessingUploadQueue = true;
    const { file, imageObj } = uploadQueue.shift();

    try {
        await uploadSingleFile(file, imageObj);
    } catch (e) {
        console.error("Queue item failed:", e);
    } finally {
        isProcessingUploadQueue = false;
        // Process the next item in line
        processNextInQueue();
    }
}

async function uploadSingleFile(file, imageObj) {
    try {
        const fileToUpload = await convertToWebP(file);

        const formData = new FormData();
        formData.append('file', fileToUpload);

        const response = await authFetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            imageObj.status = 'uploaded';
            imageObj.thumbnail_name = data.thumbnail_name;
            imageObj.name = data.name;
        } else {
            const error = new Error("Upload failed");
            error.status = response.status;
            throw error;
        }
    } catch (error) {
        console.error("Image upload failed:", error);
        imageObj.status = 'error';

        if (error.status === 401) {
            displayErrorMessage("Du er ikke logget ind. Log venligst ind for at uploade filen.");
        } else {
            displayErrorMessage(`Fejl ved upload af ${file.name}`);
        }
    } finally {
        renderImagePreviews();
    }
}


/**
 * Converts an image file to WebP format using the browser's Canvas API.
 * Resizes to a maximum edge of 1600px to avoid Mobile GPU/VRAM OOM artifacts.
 */
function convertToWebP(file) {
    if (file.type === 'image/webp') return Promise.resolve(file);

    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);

            try {
                // Sæt MAX kant til det samme som din Python backend (1600)
                const MAX_EDGE = 1600;
                let targetWidth = img.width;
                let targetHeight = img.height;

                // Udregn det nye format med korrekt aspect ratio
                if (targetWidth > MAX_EDGE || targetHeight > MAX_EDGE) {
                    if (targetWidth > targetHeight) {
                        targetHeight = Math.round((targetHeight / targetWidth) * MAX_EDGE);
                        targetWidth = MAX_EDGE;
                    } else {
                        targetWidth = Math.round((targetWidth / targetHeight) * MAX_EDGE);
                        targetHeight = MAX_EDGE;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;

                const ctx = canvas.getContext('2d');

                // Forbedret kvalitet ved nedskalering
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                // Konverter til WebP med 80% kvalitet
                canvas.toBlob((blob) => {
                    // Frigør hardware hukommelse OMGÅENDE for at forhindre tile-artifacts
                    canvas.width = 0;
                    canvas.height = 0;

                    if (blob && blob.type === 'image/webp') {
                        const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
                        const newFile = new File([blob], newName, { type: 'image/webp' });
                        resolve(newFile);
                    } else {
                        console.warn(`WebP konvertering fejlede for ${file.name}. Bruger original.`);
                        resolve(file);
                    }
                }, 'image/webp', 0.80);
            } catch (e) {
                console.error("Canvas error under konvertering:", e);
                resolve(file);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };

        img.src = objectUrl;
    });
}

function renderImagePreviews() {
    const container = document.getElementById('imagePreview_create');
    container.innerHTML = '';

    currentImages.forEach((img, idx) => {
        const col = document.createElement('div');
        col.className = 'col-6 col-sm-4 col-md-3 fade-in';

        let statusBadge = '';
        if (img.status === 'uploading') {
            statusBadge = '<div class="preview-status-badge bg-warning"><span class="spinner-border spinner-border-sm" style="width: 0.8rem; height: 0.8rem;"></span></div>';
        } else if (img.status === 'error') {
            statusBadge = '<div class="preview-status-badge bg-danger"><i class="fa-solid fa-exclamation"></i></div>';
        }

        // Opacity effect while uploading
        const imgStyle = img.status === 'uploading' ? 'opacity: 0.5;' : '';

        col.innerHTML = `
            <div class="preview-card">
                <img src="${img.url}" alt="Billede" style="${imgStyle}">
                ${statusBadge}
                <div class="preview-number">${idx + 1}</div>
                <div class="preview-delete-btn" title="Slet billede" onclick="removeImage(${idx})">
                    <i class="fa-solid fa-trash-can" style="font-size: 12px;"></i>
                </div>
                ${idx === 0 ? '<div class="preview-cover-badge"><i class="fa-solid fa-star me-1"></i>Coverbillede</div>' : ''}
            </div>
        `;

        col.querySelector('.preview-delete-btn').onclick = (e) => {
            e.stopPropagation();
            removeImage(idx);
        };

        container.appendChild(col);
    });
}

async function removeImage(index) {
    const img = currentImages[index];

    // Optimistically remove from UI
    currentImages.splice(index, 1);
    renderImagePreviews();

    // If it was fully uploaded, delete from backend
    if (img.thumbnail_name) {
        try {
            await authFetch(`/upload/${img.thumbnail_name}`, { method: 'DELETE' });
        } catch (error) {
            console.error("Failed to delete image from server", error);
            // We don't re-add it to the UI to avoid confusion,
            // but we log the error.
        }
    }
}

/* -------------------------------------------------------------------------- */
/* Address & Helper Logic (Unchanged)                                         */
/* -------------------------------------------------------------------------- */

function setupAddressAutocomplete() {
    const addressInput = document.getElementById('address_create');
    const dropdown = document.getElementById('address-dropdown');
    let debounceTimer;

    addressInput.addEventListener('input', (e) => {
        const query = e.target.value;
        clearTimeout(debounceTimer);
        clearStructuredAddressFields();

        if (query.length < 3) {
            dropdown.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            try {
                const response = await fetch(`https://api.dataforsyningen.dk/adresser/autocomplete?q=${encodeURIComponent(query)}&per_side=5`);
                const data = await response.json();

                dropdown.innerHTML = '';
                if (data.length > 0) {
                    dropdown.style.display = 'block';
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'address-suggestion';
                        div.textContent = item.tekst;
                        div.onclick = () => selectAddress(item);
                        dropdown.appendChild(div);
                    });
                } else {
                    dropdown.style.display = 'none';
                }
            } catch (err) {
                console.error("Address fetch error", err);
            }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== addressInput) {
            dropdown.style.display = 'none';
        }
    });
}

function selectAddress(item) {
    const adr = item.adresse;
    document.getElementById('address_create').value = `${adr.vejnavn} ${adr.husnr}`;
    document.getElementById('zip_city_create').value = `${adr.postnr} - ${adr.postnrnavn}`;
    document.getElementById('floor_create').value = adr.etage || '';
    document.getElementById('side_create').value = adr.dør || '';
    document.getElementById('datafordeler_id').value = adr.id;
    document.getElementById('postal_name').value = adr.postnr;
    document.getElementById('street_name').value = adr.vejnavn;
    document.getElementById('house_number').value = adr.husnr;
    document.getElementById('address-dropdown').style.display = 'none';
}

function setupCurrencyFormatters() {
    const fields = ['display_price_create', 'display_monthly_fee_create', 'display_improvements_price_create'];

    fields.forEach(id => {
        const displayInput = document.getElementById(id);
        const hiddenInput = document.getElementById(id.replace('display_', ''));

        displayInput.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\./g, '').replace(/,/g, '');
            if (isNaN(val) || val === '') val = '';

            hiddenInput.value = val;
            if (val !== '') {
                e.target.value = new Intl.NumberFormat('da-DK').format(val);
            }
        });
    });
}

function setupDeleteHandler() {
    const btn = document.getElementById('deleteHousingBtn');
    if (!btn) return;

    btn.addEventListener('click', function() {
        const id = this.dataset.housingId;
        if (!id) return;

        openDeleteHousingOptionsModal(id);
    });
}

function openDeleteHousingOptionsModal(id) {
    showConfirmationModal(
        'Vil du slette annoncen?',
        getDeleteHousingModalHtml(),
        async () => {
            const res = await authFetch(`/advertisement/${id}`, { method: 'DELETE' });
            if (res.ok) {
                displaySuccessMessage("Annonce slettet");
                setTimeout(() => showView("liste"), 500);
                resetForm();
            } else {
                displayErrorMessage("Kunne ikke slette annonce");
            }
        }
    );

    setupDeleteModalStatusActions();
}

function getDeleteHousingModalHtml() {
    const isReserved = usersCurrentActiveHousing?.reserved === true;
    const isSold = usersCurrentActiveHousing?.sold === true;
    const reserveLabel = isReserved ? 'Allerede reserveret' : 'Markér som reserveret';
    const soldLabel = isSold ? 'Allerede solgt' : 'Markér som solgt';
    const reserveStyle = `color: ${isReserved ? '#ffffff' : '#d97706'}; background-color: ${isReserved ? '#d97706' : '#fef3c7'}; border: 1px solid #fcd34d;`;
    const soldStyle = `color: ${isSold ? '#ffffff' : '#166534'}; background-color: ${isSold ? '#166534' : '#dcfce7'}; border: 1px solid #86efac;`;

    return [
        'Måske behøver du ikke slette annoncen. Hvis annoncen er sat på pause eller du har en køber, kan du markere den som reserveret eller solgt.',
        '<div class="d-grid gap-2 mt-4 text-start">',
        `<button type="button" class="btn rounded-pill py-3 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2" id="delete-modal-reserve-btn" ${isReserved ? 'disabled' : ''} style="${reserveStyle}"><i class="fa-solid fa-hourglass-half"></i><span>${reserveLabel}</span></button>`,
        `<button type="button" class="btn rounded-pill py-3 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2" id="delete-modal-sold-btn" ${isSold ? 'disabled' : ''} style="${soldStyle}"><i class="fa-solid fa-handshake"></i><span>${soldLabel}</span></button>`,
        '</div>',
        '<p class="small text-muted mt-4 mb-0">Slet kun annoncen, hvis den skal fjernes permanent.</p>'
    ].join('');
}

function setupDeleteModalStatusActions() {
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('genericConfirmationModal'));

    document.getElementById('delete-modal-reserve-btn')?.addEventListener('click', async () => {
        const ok = await setHousingReservedStatus(true);
        if (ok) modal.hide();
    }, {once: true});

    document.getElementById('delete-modal-sold-btn')?.addEventListener('click', async () => {
        const ok = await setHousingSoldStatus(true);
        if (ok) modal.hide();
    }, {once: true});
}

/* -------------------------------------------------------------------------- */
/* Exchange (Swap) Toggle Logic                                                   */
/* -------------------------------------------------------------------------- */

function setupExchangeToggle() {
    const toggle = document.getElementById('exchange_toggle');
    const container = document.getElementById('exchange-criteria-container');
    const infoContainer = document.getElementById('exchange-info-container'); // <--- Select info box
    if (!toggle || !container) return;

    toggle.onchange = () => {
        if (toggle.checked) {
            // 1. Generate Content
            // Only generate if empty to avoid wiping data if already populated
            if (container.innerHTML.trim() === '') {
                container.innerHTML = generateCriteriaForm('Exchange', 'Exchange');
                setupAreaTagLogic('Exchange');
                setupCriteriaCurrencyFormatters('Exchange');
            }

            // 2. Animate Info Box
            if (infoContainer) {
                requestAnimationFrame(() => {
                    infoContainer.style.maxHeight = infoContainer.scrollHeight + 'px';
                    infoContainer.classList.add('active');
                });
            }

            // 3. Animate Criteria Container
            requestAnimationFrame(() => {
                const contentHeight = container.scrollHeight;
                container.style.maxHeight = contentHeight + 'px';
                container.classList.add('active');

                setTimeout(() => {
                    container.classList.add('expanded');
                    container.style.maxHeight = 'none';
                    if (infoContainer) infoContainer.style.maxHeight = 'none'; // Allow dynamic resizing
                }, 400);
            });

        } else {
            // Collapse Info Box
            if (infoContainer) {
                infoContainer.style.maxHeight = infoContainer.scrollHeight + 'px'; // Set explicit height first
                infoContainer.offsetHeight; // Force reflow
                requestAnimationFrame(() => {
                    infoContainer.style.maxHeight = '0';
                    infoContainer.classList.remove('active');
                });
            }

            // Collapse Criteria Container
            container.classList.remove('expanded');
            container.style.maxHeight = container.scrollHeight + 'px';
            container.offsetHeight;

            requestAnimationFrame(() => {
                container.style.maxHeight = '0';
                container.classList.remove('active');
            });

            // NOTE: We DO NOT clear container.innerHTML here anymore.
            // This ensures the inputs (and their values) persist in the DOM
            // so they can be retrieved by getFormData() even when hidden.
        }
    };
}

/* -------------------------------------------------------------------------- */
/* Visibility & Publish Logic                                                 */
/* -------------------------------------------------------------------------- */

function updateVisibilityUI() {
    const section = document.getElementById('visibility-status-section');
    if (!section) return;

    // Show section ONLY if we have a saved housing AND it is hidden
    if (activeHousingId && !isHousingVisible) {
        section.classList.remove('d-none');
    } else {
        section.classList.add('d-none');
    }
}


function setupVisibilityHandler() {
    const btn = document.getElementById('btn-publish-housing');
    if (!btn) return;

    // Use .onclick to avoid stacking listeners if view is reloaded
    btn.onclick = (e) => {
        e.preventDefault();

        // Check if email is missing (undefined, null, or empty string)
        if (!currentUser || !currentUser.email || currentUser.email.trim() === '') {
            // 1. Show the Missing Info Modal
            const modalEl = document.getElementById('missingContactInfoModal');

            // --- NEW: Pre-fill phone number if available ---
            if (currentUser && currentUser.phone_number) {
                const phoneInput = document.getElementById('contact-phone');
                if (phoneInput) {
                    phoneInput.value = currentUser.phone_number;
                }
            }
            // -----------------------------------------------

            const modal = new bootstrap.Modal(modalEl);
            modal.show();

            // 2. Handle Form Submit
            const form = document.getElementById('contactInfoForm');
            // Ensure we don't stack listeners if the user closes and re-opens
            form.onsubmit = async (ev) => {
                ev.preventDefault();

                const email = document.getElementById('contact-email').value;
                const phone = document.getElementById('contact-phone').value;

                if (!email) {
                    displayErrorMessage("Email er påkrævet");
                    return;
                }

                try {
                    // 3. Send PATCH request to update user contact info
                    const updateRes = await authFetch('/user/contact-info', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, phone })
                    });

                    if (updateRes.ok) {
                        modal.hide();
                        // Update the global user object immediately so we don't trigger this again
                        if (currentUser) {
                            currentUser.email = email;
                            currentUser.phone_number = phone;
                        }
                        displaySuccessMessage("Oplysninger opdateret");

                        // 4. On success, proceed to publish logic
                        performPublish();
                    } else {
                        const err = await updateRes.json();
                        displayErrorMessage(err.detail || "Kunne ikke opdatere oplysninger");
                    }
                } catch (err) {
                    console.error(err);
                    displayErrorMessage("Der opstod en fejl.");
                }
            };
        } else {
            // Email is present, proceed directly
            performPublish();
        }
    };
}


// Helper function to handle the actual publish API call
async function performPublish() {
    // Optimistic UI update
    const originalState = isHousingVisible;

    try {
        // Send PATCH request to flip visibility using the endpoint
        const response = await authFetch('/advertisement-visibility', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ visible: true })
        });

        if (response.ok) {
            isHousingVisible = true;

            // 1. Manually force the button to be visible immediately
            const viewBtn = document.getElementById('viewHousingBtn');
            if (viewBtn) {
                viewBtn.classList.remove('d-none');
                // Ensure the click handler is attached
                viewBtn.onclick = (e) => {
                    e.preventDefault();
                    if (activeHousingId) {
                        showView('detail', new URLSearchParams({ id: activeHousingId }));
                    }
                };
            }
            updateVisibilityUI();

            // Update UI to show "Se din annonce" button immediately
            displaySuccessMessage("Din annonce er nu synlig for alle!");

            // Update local state
            if (usersCurrentActiveHousing) {
                usersCurrentActiveHousing.visible = true;
                updateAdminDashboardUI(usersCurrentActiveHousing);

                // 2. Update global cache (window.housings)
                // This ensures the Detail View sees the updated 'visible' state immediately
                if (window.housings && Array.isArray(window.housings)) {
                    const index = window.housings.findIndex(h => h._id === usersCurrentActiveHousing._id);
                    if (index !== -1) {
                        window.housings[index] = usersCurrentActiveHousing;
                    } else {
                        window.housings.push(usersCurrentActiveHousing);
                    }
                }
            }

            // 3. Redirect to the detail view after a short delay
            // This allows the user to read the success message before moving
            if (activeHousingId) {
                setTimeout(() => {
                    showView('detail', new URLSearchParams({ id: activeHousingId }));
                }, 2000);
            }
        } else {
            throw new Error("Failed to update visibility");
        }
    } catch (error) {
        console.error("Publish error:", error);
        isHousingVisible = originalState; // Revert on error
        updateVisibilityUI();
        displayErrorMessage("Der opstod en fejl. Prøv igen senere.");
    }
}


export async function ensureHousingDataLoaded(forceReload = false) {
    const currentUserId = getCurrentCreateUserId();

    if (createHousingDataPromise && !forceReload && createHousingDataPromiseUserId === currentUserId) {
        return createHousingDataPromise;
    }

    if (!forceReload && createHousingDataLoaded && currentUserId === lastLoadedUser) {
        return;
    }

    createHousingDataPromiseUserId = currentUserId;
    createHousingDataPromise = (async () => {
        // Always wipe the slate clean before loading data for a fresh user/context.
        resetForm();

        // If they are logged in, try to fetch their data from the database.
        if (currentUserId) {
            await performPopulateHousing();
        }

        // If there's no active housing from the DB, restore local unsaved draft.
        if (!activeHousingId) {
            restoreSessionData();
        }

        lastLoadedUser = currentUserId;
        createHousingDataLoaded = true;
    })();

    try {
        return await createHousingDataPromise;
    } finally {
        if (createHousingDataPromiseUserId === currentUserId) {
            createHousingDataPromise = null;
        }
    }
}

// Tilføj denne funktion til housing_create.js
export function updateAdminDashboardUI(housing) {
    const dashboard = document.getElementById('admin-status-dashboard');

    // Hvis brugeren ikke har en eksisterende annonce (hvis den er helt ny), skjul dashboardet
    if (!housing || !housing._id) {
        dashboard.classList.add('d-none');
        return;
    }

    // Vis dashboardet, da vi redigerer en eksisterende annonce
    dashboard.classList.remove('d-none');

    // 1. Opdater read-only Synlighedsindikator
    const iconWrapper = document.getElementById('dashboard-status-icon-wrapper');
    const icon = document.getElementById('dashboard-status-icon');
    const statusText = document.getElementById('dashboard-status-text');

    // NYT: Vis "Opgrader" knappen, hvis annoncen IKKE allerede er Premium/Highlighted AND marketing_paid = true
    const btnUpgrade = document.getElementById('btn-upgrade-housing');
    if (btnUpgrade) {
        const isAlreadyPaid = housing.marketing_paid === true;

        if (!isAlreadyPaid) {
            btnUpgrade.classList.remove('d-none');
        } else {
            btnUpgrade.classList.add('d-none');
        }
    }

    if (housing.visible) {
        iconWrapper.style.backgroundColor = '#fff';
        icon.className = 'fa-solid fa-eye text-success fs-5';
        statusText.textContent = 'Aktiv';
        statusText.style.color = 'var(--company-dark)';
    } else {
        iconWrapper.style.backgroundColor = '#f1f5f9';
        icon.className = 'fa-regular fa-eye-slash text-muted fs-5';
        statusText.textContent = 'Skjult';
        statusText.style.color = '#64748b'; // Slate 500
    }

    // 2. Opdater "Reserveret" knap UI
    const btnReserved = document.getElementById('btn-toggle-reserved');
    const textReserved = document.getElementById('text-toggle-reserved');
    if (housing.reserved) {
        btnReserved.style.backgroundColor = '#d97706'; // Solid orange
        btnReserved.style.color = '#fff';
        textReserved.textContent = 'Fjern Reservation';
    } else {
        btnReserved.style.backgroundColor = '#fef3c7'; // Light orange
        btnReserved.style.color = '#d97706';
        textReserved.textContent = 'Markér Reserveret';
    }

    // 3. Opdater "Solgt" knap UI
    const btnSold = document.getElementById('btn-toggle-sold');
    const textSold = document.getElementById('text-toggle-sold');
    if (housing.sold) {
        btnSold.style.backgroundColor = '#166534'; // Solid green
        btnSold.style.color = '#fff';
        textSold.textContent = 'Fortryd Solgt';
    } else {
        btnSold.style.backgroundColor = '#dcfce7'; // Light green
        btnSold.style.color = '#166534';
        textSold.textContent = 'Markér Solgt';
    }
}

/**
 * Initialiserer event listeners til annoncestatus-dashboardet (Reserveret / Solgt)
 */
async function setHousingReservedStatus(newState) {
    if (!usersCurrentActiveHousing) return false;

    try {
        const res = await authFetch(`/advertisement/${usersCurrentActiveHousing._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reserved: newState })
        });

        if (!res.ok) {
            throw new Error("Kunne ikke opdatere");
        }

        usersCurrentActiveHousing.reserved = newState;
        updateAdminDashboardUI(usersCurrentActiveHousing);
        displaySuccessMessage(newState ? "Annoncen er nu markeret som reserveret." : "Reservation fjernet.");
        return true;
    } catch(err) {
        displayErrorMessage("Kunne ikke opdatere status.");
        return false;
    }
}

async function setHousingSoldStatus(newState) {
    if (!usersCurrentActiveHousing) return false;

    try {
        const res = await authFetch(`/advertisement/${usersCurrentActiveHousing._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sold: newState
            })
        });

        if (!res.ok) {
            throw new Error("Kunne ikke opdatere");
        }

        usersCurrentActiveHousing.sold = newState;
        updateAdminDashboardUI(usersCurrentActiveHousing);
        displaySuccessMessage(newState ? "Tillykke! Annoncen er markeret som solgt." : "Salg annulleret.");
        return true;
    } catch(err) {
        displayErrorMessage("Kunne ikke opdatere status.");
        return false;
    }
}

export function setupAdminStatusListeners() {
    const btnToggleReserved = document.getElementById('btn-toggle-reserved');
    const btnToggleSold = document.getElementById('btn-toggle-sold');

    if (btnToggleReserved) {
        btnToggleReserved.addEventListener('click', async () => {
            if (!usersCurrentActiveHousing) return;

            const newState = !usersCurrentActiveHousing.reserved;
            try {
                // Antager din backend endpoint understøtter PATCH /advertisement/{id}
                const res = await authFetch(`/advertisement/${usersCurrentActiveHousing._id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reserved: newState })
                });

                if (res.ok) {
                    usersCurrentActiveHousing.reserved = newState;
                    updateAdminDashboardUI(usersCurrentActiveHousing); // Opdater UI
                    displaySuccessMessage(newState ? "Annoncen er nu markeret som reserveret." : "Reservation fjernet.");
                } else {
                    throw new Error("Kunne ikke opdatere");
                }
            } catch(err) {
                displayErrorMessage("Kunne ikke opdatere status.");
            }
        });
    }

    if (btnToggleSold) {
        btnToggleSold.addEventListener('click', async () => {
            if (!usersCurrentActiveHousing) return;

            // Vi antager at hvis den markeres solgt, fjernes reservation også automatisk
            const newState = !usersCurrentActiveHousing.sold;
            try {
                const res = await authFetch(`/advertisement/${usersCurrentActiveHousing._id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sold: newState
                    })
                });

                if (res.ok) {
                    usersCurrentActiveHousing.sold = newState;
                    updateAdminDashboardUI(usersCurrentActiveHousing);
                    displaySuccessMessage(newState ? "Tillykke! Annoncen er markeret som solgt." : "Salg annulleret.");
                } else {
                    throw new Error("Kunne ikke opdatere");
                }
            } catch(err) {
                displayErrorMessage("Kunne ikke opdatere status.");
            }
        });
    }

    const btnUpgrade = document.getElementById('btn-upgrade-housing');
    if (btnUpgrade) {
        btnUpgrade.addEventListener('click', () => {
            // Hent modal instansen (forudsætter Bootstrap er loadet)
            const upsellModalElement = document.getElementById('upsellModal');
            if (upsellModalElement) {
                const modal = bootstrap.Modal.getInstance(upsellModalElement) || new bootstrap.Modal(upsellModalElement);

                modal.show();
            }
        });
    }
}
