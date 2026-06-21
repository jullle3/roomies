import {authFetch} from "../auth/auth.js";
import {areaAutocompleteOptions} from "../config/hardcoded_data.js";
import {displayErrorMessage, displaySuccessMessage, ensureCurrentUserLoaded, isLoggedIn} from "../utils.js";
import {showView} from "../views/viewManager.js";
import {ensureRoomieProfile, hasFilledRoomieProfile} from "../onboarding/roomie_onboarding.js";

const MAX_AGENTS = 5;
const MAX_AREA_SUGGESTIONS = 4;
const AGENTS_API_BASE = "/roomies/agents";
const AREA_LOOKUP = new Map(areaAutocompleteOptions.map(area => [String(area.id), area]));

let cachedAgents = null;
let overviewBound = false;
let formBound = false;
let selectedAreas = [];

export function setupSearchAgentView() {
    bindOverviewActions();
    bindFormContainers();
}

export function invalidateSearchAgentCache() {
    cachedAgents = null;
}

export async function renderSearchAgentOverview() {
    const loading = document.getElementById("agent-loading");
    const grid = document.getElementById("agent-grid");
    const empty = document.getElementById("agent-empty");
    const actions = document.getElementById("agent-header-actions");

    if (!loading || !grid || !empty || !actions) return;

    loading.classList.remove("d-none");
    grid.innerHTML = "";
    empty.classList.add("d-none");
    actions.classList.add("d-none");

    if (!isLoggedIn()) {
        updateOverviewEmptyStateCopy({
            title: "Få besked, når nye værelser matcher dig",
            text: "Opret en gratis SøgeAgent med dit budget og dine ønskede områder. Så holder vi øje med nye værelser for dig.",
            cta: "Opret gratis SøgeAgent"
        });
        loading.classList.add("d-none");
        empty.classList.remove("d-none");
        return;
    }

    try {
        const agents = await fetchAgents();
        cachedAgents = agents;
        updateOverviewEmptyStateCopy({
            title: "Du har ingen aktive SøgeAgent",
            text: "Opret en gratis SøgeAgent, så du hurtigt får besked, når der kommer et værelse, der matcher din pris og dit område.",
            cta: "Opret min første SøgeAgent"
        });

        loading.classList.add("d-none");
        actions.classList.toggle("d-none", agents.length >= MAX_AGENTS);
        empty.classList.toggle("d-none", agents.length > 0);

        grid.innerHTML = agents.map(renderAgentCard).join("");

        if (agents.length >= MAX_AGENTS) {
            grid.insertAdjacentHTML("beforeend", renderLimitCard());
        }
    } catch (error) {
        console.error("Kunne ikke hente SøgeAgenter:", error);
        loading.classList.add("d-none");
        grid.innerHTML = renderErrorCard("Vi kunne ikke hente dine SøgeAgenter lige nu.");
    }
}

function updateOverviewEmptyStateCopy({title, text, cta}) {
    const empty = document.getElementById("agent-empty");
    if (!empty) return;

    const titleEl = empty.querySelector("h3");
    const textEl = empty.querySelector("p");
    const ctaEl = empty.querySelector("a span");

    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    if (ctaEl) ctaEl.textContent = cta;
}

export async function renderSearchAgentCreate() {
    const user = await ensureCurrentUserLoaded();
    renderAgentForm({mode: "create"});

    // Inform (don't block) users who haven't filled out their roomie profile yet
    if (!hasFilledRoomieProfile(user)) {
        showRoomieProfilePromptModal();
    }
}

export async function renderSearchAgentEdit(agentId) {
    const mount = getFormMount("agent_edit");
    if (!mount) return;

    if (!agentId) {
        mount.innerHTML = renderErrorPanel("Vi mangler et SøgeAgent-id.");
        return;
    }

    mount.innerHTML = renderFormLoading();

    try {
        const agent = await fetchAgent(agentId);
        renderAgentForm({mode: "edit", agent});
    } catch (error) {
        console.error("Kunne ikke hente SøgeAgent:", error);
        mount.innerHTML = renderErrorPanel("Vi kunne ikke hente den SøgeAgent.");
    }
}

