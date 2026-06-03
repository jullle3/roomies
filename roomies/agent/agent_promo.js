import { showView } from "../views/viewManager.js";
import { authFetch } from "../auth/auth.js";
import { isLoggedIn } from "../utils.js";

let promoTimeout = null;

const PROMO_DELAY_MS = 30000; // 30 Seconds: The "Perfect Time"
const STORAGE_KEY = 'agent_promo_dismissed_v1';

export async function scheduleAgentPromo() {
    // 1. Don't show if already dismissed
    if (localStorage.getItem(STORAGE_KEY)) return;
    if (window.listBoligMatchCtaVisible) return;
    if (!(await shouldShowAgentPromo())) return;

    // 2. Clear any pending timer (e.g. if switching between list/map view quickly)
    if (promoTimeout) clearTimeout(promoTimeout);

    // 3. Start the timer
    promoTimeout = setTimeout(async () => {
        if (await shouldShowAgentPromo()) {
            await renderAndShowPromo();
        }
    }, PROMO_DELAY_MS);
}

export function cancelAgentPromo() {
    // Stop the timer if user leaves the relevant view before 15s
    if (promoTimeout) clearTimeout(promoTimeout);

    // Optional: Hide immediately if they navigate away?
    // Usually better to let it stay if it's already visible,
    // but here we'll keep it bound to the view.
    const el = document.getElementById('agent-promo-card');
    if (el) {
        el.classList.remove('visible');
        setTimeout(() => el.remove(), 400);
    }
}

async function renderAndShowPromo() {
    if (document.getElementById('agent-promo-card')) return; // Already there
    if (window.listBoligMatchCtaVisible) return;
    if (!(await shouldShowAgentPromo())) return;

    const html = `
        <div id="agent-promo-card" class="card agent-promo-card shadow rounded-4 p-4">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div class="agent-promo-icon">
                    <i class="fa-solid fa-bell"></i>
                </div>
                <button type="button" id="close-agent-promo" class="agent-promo-close" aria-label="Luk">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            
            <h6 class="fw-bold mb-2 text-dark">Gå ikke glip af drømmeboligen</h6>
            
            <p class="text-muted small mb-4" style="line-height: 1.5;">
                Opret et gratis BoligMatch og få besked direkte i indbakken, når der kommer nye andelsboliger.
            </p>
            
            <div class="d-grid">
                <button id="btn-create-agent-promo" class="btn btn-primary rounded-pill fw-semibold py-2">
                    Opret BoligMatch
                </button>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // Slight delay to allow DOM insert before triggering CSS transition
    setTimeout(() => {
        const el = document.getElementById('agent-promo-card');
        if(el) el.classList.add('visible');
    }, 50);

    // Attach Events
    document.getElementById('close-agent-promo').addEventListener('click', dismissPromo);
    document.getElementById('btn-create-agent-promo').addEventListener('click', () => {
        dismissPromo();
        showView('agent');
    });
}

async function shouldShowAgentPromo() {
    if (!isLoggedIn()) return true;

    try {
        const agents = Array.isArray(window.agents)
            ? window.agents
            : await getAgentsForPromo();

        return Array.isArray(agents) && agents.length === 0;
    } catch (error) {
        console.warn('Could not verify BoligMatch state for promo:', error);
        return false;
    }
}

async function getAgentsForPromo() {
    if (window.agentsFetchPromise) {
        return await window.agentsFetchPromise;
    }

    const response = await authFetch('/agent');
    window.agents = response.ok ? await response.json() : null;
    return window.agents;
}

function dismissPromo() {
    localStorage.setItem(STORAGE_KEY, 'true');
    const el = document.getElementById('agent-promo-card');
    if (el) {
        el.classList.remove('visible');
        // Remove from DOM after animation finishes
        setTimeout(() => el.remove(), 400);
    }
}
