import { authFetch } from "../auth/auth.js";
import { displayErrorMessage, displaySuccessMessage, showConfirmationModal, isLoggedIn } from "../utils.js";
import { showView } from "../views/viewManager.js";
import { loadAgentForEdit } from "../agent_edit/agent_edit.js";

/* ... (Init and Event Listeners remain unchanged) ... */

export async function SetupAgentView() {
    setupEventListeners();
}

function setupEventListeners() {
    const $container = $('#agent');

    // 1. Delete Handler
    $container.off('click', '.btn-delete-agent').on('click', '.btn-delete-agent', function(e) {
        e.preventDefault();
        e.stopPropagation();

        const agentId = $(this).data('agent-id');
        showConfirmationModal(
            'Slet BoligMatch?',
            'Er du sikker på, at du vil slette den?',
            () => deleteAgent(agentId)
        );
    });

    // 2. Card Click Handler (Edit)
    $container.off('click', '.agent-card').on('click', '.agent-card', async function(e) {
        e.preventDefault();
        const agentId = $(this).data('agent-id');
        showView('agent_edit', new URLSearchParams({id: agentId}));
    });
}

// Global promise to deduplicate fetches
let agentFetchPromise = null;

// Retrieve the users agents
export async function fetchAllAgents(force = false) {
    if (!isLoggedIn()) return null;

    if (window.agents && !force) return window.agents;
    if (agentFetchPromise && !force) return agentFetchPromise;

    agentFetchPromise = (async () => {
        try {
            const response = await authFetch('/agent');
            if (response.ok) {
                window.agents = await response.json();
                return window.agents;
            } else {
                window.agents = null;
                return null;
            }
        } catch (error) {
            console.error("Failed to fetch agents", error);
            window.agents = null;
            return null;
        } finally {
            agentFetchPromise = null;
        }
    })();

    return agentFetchPromise;
}

export async function renderAgents(force = false) {
    const $loading = $('#agent-loading');
    const $grid = $('#agent-grid');
    const $emptyState = $('#agent-empty');
    const $headerActions = $('#agent-header-actions');

    $loading.removeClass('d-none');
    $grid.empty().addClass('d-none');
    $emptyState.addClass('d-none');
    $headerActions.addClass('d-none');

    if (!isLoggedIn()) {
        $loading.addClass('d-none');
        $emptyState.removeClass('d-none');
        return;
    }

    const agents = await fetchAllAgents(force);

    $loading.addClass('d-none');

    if (!agents || agents.length === 0) {
        $emptyState.removeClass('d-none');
        $headerActions.addClass('d-none');
    } else {
        renderAgentCards(agents, $grid);
        $grid.removeClass('d-none');
        $headerActions.removeClass('d-none');
    }
}

function renderAgentCards(agents, $container) {
    $container.empty();
    agents.forEach(agent => {
        $container.append(createAgentCard(agent));
    });
}

function createAgentCard(agent) {
    const createdDate = agent.created
        ? new Date(agent.created * 1000).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
        : '-';

    // UPDATED: Use the new .badge-glass classes for Active/Inactive
    const statusHtml = agent.active
        ? `<span class="badge-glass badge-active"><i class="fa-solid fa-check"></i><span>Aktiv</span></span>`
        : `<span class="badge-glass badge-inactive"><i class="fa-solid fa-pause"></i><span>Inaktiv</span></span>`;

    // UPDATED: Use .badge-glass + .badge-exchange
    const exchangeBadge = agent.exchange_only
        ? `<span class="badge-glass badge-exchange"><i class="fa-solid fa-arrow-right-arrow-left"></i><span>Kun bytte</span></span>`
        : '';

    const name = agent.name && agent.name.trim() !== "" ? agent.name : "Navnløs BoligMatch";

    return `
        <div class="col-md-6 col-lg-4 fade-in-card">
            <div class="card h-100 border-0 shadow-sm rounded-4 agent-card position-relative overflow-hidden bg-white"
                 data-agent-id="${agent._id}"
                 style="cursor: pointer;">
                <div class="card-body p-4 d-flex flex-column">
                    <div class="d-flex justify-content-between align-items-start mb-4">
                        <div class="agent-icon-box rounded-circle">
                            <i class="fa-solid fa-bell"></i>
                        </div>
                        <div class="d-flex flex-column gap-2 align-items-end">
                            ${statusHtml}
                            ${exchangeBadge}
                        </div>
                    </div>
                    <h5 class="fw-bold mb-2 text-dark text-truncate" title="${name}">${name}</h5>
                    <div class="mb-4">
                        <p class="text-muted small mb-0 opacity-75">
                            <i class="fa-regular fa-calendar me-2"></i>Oprettet: ${createdDate}
                        </p>
                    </div>
                    <div class="mt-auto pt-3 border-top border-light d-flex gap-2">
                        <button class="btn btn-outline-primary btn-sm rounded-pill px-3 flex-grow-1 fw-semibold">Rediger</button>
                        <button class="btn btn-light btn-sm rounded-circle btn-delete-agent" data-agent-id="${agent._id}" style="width: 34px; height: 34px; display:flex; align-items:center; justify-content:center;" title="Slet BoligMatch"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function deleteAgent(agentId) {
    authFetch(`/agent/${agentId}`, { method: 'DELETE' })
        .then(response => {
            if (!response.ok) throw new Error('Kunne ikke slette BoligMatch');
            displaySuccessMessage("BoligMatch slettet");
            const $btn = $(`button[data-agent-id="${agentId}"]`);
            const $cardCol = $btn.closest('.col-md-6, .col-lg-4');
            $cardCol.fadeOut(300, function() {
                $(this).remove();
                if ($('#agent-grid').children().length === 0) {
                    $('#agent-grid').addClass('d-none');
                    $('#agent-header-actions').addClass('d-none');
                    $('#agent-empty').removeClass('d-none').hide().fadeIn();
                }
            });
        })
        .catch(error => {
            displayErrorMessage(error.message);
        });
}

/**
 * Updates or adds an agent object in the global window.agents cache.
 * This avoids needing to refetch the entire list from the server after an edit or create.
 * @param {Object} updatedAgent - The full agent object returned from the backend
 */
export function updateLocalAgent(updatedAgent) {
    if (!Array.isArray(window.agents)) {
        window.agents = [];
    }

    // Find index of existing entry by ID
    const index = window.agents.findIndex(a => a._id === updatedAgent._id);

    if (index !== -1) {
        // Replace existing entry with the new data
        window.agents[index] = updatedAgent;
    } else {
        // If not found (e.g. newly created), add it to the top of the list
        window.agents.unshift(updatedAgent);
    }
}

/**
 * Fetches all agents that are marked as 'exchange only' and stores them globally.
 * This is used for cross-referencing exchange possibilities across the platform.
 */
export async function fetchAllExchangeOnlyAgents() {
    try {
        const response = await authFetch('/agents_public?all_exchange_only=true');

        if (response.ok) {
            window.all_exchange_only_agents = await response.json();
            return window.all_exchange_only_agents;
        } else {
            console.error("Failed to fetch exchange-only agents");
            window.all_exchange_only_agents = [];
            return [];
        }
    } catch (error) {
        console.error("Error in fetchAllExchangeOnlyAgents:", error);
        window.all_exchange_only_agents = [];
        return [];
    }
}