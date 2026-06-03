import { authFetch } from "../auth/auth.js";
import {
    displayErrorMessage,
    displaySuccessMessage, isSubscribed,
    prepareStripeBuyButton,
    showConfirmationModal,
} from "../utils.js";
import { showView } from "../views/viewManager.js";
import { renderAgents, updateLocalAgent } from "../agent/agent.js";
import { updateStripePaymentElements } from "../login/login.js";
import {
    generateCriteriaForm,
    getCriteriaValues,
    hasRequiredAgentCriteria,
    AGENT_CRITERIA_REQUIRED_MESSAGE,
    EXCHANGE_CRITERIA_REQUIRED_MESSAGE,
    setupAreaTagLogic,
    setupCriteriaCurrencyFormatters
} from "../components/criteria_form.js";
// IMPORT GLOBAL VARIABLE (Live binding)
import { ensureHousingDataLoaded, usersCurrentActiveHousing } from "../housing_create/housing_create.js";

/**
 * ----------------------------------------------------------------------------
 * View Setup & Logic
 * ----------------------------------------------------------------------------
 */

export async function SetupAgentCreateView() {
    // 1. Ensure HTML is present in the container
    insertSharedAgentComponents();

    const suffix = 'agentcreate';

    // 2. Setup formatters and autocomplete for the criteria form
    setupCriteriaCurrencyFormatters(suffix);
    setupAreaTagLogic(suffix);

    // 3. Setup the smooth toggle for the "Kun bytte" info box
    setupAgentExchangeToggle(suffix);

    // 4. Attach Listener for the Create Button
    $(document).off('click', '#createAnnonceagentBtn').on('click', '#createAnnonceagentBtn', async function(e) {
        e.preventDefault();
        await createAnnonceagent();
    });

    setupAgentSuccessUpsellPaymentButton();
}

/**
 * Handles the creation of a new agent
 */
async function createAnnonceagent(options = {}) {
    const $btn = $('#createAnnonceagentBtn');
    const originalText = $btn.html();
    const skipExchangeListingPrompt = options.skipExchangeListingPrompt === true;

    try {
        const suffix = "agentcreate";

        const name = $(`#name-${suffix}`).val();
        const active = $(`#active-${suffix}`).is(":checked");
        const exchangeOnly = $(`#exchange-only-${suffix}`).is(":checked");
        const criteria = getCriteriaValues(suffix);

        if (!validateAgentCriteriaBeforeSubmit(suffix, exchangeOnly, criteria)) {
            return;
        }

        if (!skipExchangeListingPrompt && await shouldPromptForExchangeBoligMatch(exchangeOnly)) {
            promptCreateExchangeBoligMatch(() => createAnnonceagent({skipExchangeListingPrompt: true}));
            return;
        }

        $btn.prop('disabled', true).html('<i class="fas fa-circle-notch fa-spin me-2"></i>Opretter...');

        const agentData = {
            name: name,
            active: active,
            exchange_only: exchangeOnly,
            criteria: criteria,
            notifications: ["email"]
        };

        const response = await authFetch("/agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(agentData)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Der opstod en fejl ved oprettelse");
        }

        const updatedAgent = await response.json();

        // Reset form
        $(`#name-${suffix}`).val('');
        $(`#exchange-only-${suffix}`).prop('checked', false).trigger('change');
        $(`#agent_create form input`).not('[type="checkbox"]').val('');

        updateLocalAgent(updatedAgent);

        // --- NY LOGIK TIL UPSELL ---
        // TODO: Er der ikke data lokalt som kan bruges til at konkludere om vi subscriber? fx jwt?
        // Det er måske ikke live updated, men det er OK her
        const hasSub = await isSubscribed();

        console.log(hasSub)
        if (!hasSub) {
            // Gå til oversigten i baggrunden, så siden er klar under modalen
            showView('agent');

            // Vis den nye "Success & Upsell" modal
            const upsellModalEl = document.getElementById('agentSuccessUpsellModal');
            if(upsellModalEl) {
                const upsellModal = new bootstrap.Modal(upsellModalEl);
                upsellModal.show();
            }
        } else {
            // De betaler allerede: Vis blot almindelig succes og gå til oversigten
            displaySuccessMessage("BoligMatch oprettet");
            showView('agent');
        }
        // -----------------------------

    } catch (error) {
        console.error(error);
        displayErrorMessage(error.message || "Der opstod en fejl");
    } finally {
        $btn.prop('disabled', false).html(originalText);
    }
}

export function validateAgentCriteriaBeforeSubmit(suffix, exchangeOnly, criteria) {
    if (hasRequiredAgentCriteria(criteria, exchangeOnly)) return true;

    const message = exchangeOnly
        ? EXCHANGE_CRITERIA_REQUIRED_MESSAGE
        : AGENT_CRITERIA_REQUIRED_MESSAGE;

    const criteriaContainer = document.querySelector(`#area-tag-container-${suffix}`)?.closest('.criteria-form-container');
    const areaInput = document.getElementById(`area-tag-input-${suffix}`);

    if (criteriaContainer) {
        criteriaContainer.scrollIntoView({behavior: 'smooth', block: 'center'});
    }

    areaInput?.focus({preventScroll: true});
    displayErrorMessage(message);
    return false;
}