function bindOverviewActions() {
    const overview = document.getElementById("agent");
    if (!overview || overviewBound) return;

    overviewBound = true;

    overview.addEventListener("click", async event => {
        const editLink = event.target.closest("[data-agent-edit]");
        if (editLink) {
            event.preventDefault();
            event.stopPropagation();
            await showView("agent_edit", new URLSearchParams({id: editLink.dataset.agentEdit}));
            return;
        }

        const deleteButton = event.target.closest("[data-agent-delete]");
        if (deleteButton) {
            event.preventDefault();
            await handleDeleteAgent(deleteButton.dataset.agentDelete);
        }
    });
}

function bindFormContainers() {
    if (formBound) return;
    formBound = true;

    document.addEventListener("submit", async event => {
        const form = event.target.closest("#roomie-agent-form");
        if (!form) return;

        event.preventDefault();
        await handleAgentFormSubmit(form);
    });

    document.addEventListener("click", event => {
        const areaOption = event.target.closest("[data-agent-area-option]");
        if (areaOption) {
            event.preventDefault();
            addSelectedArea(areaOption.dataset.agentAreaOption);
            return;
        }

        const removeArea = event.target.closest("[data-agent-area-remove]");
        if (removeArea) {
            event.preventDefault();
            selectedAreas = selectedAreas.filter(id => id !== removeArea.dataset.agentAreaRemove);
            renderSelectedAreas();
            updateAreaInputValue();
            return;
        }
    });

    document.addEventListener("input", event => {
        if (event.target?.id === "roomie-agent-area-search") {
            renderAreaSuggestions(event.target.value);
        }
    });
}

function renderAgentForm({mode, agent = null}) {
    const viewId = mode === "edit" ? "agent_edit" : "agent_create";
    const mount = getFormMount(viewId);
    if (!mount) return;

    selectedAreas = normalizeAreaIds(agent?.criteria?.areas);
    mount.innerHTML = renderFormMarkup(mode, agent);
    renderSelectedAreas();
    renderAreaSuggestions("");

    const areaSearch = document.getElementById("roomie-agent-area-search");
    if (areaSearch) {
        areaSearch.addEventListener("keydown", event => {
            if (event.key !== "Enter") return;
            event.preventDefault();

            const firstOption = document.querySelector("[data-agent-area-option]");
            if (firstOption) addSelectedArea(firstOption.dataset.agentAreaOption);
        });
    }
}

async function handleAgentFormSubmit(form) {
    const submitButton = form.querySelector("[type='submit']");
    const mode = form.dataset.mode;
    const agentId = form.dataset.agentId;
    const payload = getFormPayload(form);

    if (payload.criteria.monthly_price_max == null) {
        displayErrorMessage("Indtast en maks husleje pr. måned.");
        return;
    }

    submitButton.disabled = true;
    submitButton.dataset.originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Gemmer...';

    try {
        const response = await authFetch(mode === "edit" ? `${AGENTS_API_BASE}/${encodeURIComponent(agentId)}` : AGENTS_API_BASE, {
            method: mode === "edit" ? "PUT" : "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(await getApiErrorMessage(response));
        }

        cachedAgents = null;
        displaySuccessMessage(mode === "edit" ? "Din SøgeAgenter opdateret." : "Din SøgeAgenter oprettet.");
        await showView("agent");
    } catch (error) {
        console.error("Kunne ikke gemme SøgeAgent:", error);
        displayErrorMessage(error.message || "Kunne ikke gemme din SøgeAgentlige nu.");
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = submitButton.dataset.originalText || "Gem SøgeAgent";
    }
}

async function handleDeleteAgent(agentId) {
    if (!agentId) return;
    if (!window.confirm("Vil du slette denne SøgeAgent?")) return;

    try {
        const response = await authFetch(`${AGENTS_API_BASE}/${encodeURIComponent(agentId)}`, {method: "DELETE"});
        if (!response.ok) {
            throw new Error(await getApiErrorMessage(response));
        }

        cachedAgents = null;
        displaySuccessMessage("SøgeAgenter slettet.");
        await renderSearchAgentOverview();
    } catch (error) {
        console.error("Kunne ikke slette SøgeAgent:", error);
        displayErrorMessage(error.message || "Kunne ikke slette din SøgeAgentlige nu.");
    }
}

async function fetchAgents() {
    if (cachedAgents) return cachedAgents;

    const response = await authFetch(AGENTS_API_BASE);
    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response));
    }

    const agents = await response.json();
    return Array.isArray(agents) ? agents : [];
}

