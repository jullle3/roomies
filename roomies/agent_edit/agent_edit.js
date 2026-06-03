import { authFetch } from "../auth/auth.js";
import {
    displayErrorMessage,
    displaySuccessMessage
} from "../utils.js";
import {fetchAllAgents, updateLocalAgent} from "../agent/agent.js";
import { showView } from "../views/viewManager.js";
import {insertSharedAgentComponents, setupAgentExchangeToggle, validateAgentCriteriaBeforeSubmit} from "../agent_create/agent_create.js";
import {
    populateCriteriaForm,
    getCriteriaValues,
    setupCriteriaCurrencyFormatters, setupAreaTagLogic
} from "../components/criteria_form.js";
import {performPopulateHousing} from "../housing_create/housing_create.js";

// Global state for the agent being edited
export let activeAgent = {
    _id: null,
    created: null,
    updated: null,
    created_by: null,
    notifications: null,
    active: null,
    criteria: null,
    exchange_only: false // NEW: Track this state
};

export async function SetupAgentEditView() {
    // 1. Ensure HTML is present
    insertSharedAgentComponents();

    // 2. Setup currency formatters for the criteria form
    // IMPORTANT: Suffix must match what is defined in agent_create.js -> generateSharedComponents ('agentedit')
    setupCriteriaCurrencyFormatters('agentedit');
    setupAreaTagLogic('agentedit');

    // Also initialize for Edit View if it's currently rendered in the DOM
    setupAgentExchangeToggle('agentedit');

    // 3. Attach Listener for the "Gem" button
    $(document).off('click', '#editAnnonceagentBtn').on('click', '#editAnnonceagentBtn', async function(e) {
        e.preventDefault();
        await updateAnnonceagent();
    });
}

/**
 * FETCH & HYDRATE:
 * Loads agent data from backend (via cache) and populates the form fields.
 * This is called by agent.js when the user clicks "Rediger".
 */
export async function loadAgentForEdit(agentId) {
    // 1. Ensure the view structure exists (in case of direct navigation/reload)
    insertSharedAgentComponents();

    // The suffix used in generateSharedComponents for edit view
    const suffix = "agentedit";

    // Ensure toggle logic is bound before any programmatic .trigger('change') calls
    setupAgentExchangeToggle(suffix);

    // 2. Clear old data / Reset Form State
    const $view = $('#agent_edit');

    // Set Name to loading state
    $(`#name-${suffix}`).val('Henter data...');

    // RESET: Clear all other inputs (criteria, facilities) to prevent stale data
    // We exclude name (just set) and active (will set momentarily)
    $view.find('input').not(`#name-${suffix}, #active-${suffix}`).val('').prop('checked', false);
    $view.find('select').val('');

    // RESET: Collpase the exchange info box by default
    $(`#exchange-only-${suffix}`).prop('checked', false).trigger('change');

    // 3. Fetch fresh data (Refactored to use cached list)
    // We use fetchAllAgents to get the array, then find the specific one.
    // const agents = await fetchAllAgents();
    const agent = window.agents ? window.agents.find(a => a._id === agentId) : null;

    if (!agent) {
        throw new Error("Kunne ikke hente data for BoligMatch.");
    }

    // 4. Update Global State (Critical for preserving _id and immutable fields)
    activeAgent = agent;

    // 5. HYDRATION: Map Backend Data -> Frontend Inputs

    // General Fields
    $(`#name-${suffix}`).val(agent.name || '');
    $(`#active-${suffix}`).prop('checked', agent.active);

    // NEW: Hydrate "Kun Bytte" Toggle
    const isExchange = agent.exchange_only === true;
    // We trigger 'change' so the info box animation runs if it's true
    $(`#exchange-only-${suffix}`).prop('checked', isExchange).trigger('change');

    // Criteria Fields (Using shared helper)
    if (agent.criteria) {
        populateCriteriaForm(agent.criteria, suffix);
    }
}

/**
 * UPDATE:
 * Gathers form data and sends PUT request.
 */
async function updateAnnonceagent() {
    const $btn = $('#editAnnonceagentBtn');
    const originalText = $btn.html();

    const suffix = "agentedit";

    try {
        // 2. Gather Data
        const name = $(`#name-${suffix}`).val();
        const active = $(`#active-${suffix}`).is(":checked");
        // NEW: Get Exchange Value
        const exchangeOnly = $(`#exchange-only-${suffix}`).is(":checked");

        // Get criteria using the shared helper
        const criteria = getCriteriaValues(suffix);

        if (!validateAgentCriteriaBeforeSubmit(suffix, exchangeOnly, criteria)) {
            return;
        }

        // 1. UI Loading State
        $btn.prop('disabled', true).html('<i class="fas fa-circle-notch fa-spin me-2"></i>Gemmer...');

        // 3. Construct Payload (Merging with original state)
        const agentData = {
            _id: activeAgent._id,
            created: activeAgent.created,
            updated: activeAgent.updated,
            created_by: activeAgent.created_by,
            notifications: activeAgent.notifications, // Preserve original notification settings
            criteria: criteria,
            name: name,
            active: active,
            exchange_only: exchangeOnly // NEW field
        };

        // 4. Send Request
        const response = await authFetch("/agent", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(agentData)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Der opstod en fejl ved opdatering");
        }
        const updatedAgent = await response.json()

        displaySuccessMessage("BoligMatch opdateret");

        // Populate create view to ensure new agent is updated there, too.
        performPopulateHousing()

        // Add updated entry to local cache, and redirect
        updateLocalAgent(updatedAgent)
        showView('agent');  // Return to list view
    } catch (error) {
        console.error(error);
        displayErrorMessage(error.message || "Der opstod en fejl");
    } finally {
        $btn.prop('disabled', false).html(originalText);
    }
}