async function shouldPromptForExchangeBoligMatch(exchangeOnly) {
    if (exchangeOnly) return false;

    await ensureHousingDataLoaded();
    return hasActiveExchangeListing();
}

function promptCreateExchangeBoligMatch(onContinue) {
    let shouldContinueAsExchange = false;
    let shouldContinueAsNormal = false;

    showConfirmationModal(
        'Vil du oprette et BytteMatch?',
        'Du har allerede en aktiv bytteannonce. Hvis du leder efter en bolig at bytte med, anbefaler vi at markere BoligMatch som "Kun bytte".\n\nSå prøver vi at finde boliger, hvor både dine ønsker og den anden sælgers ønsker passer sammen.',
        () => {
            const toggle = document.getElementById('exchange-only-agentcreate');
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                toggle.dispatchEvent(new Event('change'));
            }
            shouldContinueAsExchange = true;
        },
        'btn-primary'
    );

    const $modal = $('#genericConfirmationModal');
    const $confirmButton = $('#confirmActionButton');
    const $cancelButton = $modal.find('[data-bs-dismiss="modal"]').first();

    const originalConfirmText = $confirmButton.html();
    const originalCancelText = $cancelButton.html();

    $confirmButton.html('<i class="fa-solid fa-right-left me-2"></i>Lav BytteMatch');
    $cancelButton.text('Fortsæt almindeligt');

    $cancelButton.off('click.exchange-agent-warning').on('click.exchange-agent-warning', () => {
        shouldContinueAsNormal = true;
    });

    $modal.off('hidden.bs.modal.exchange-agent-warning').one('hidden.bs.modal.exchange-agent-warning', async () => {
        $cancelButton.off('click.exchange-agent-warning');
        $confirmButton.html(originalConfirmText);
        $cancelButton.html(originalCancelText);

        if (shouldContinueAsExchange || shouldContinueAsNormal) {
            await onContinue();
        }
    });
}


/**
 * ----------------------------------------------------------------------------
 * Shared Component Logic
 * ----------------------------------------------------------------------------
 */

export function insertSharedAgentComponents() {
    document.querySelectorAll('.view[data-agent-type]').forEach(view => {
        const agentType = view.getAttribute('data-agent-type'); // "edit" or "create"
        let container = view.querySelector('.shared-components-container');

        if (container && container.innerHTML.trim() === '') {
            container.innerHTML = generateSharedComponents(agentType);
        }
    });
}

/**
 * Handles the smooth slide-down animation of the info box when "Kun bytte" is selected
 */
export function setupAgentExchangeToggle(suffix) {
    const toggle = document.getElementById(`exchange-only-${suffix}`);
    const infoContainer = document.getElementById(`exchange-info-container-${suffix}`);

    if (!toggle || !infoContainer) return;

    // Remove existing listener to avoid double-firing if view re-renders
    toggle.removeEventListener('change', handleToggle);
    toggle.addEventListener('change', handleToggle);

    function handleToggle(event) {
        if (toggle.checked) {
            const hasExchangeHousing = hasActiveExchangeListing();

            const warningText = `<p class="mb-2 small text-warning-emphasis"><i class="fa-solid fa-triangle-exclamation me-1"></i>Du har ikke en aktiv bytteannonce endnu. BoligMatch vil kun give matches, når du også har en aktiv annonce til bytte.</p>`;
            const infoText = `<p class="mb-0 small text-muted">Vi finder automatisk dem, der har det du drømmer om – og som leder efter netop din bolig.</p>`;

            infoContainer.innerHTML = `
                <div class="exchange-info-card mt-3 d-flex align-items-start gap-3">
                    <div class="exchange-icon-circle flex-shrink-0">
                        <i class="fa-solid fa-circle-info text-primary"></i>
                    </div>
                    <div>
                        <h6 class="fw-bold mb-1 text-dark">Automatisk BytteMatch</h6>
                        ${!hasExchangeHousing ? warningText : ''}
                        ${infoText}
                    </div>
                </div>
            `;

            requestAnimationFrame(() => {
                infoContainer.style.maxHeight = infoContainer.scrollHeight + 'px';
                infoContainer.classList.add('active');

                setTimeout(() => {
                    if (toggle.checked) infoContainer.style.maxHeight = 'none';
                }, 400);
            });

            if (!hasExchangeHousing) {
                displayErrorMessage('Du mangler en aktiv bytteannonce.', 12000);
            }
        } else {
            infoContainer.style.maxHeight = infoContainer.scrollHeight + 'px';
            infoContainer.offsetHeight; // Force reflow

            requestAnimationFrame(() => {
                infoContainer.style.maxHeight = '0';
                infoContainer.classList.remove('active');
            });
        }
    }
}

function hasActiveExchangeListing() {
    return Boolean(
        usersCurrentActiveHousing &&
        usersCurrentActiveHousing.exchange_only === true &&
        usersCurrentActiveHousing.deleted !== true &&
        usersCurrentActiveHousing.sold !== true
    );
}