async function fetchAgent(agentId) {
    const response = await authFetch(`${AGENTS_API_BASE}/${encodeURIComponent(agentId)}`);
    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response));
    }

    return response.json();
}

function getFormPayload(form) {
    const data = new FormData(form);
    const monthlyPriceMax = parseInteger(data.get("monthly_price_max"));
    const name = String(data.get("name") || "").trim();

    return {
        name: name || null,
        criteria: {
            monthly_price_max: monthlyPriceMax,
            areas: selectedAreas.length ? selectedAreas.map(Number).filter(Number.isFinite) : null,
            text: "Min SøgeAgent"
        }
    };
}

function renderAgentCard(agent) {
    const id = getAgentId(agent);
    const criteria = agent.criteria || {};
    const name = agent.name || "Min SøgeAgent";
    const areas = normalizeAreaIds(criteria.areas);
    const areaSummary = areas.length ? areas.map(formatAreaLabel).join(", ") : "Alle områder";

    return `
        <div class="col-12 col-lg-6">
            <article class="roomie-agent-card h-100">
                <div class="d-flex align-items-start justify-content-between gap-3 mb-4">
                    <div>
                        <span class="roomie-agent-eyebrow"><i class="fa-solid fa-bell me-2"></i>Aktiv overvågning</span>
                        <h2 class="h4 fw-bold mt-2 mb-1">${escapeHtml(name)}</h2>
                        <p class="text-muted mb-0">${escapeHtml(areaSummary)}</p>
                    </div>
                    <div class="roomie-agent-status">
                        <i class="fa-solid fa-check"></i>
                    </div>
                </div>

                <div class="roomie-agent-card-grid mb-4">
                    <div>
                        <span>Maks husleje</span>
                        <strong>${formatCurrency(criteria.monthly_price_max)}</strong>
                    </div>
                </div>

                <div class="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-center justify-content-between gap-3 mt-auto">
                    <span class="small text-muted fw-semibold">Opdateret ${formatTimestamp(agent.updated || agent.created)}</span>
                    <div class="d-flex gap-2">
                        <a href="/boligovervaagning-rediger?id=${encodeURIComponent(id)}" data-agent-edit="${escapeHtml(id)}" class="btn btn-outline-dark rounded-pill fw-bold px-4">
                            <i class="fa-solid fa-pen me-2"></i>Rediger
                        </a>
                        <button type="button" class="btn btn-light rounded-pill fw-bold px-3" data-agent-delete="${escapeHtml(id)}" aria-label="Slet ${escapeHtml(name)}">
                            <i class="fa-solid fa-trash text-danger"></i>
                        </button>
                    </div>
                </div>
            </article>
        </div>
    `;
}

function renderLimitCard() {
    return `
        <div class="col-12">
            <div class="roomie-agent-limit-card">
                <i class="fa-solid fa-circle-info"></i>
                <div>
                    <strong>Du har nået grænsen på ${MAX_AGENTS} SøgeAgents.</strong>
                    <p class="mb-0">Slet eller rediger en eksisterende agent, hvis du vil ændre din overvågning.</p>
                </div>
            </div>
        </div>
    `;
}

function renderErrorCard(message) {
    return `
        <div class="col-12">
            <div class="roomie-agent-limit-card roomie-agent-limit-card-error">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <div>
                    <strong>Der skete en fejl.</strong>
                    <p class="mb-0">${escapeHtml(message)}</p>
                </div>
            </div>
        </div>
    `;
}

