import {authFetch} from "../auth/auth.js";
import {displayErrorMessage, updateMetaTags} from "../utils.js";
import {RenderAnalysesList} from "../ai_analysis/ai_analysis.js";

export function setupAIHelper() {
}

function formatCurrency(value) {
    return new Intl.NumberFormat("da-DK", {
        style: "currency",
        currency: "DKK",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "—";
}

export async function loadAIResults() {
    const res = await authFetch("/ai_results");
    if (!res.ok) {
        console.error("Failed to fetch AI results", res.status);
        displayErrorMessage("Der opstod en fejl, opdater siden for at prøve igen")
        return;
    }
    const json = await res.json();
    RenderAnalysesList(json);
}

export async function renderAIResult(id) {

    const response = await authFetch(`/ai_results/${id}`);
    if (!response.ok) {
        let body = await response.json()
        displayErrorMessage("Der skete en fejl");
        return;
    }

    const result = await response.json();

    setText("ai-result-association", result.association_name);
    renderAIScore({ score: result.score});
    setText("ai-conclusion-text", result.conclusion);
    renderStrengthsWeaknesses(result.strengths, result.weaknesses);

    document.getElementById("debt-ratio").innerText = "~ " + result.extracted_metrics.debt_ratio.value  + "%";
    // document.getElementById("reserves").innerText    = "~ " + formatCurrency(result.extracted_metrics.reserves.value);
    document.getElementById("trappelaan").innerText  = result.extracted_metrics.trappelaan ? "Ja" : "Nej";
    document.getElementById("property-value").innerText = "~ " + formatCurrency(result.extracted_metrics.property_value.value);
    document.getElementById("total-debt").innerText     = "~ " + formatCurrency(result.extracted_metrics.total_debt.value);
    // renderLoans(result)


    // SEO
    const cleanUrl = `${window.location.origin}/ai-resultat?id=${id}`;
    const seoTitle = `✨ AI Analyse af ${result.association_name} | roomies`;
    const seoDescription = result.conclusion;
    updateMetaTags(seoTitle, seoDescription, cleanUrl);
}


function scoreMeta(score){
    if (score === 0) return { color: "#dc2626", desc: "Ingen data eller meget høj risiko" };
    if (score <= 39)  return { color: "#ef4444", desc: "Væsentlige udfordringer eller usikkerheder" };
    if (score <= 69)  return { color: "#f59e0b", desc: "Både styrker og svagheder" };
    if (score <= 89)  return { color: "#22c55e", desc: "Generelt sund økonomi, få risici" };
    return               { color: "#16a34a", desc: "Stærk økonomi og lav risiko" };
}


export function renderAIScore({ score, confidencePct }){
    const s = Math.max(0, Math.min(100, Number(score) || 0));
    const { color, desc } = scoreMeta(s);

    const ring = document.getElementById("ai-score-ring");
    ring.style.setProperty("--pct", s);
    ring.style.setProperty("--ring", color);

    if (s === 0 ) {
        document.getElementById("ai-score-value").textContent = '⚠';
    } else {
        document.getElementById("ai-score-value").textContent = s;
    }

    document.getElementById("ai-score-desc").textContent = desc;
}

function li(iconClass, text, colorClass){
    const li = document.createElement('li');
    li.className = 'd-flex align-items-start mb-3';
    li.innerHTML = `
    <i class="${iconClass} fs-4 ${colorClass} me-3" style="line-height:1;"></i>
    <span class="flex-grow-1">${text}</span>
  `;
    return li;
}

function renderStrengthsWeaknesses(strengths = [], weaknesses = []) {
    const sUL = document.getElementById('ai-strengths');
    const wUL = document.getElementById('ai-weaknesses');

    if (sUL) {
        sUL.innerHTML = '';
        strengths.forEach(t => sUL.appendChild(li('bi bi-check2-circle', t, 'text-success')));
        if (!strengths.length) sUL.appendChild(li('bi bi-dash-circle', 'Ingen styrker identificeret', 'text-muted'));
    }

    if (wUL) {
        wUL.innerHTML = '';
        weaknesses.forEach(t => wUL.appendChild(li('bi bi-exclamation-circle', t, 'text-warning')));
        if (!weaknesses.length) wUL.appendChild(li('bi bi-dash-circle', 'Ingen svagheder identificeret', 'text-muted'));
    }
}

function renderLoans(result) {
    const list = document.getElementById("loan-list");
    list.innerHTML = "";
    const loans = result?.extracted_metrics?.loans || [];
    if (!loans.length) {
        list.innerHTML = `<div class="text-muted">Ingen lån fundet</div>`;
        return;
    }

    loans.forEach(l => {
        const rd   = l.remaining_debt?.value;
        const rate = l.interest_rate?.value;
        const type = l.type?.value;

        const item = document.createElement("div");
        item.className = "border rounded-3 p-3 bg-white";
        item.innerHTML = `
      <div class="row g-3 text-center text-md-start">
        <div class="col-12 col-md-4">
          <div class="text-muted small">Restgæld</div>
          <div class="fw-bold">~ ${formatCurrency(rd)}</div>
        </div>
        <div class="col-6 col-md-4">
          <div class="text-muted small">Rente</div>
          <div class="fw-bold">${rate}%</div>
        </div>
        <div class="col-6 col-md-4">
          <div class="text-muted small">Type</div>
          <div class="fw-bold">${type}</div>
        </div>
      </div>`;
        list.appendChild(item);
    });
}