/**
 * Generates the HTML template for the form
 * This is used for both Create and Edit views.
 */
function generateSharedComponents(viewType) {
    const suffix = viewType === "edit" ? "agentedit" : "agentcreate";
    const isEdit = viewType === "edit";

    const btnText = isEdit ? "Gem ændringer" : "Opret BoligMatch";
    const btnIcon = isEdit ? "fa-floppy-disk" : "fa-check";
    const btnId = isEdit ? "editAnnonceagentBtn" : "createAnnonceagentBtn";

    const criteriaFormHtml = generateCriteriaForm('agent', suffix);

    return `
        <div class="container py-4">
            <div class="row justify-content-center">
                <div class="col-lg-8 col-xl-7">

                    <div class="text-center pb-4">
                        <h1 class="view-title">
                            ${isEdit ? 'Rediger' : 'Opret'} <span class="view-title-highlight">BoligMatch</span>
                        </h1>
                        <p class="text-muted fs-5 opacity-75">Vi holder øje med markedet for dig – helt gratis.</p>
                    </div>

                    <div class="card agent-form-card bg-white shadow-lg">
                        <div class="card-body p-4 p-md-5">
                            <form autocomplete="off" onsubmit="return false;">
                                
                                <div class="mb-4">
                                    <h5 class="form-section-title">
                                        <i class="fa-solid fa-pen-to-square me-2 text-primary"></i>Navngivning
                                    </h5>
                                    <div class="form-floating">
                                        <input type="text" id="name-${suffix}" class="form-control" placeholder="Navn">
                                        <label for="name-${suffix}">Navn (f.eks. "Drømmebolig i KBH")</label>
                                    </div>
                                </div>

                                <div class="mb-0">
                                     <input type="checkbox" class="btn-check" id="exchange-only-${suffix}" autocomplete="off">
                                     <label class="facility-card shadow-sm exchange-toggle-card w-100 align-items-center" for="exchange-only-${suffix}">
                                         <i class="fa-solid fa-handshake text-secondary" style="font-size: 1.75rem;"></i>
                                         <div class="text-start flex-grow-1">
                                             <div class="facility-text text-start fs-6" style="color: var(--company-dark);">Kun bytte</div>
                                             <small class="text-muted fw-normal">Jeg leder efter en byttebolig</small>
                                         </div>
                                         <i class="fa-regular fa-circle-check text-primary fs-3 check-icon"></i>
                                     </label>
                                </div>

                                <div id="exchange-info-container-${suffix}" class="exchange-info-wrapper"></div>

                                <div class="form-divider"></div>

                                ${criteriaFormHtml}

                                <div class="form-divider"></div>

                                <div class="mb-4">
                                    <div class="d-flex justify-content-between align-items-center p-3 border rounded-3 bg-light">
                                        <div>
                                            <h6 class="mb-1 fw-bold">Aktiver BoligMatch</h6>
                                            <small class="text-muted">Du modtager kun notifikationer, når den er aktiv.</small>
                                        </div>
                                        <div class="form-check form-switch">
                                            <input class="form-check-input" type="checkbox" id="active-${suffix}" checked style="width: 3em; height: 1.5em; cursor: pointer;">
                                        </div>
                                    </div>
                                </div>

                                <div class="d-grid mt-5">
                                    <button id="${btnId}" type="button" class="btn btn-primary btn-lg rounded-pill py-3 fw-bold shadow-sm transition-transform">
                                        <i class="fa-solid ${btnIcon} me-2"></i>${btnText}
                                    </button>
                                </div>

                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupAgentSuccessUpsellPaymentButton() {
    $(document).off('click', '#agent-success-payment-btn').on('click', '#agent-success-payment-btn', async function(e) {
        e.preventDefault();

        const $btn = $(this);
        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-circle-notch fa-spin me-2"></i>Klargør betaling...');

        try {
            await prepareStripeBuyButton();
            updateStripePaymentElements();

            const stripeEl = document.getElementById('stripePayment');
            const clientRefId = stripeEl?.getAttribute('client-reference-id')?.trim();

            if (!clientRefId) {
                displayErrorMessage('Betalingen blev afbrudt, da vi ikke kunne identificere din bruger. Log ind og prøv igen.', 8000);
                return;
            }

            const upsellModalEl = document.getElementById('agentSuccessUpsellModal');
            const paymentModalEl = document.getElementById('paymentModal');

            if (!paymentModalEl) {
                displayErrorMessage('Kunne ikke åbne betalingsmodulet. Prøv at opdatere siden.');
                return;
            }

            const showPaymentModal = () => {
                const paymentModal = bootstrap.Modal.getOrCreateInstance(paymentModalEl);
                paymentModal.show();
            };

            if (upsellModalEl) {
                const upsellModal = bootstrap.Modal.getInstance(upsellModalEl);
                if (upsellModal) {
                    upsellModalEl.addEventListener('hidden.bs.modal', showPaymentModal, {once: true});
                    upsellModal.hide();
                    return;
                }
            }

            showPaymentModal();
        } catch (error) {
            console.error(error);
            displayErrorMessage('Kunne ikke klargøre betalingen. Prøv igen om lidt.');
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });
}