function renderFormMarkup(mode, agent) {
    const criteria = agent?.criteria || {};
    const isEdit = mode === "edit";
    const agentId = getAgentId(agent);

    return `
        <section class="roomie-agent-form-shell">
            <div class="row g-4 align-items-start">
                <div class="col-lg-5">
                    <div class="roomie-agent-form-intro">
                        <span class="roomie-agent-eyebrow"><i class="fa-solid fa-wand-magic-sparkles me-2"></i>SøgeAgent</span>
                        <h1 class="display-6 fw-bold mt-3 mb-3">${isEdit ? "Rediger din SøgeAgent" : "Opret din SøgeAgent"}</h1>
                        <p class="text-muted fs-5 mb-4">Fortæl os hvor og til hvilken pris du leder, så giver vi dig besked, når et værelse matcher dine ønsker.</p>
                        <div class="roomie-agent-mini-preview">
                            <div class="roomie-agent-mini-icon"><i class="fa-solid fa-bell"></i></div>
                            <div>
                                <strong>Vi holder øje for dig</strong>
                                <span>Dit budget. Dit nabolag. Dit hjem.</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-lg-7">
                    <form id="roomie-agent-form" class="roomie-agent-form-card" data-mode="${mode}" data-agent-id="${escapeHtml(agentId)}" novalidate>
                        <div class="roomie-agent-form-block">
                            <label for="roomie-agent-name" class="form-label">Navn på din SøgeAgent</label>
                            <input id="roomie-agent-name" name="name" type="text" maxlength="200" class="form-control" value="${escapeAttribute(agent?.name || "")}" placeholder="F.eks. Nørrebro under 6.000 kr.">
                        </div>

                        <div class="roomie-agent-form-block">
                            <label for="roomie-agent-price" class="form-label">Maks husleje pr. måned</label>
                            <div class="input-group">
                                <input id="roomie-agent-price" name="monthly_price_max" type="number" min="0" max="19999999999" step="100" class="form-control" value="${escapeAttribute(criteria.monthly_price_max ?? "")}" placeholder="6000" required>
                                <span class="input-group-text">kr.</span>
                            </div>
                        </div>

                        <div class="roomie-agent-form-block">
                            <label for="roomie-agent-area-search" class="form-label">Hvor vil du bo?</label>
                            <input id="roomie-agent-area-search" type="search" class="form-control" autocomplete="off" placeholder="Søg efter postnummer eller område">
                            <p class="roomie-agent-area-hint">Alle områder er valgt, hvis du ikke tilføjer noget.</p>
                            <div id="roomie-agent-selected-areas" class="roomie-agent-selected-areas"></div>
                            <div id="roomie-agent-area-suggestions" class="roomie-agent-area-suggestions"></div>
                        </div>

                        <button type="submit" class="btn btn-primary-coral roomie-agent-submit rounded-pill fw-bold w-100">
                            <i class="fa-solid fa-check me-2"></i>${isEdit ? "Gem ændringer" : "Opret SøgeAgent"}
                        </button>
                    </form>
                </div>
            </div>
        </section>
    `;
}

function showRoomieProfilePromptModal() {
    const modalElement = ensureRoomieProfilePromptModal();
    bootstrap.Modal.getOrCreateInstance(modalElement).show();
}

function ensureRoomieProfilePromptModal() {
    const existing = document.getElementById("roomieProfilePromptModal");
    if (existing) return existing;

    const modal = document.createElement("div");
    modal.className = "modal fade";
    modal.id = "roomieProfilePromptModal";
    modal.tabIndex = -1;
    modal.setAttribute("aria-labelledby", "roomieProfilePromptModalLabel");
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content border-0 shadow-lg">
                <div class="modal-body p-4 p-md-5 text-center">
                    <div class="mb-3"><i class="fa-regular fa-id-badge fa-3x text-primary-coral"></i></div>
                    <h2 class="h4 fw-bold mb-3" id="roomieProfilePromptModalLabel">Gør din roomie-profil klar 👋</h2>
                    <p class="text-muted mb-4">
                        Du er ved at oprette en SøgeAgent. Udfyld din roomie-profil, så udlejere hurtigere kan se hvem du er, når du skriver til dem.
                    </p>
                    <div class="d-grid gap-2">
                        <button class="btn btn-primary-coral rounded-pill py-3 fw-bold" type="button" data-roomie-profile-prompt-go>
                            <i class="fa-solid fa-user-pen me-2"></i>Udfyld din profil
                        </button>
                        <button class="btn btn-light rounded-pill py-3 fw-bold" type="button" data-bs-dismiss="modal">
                            Måske senere
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("[data-roomie-profile-prompt-go]")?.addEventListener("click", () => {
        // Wait for the inform popup to fully close, then open the onboarding modal
        // so the two Bootstrap modals don't fight over the backdrop.
        modal.addEventListener("hidden.bs.modal", () => ensureRoomieProfile("agent"), {once: true});
        bootstrap.Modal.getOrCreateInstance(modal).hide();
    });

    return modal;
}

function renderAreaSuggestions(query) {
    const container = document.getElementById("roomie-agent-area-suggestions");
    if (!container) return;

    const normalizedQuery = normalizeText(query);
    const suggestions = areaAutocompleteOptions
        .filter(area => !selectedAreas.includes(String(area.id)))
        .filter(area => !normalizedQuery || area.searchText.includes(normalizedQuery))
        .slice(0, MAX_AREA_SUGGESTIONS);

    container.innerHTML = suggestions.map(area => `
        <button type="button" data-agent-area-option="${escapeAttribute(area.id)}">
            <i class="${area.icon}"></i>
            <span>${escapeHtml(area.label)}</span>
        </button>
    `).join("");
}

function renderSelectedAreas() {
    const container = document.getElementById("roomie-agent-selected-areas");
    if (!container) return;

    if (selectedAreas.length === 0) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = selectedAreas.map(id => `
        <span class="roomie-agent-area-pill">
            ${escapeHtml(formatAreaLabel(id))}
            <button type="button" data-agent-area-remove="${escapeAttribute(id)}" aria-label="Fjern ${escapeAttribute(formatAreaLabel(id))}">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </span>
    `).join("");
}

function addSelectedArea(areaId) {
    const id = String(areaId);
    if (!AREA_LOOKUP.has(id) || selectedAreas.includes(id)) return;

    selectedAreas.push(id);
    renderSelectedAreas();
    renderAreaSuggestions(document.getElementById("roomie-agent-area-search")?.value || "");
    updateAreaInputValue();
}

function updateAreaInputValue() {
    const input = document.getElementById("roomie-agent-area-search");
    if (input) input.value = "";
    renderAreaSuggestions("");
}

function getFormMount(viewId) {
    return document.querySelector(`#${viewId} .shared-components-container`);
}

function renderFormLoading() {
    return `
        <div class="roomie-agent-form-loading">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Henter...</span>
            </div>
            <p class="text-muted mt-3 mb-0">Henter din SøgeAgent...</p>
        </div>
    `;
}

function renderErrorPanel(message) {
    return `
        <div class="roomie-agent-form-shell">
            ${renderErrorCard(message)}
        </div>
    `;
}

async function getApiErrorMessage(response) {
    try {
        const body = await response.json();
        if (body?.detail === "You can only have 5 agents") {
            return "Du kan højst have 5 SøgeAgents.";
        }
        if (typeof body?.detail === "string") {
            return body.detail;
        }
        return `Serveren svarede med status ${response.status}.`;
    } catch {
        return `Serveren svarede med status ${response.status}.`;
    }
}

function getAgentId(agent) {
    return String(agent?._id || agent?.id || "");
}

function normalizeAreaIds(areas) {
    if (!Array.isArray(areas)) return [];
    return areas.map(area => String(area)).filter(area => AREA_LOOKUP.has(area));
}

function formatAreaLabel(areaId) {
    return AREA_LOOKUP.get(String(areaId))?.label || String(areaId);
}

function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "Ikke valgt";
    return `${new Intl.NumberFormat("da-DK").format(number)} kr.`;
}

function formatTimestamp(value) {
    const number = Number(value);
    const date = Number.isFinite(number) ? new Date(number * 1000) : new Date(value);
    if (Number.isNaN(date.getTime())) return "for nylig";
    return new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "short", year: "numeric"}).format(date);
}

function parseInteger(value) {
    const parsed = Number(String(value || "").replace(/\./g, ""));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function normalizeText(value) {
    return String(value || "").trim().toLocaleLowerCase("da-DK");
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
}
