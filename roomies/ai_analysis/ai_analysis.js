import {displayErrorMessage, displaySuccessMessage, isLoggedIn, prepareStripeBuyButton} from "../utils.js";
import {displayLoginModal} from "../views/viewManager.js";
import {authFetch} from "../auth/auth.js";
import {updateStripePaymentElements} from "../login/login.js";

const dropzone  = document.querySelector('.ai-dropzone');
const fileInput = document.getElementById('files');
const startBtn  = document.getElementById('ai-start');
let list = document.getElementById('upload-list');
let currentLoadedAnalysisCount = 0
let pollAbort = null;
let pollTimer = null;
// global state for fake progress
let aiStartTime = null;
let fakeTimer = null, fakePct = 0;
const MAX_SIZE = 10 * 1024 * 1024;
const REQUIRED_COUNT = 3;
const ALLOWED_MIME = new Set([
    'application/pdf'
    // 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // 'application/vnd.ms-excel',
    // 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);
// ---- Staged UX texts shown as progress grows ----
const STAGES = [
    { pct: 5,  text: "Indlæser dokumenter…" },
    { pct: 20, text: "Scanner for nøgletal…" },
    { pct: 40, text: "Krydstjekker filer..." },
    { pct: 65, text: "Vurderer risici og økonomi…" },
    { pct: 85, text: "Afslutter og kvalitetstjekker…" }
];
const ALLOWED_EXT = new Set(['pdf','doc','docx','xls','xlsx']);
const DB_NAME = 'ai-files-db';
const STORE = 'files';

// NEW: keep files here, never mutate a DataTransfer directly
/** @type {File[]} */
let files = [];

const stop = e => { e.preventDefault(); e.stopPropagation(); };
const toggleDrag = on => dropzone.classList.toggle('is-dragover', !!on);
const extOf = n => (n.lastIndexOf('.') >= 0 ? n.slice(n.lastIndexOf('.')+1).toLowerCase() : '');
const allowed = f => (f.type && ALLOWED_MIME.has(f.type)) || ALLOWED_EXT.has(extOf(f.name));
const fmtMB = b => (b/1048576).toFixed(1) + ' MB';


export async function setupAIHelper() {
    // Configure "Start analyse" button
    startBtn.onclick = async (e) => {
        e.preventDefault();
        if (!isLoggedIn()) {
            displayLoginModal('ai_analysis', new URLSearchParams());
            return;
        }

        await startAInalysis();
    };

    // 2) restore persisted files
    try {
        const restored = await restoreFiles();
        if (restored.length) {
            files = restored;
            renderList();              // will call syncInputAndButton()
        } else {
            syncInputAndButton();
        }
    } catch { syncInputAndButton(); }
}

// replace startFakeProgress with a linear version
function startFakeProgress() {
    const durationMs = 120000; // ~60s to reach 90%
    const cap       = 99;            // stop at 99% until real done
    const interval  = 500;      // tick every 0.5s

    clearInterval(fakeTimer);
    fakePct = 0;
    aiStartTime = Date.now();
    setAIProgress(fakePct);

    const steps = Math.ceil(durationMs / interval);
    const increment = cap / steps;               // constant increment

    fakeTimer = setInterval(() => {
        fakePct = Math.min(cap, fakePct + increment);
        setAIProgress(fakePct);
    }, interval);
}

function stopFakeProgress(finalPct = 100) {
    clearInterval(fakeTimer);
    setAIProgress(finalPct);
}

// Keep track of how many analysis are currently loaded. This is used to determine when polling should stop.
export function setCurrentLoadedAnalysis(val) {
    currentLoadedAnalysisCount = val;
}

function syncInputAndButton() {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    fileInput.files = dt.files;
    startBtn.disabled = files.length < REQUIRED_COUNT;
    list.classList.toggle('d-none', files.length === 0);
}

function renderList() {
    if (!files.length) { list.innerHTML = ''; syncInputAndButton(); return; }

    let html = `<div class="text-muted small mb-2">Uploadede filer (${files.length}/4)</div>`;
    html += files.map((f, idx) => `
      <div class="d-flex align-items-center justify-content-between border rounded-3 px-3 py-2 mb-2">
        <div class="d-flex align-items-center">
          <i class="bi bi-file-earmark-text me-2 text-primary"></i>
          <div class="small">
            <div class="fw-semibold text-truncate" style="max-width: 60vw;">${f.name}</div>
            <div class="text-secondary">${fmtMB(f.size)}</div>
          </div>
        </div>
        <button type="button" class="btn btn-link text-danger p-0 small remove-file" data-index="${idx}">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    `).join('');

    list.innerHTML = html;

    list.querySelectorAll('.remove-file').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = Number(btn.dataset.index);
            files = files.filter((_, idx) => idx !== i);
            renderList();
        });
    });

    syncInputAndButton();
}

function addFiles(fileList) {
    let changed = false;
    for (const f of fileList) {
        if (!allowed(f)){
            displayErrorMessage("Ugyldigt fil format")
            continue;
        }
        if (f.size > MAX_SIZE) {
            displayErrorMessage("Filen er for stor")
            continue;
        }
        const dup = files.some(x => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified);
        if (!dup) { files.push(f); changed = true; }
    }
    onStateChanged(changed); // rerender if changed, else just resync button/input
}

function openDB() {
    return new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}

async function persistFiles(files) {
    if (!('indexedDB' in window)) return;
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    await new Promise((ok, err) => { const q = st.clear(); q.onsuccess = ok; q.onerror = () => err(q.error); });
    await Promise.all([...files].map(f => new Promise((ok, err) => {
        const req = st.put({ id: `${f.name}|${f.size}|${f.lastModified}`, name: f.name, type: f.type, lastModified: f.lastModified, blob: f });
        req.onsuccess = ok; req.onerror = () => err(req.error);
    })));
    db.close();
}

async function restoreFiles() {
    if (!('indexedDB' in window)) return [];
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const st = tx.objectStore(STORE);
    const rows = await new Promise((ok, err) => {
        const req = st.getAll(); req.onsuccess = () => ok(req.result || []); req.onerror = () => err(req.error);
    });
    db.close();
    return rows.map(r => new File([r.blob], r.name, { type: r.type, lastModified: r.lastModified }));
}

function syncInput() {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    fileInput.files = dt.files;
}

// call after any state change (add/remove)
async function onStateChanged(rerender) {
    if (rerender) renderList(); else syncInputAndButton();
    // fire-and-forget is fine if you prefer:
    try { await persistFiles(files); } catch {}
}

export function RenderAnalysesList(items) {
    const list = document.getElementById('ai-recent');
    const section = document.getElementById('ai-analysis-results');
    list.innerHTML = ''; // clear old entries

    if (!items || items.length === 0) {
        section.classList.add('d-none');
        return;
    }

    const now = Math.floor(Date.now() / 1000);

    // populate list
    items.forEach(item => {
        const isNew = (now - item.created) < 3600; // 1 hour = 3600 sec
        const newBadge = isNew
            ? `<span class="badge bg-primary rounded-pill ms-2">Ny</span>`
            : '';

        const li = document.createElement('li');
        li.className = 'list-group-item py-2 px-3 d-flex justify-content-between align-items-center';
        li.innerHTML = `
          <span class="text-secondary">
            ${item.association_name} ${newBadge}
          </span>
          <a href="/ai-resultat"
             class="btn btn-link text-primary fw-semibold text-decoration-none"
             onclick="event.preventDefault(); event.stopPropagation(); showView('ai_result', new URLSearchParams({ id: '${item._id}' }))">
             <i class="bi bi-arrow-right ms-1"></i>
          </a>
        `;
        list.appendChild(li);
    });

    // show when items exist
    section.classList.remove('d-none');
    setCurrentLoadedAnalysis(items.length);
}

function showAIProgress() {
    document.getElementById('ai-progress')?.classList.remove('d-none');
}
function hideAIProgress() {
    document.getElementById('ai-progress')?.classList.add('d-none');
}
function setAIStatus(text) {
    const el = document.getElementById('ai-progress-text');
    if (el) el.textContent = text;
}


/** Build FormData from current files */
function buildFormData() {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f, f.name));
    return fd;
}


/** Start bulk upload and begin polling */
export async function startAInalysis() {
    if (!isLoggedIn()) {
        displayLoginModal('ai_analysis', new URLSearchParams());
        return;
    }
    if (!files.length) return;

    // prevent double-clicks
    const startBtn = document.getElementById('ai-start');
    if (startBtn) startBtn.disabled = true;

    // init fake metrics per run
    aiStartTime = Date.now();
    window._aiMaxItems = 900 + Math.floor(Math.random() * 400); // 900–1300

    displaySuccessMessage("Filer uploadet. Starter analyse...", 10000)

    const res = await authFetch('/ai_analysis', {
        method: 'POST',
        body: buildFormData()
    });
    if (!res.ok){
        setTimeout(() => { if (startBtn) startBtn.disabled = false; }, 0);
        let body = await res.json()
        displayErrorMessage(body.detail, 10000);

        // Payment required
        if (res.status === 402) {
            await prepareStripeBuyButton();
            updateStripePaymentElements();
            const el = document.getElementById('stripePayment');
            const clientRefId = el?.getAttribute('client-reference-id')?.trim();
            if (!clientRefId) {
                console.error('Betaling afbrudt: mangler client-reference-id');
                displayErrorMessage('Betalingen blev afbrudt, da vi ikke kunne identificere din bruger. Log ind og prøv igen.', 8000);
                if (popup) popup.close();
                return;
            }
            new bootstrap.Modal('#paymentModal').show();
        }
        return;
    }
    const analysis_id = await res.json();
    // Begin polling with load bar
    showAIProgress();
    startFakeProgress();
    beginAIPolling(analysis_id);
}


/** Poll /ai_results until our analysis is ready or failed */
export function beginAIPolling(id, { intervalMs = 10000, timeoutMs = 150 * 1000 } = {}) {
    // cancel previous
    cancelAIPolling();

    const ac = new AbortController();
    pollAbort = ac;
    const started = Date.now();

    async function tick() {
        if (ac.signal.aborted) return;
        const res = await authFetch(`/ai_results/${encodeURIComponent(id)}`, {
            signal: ac.signal,
            headers: { 'Cache-Control': 'no-cache' }
        });

        if (!res.ok) {
            throw new Error(`Poll failed ${res.status}`);
        } else {
            const result = await res.json();
            const status = (result.status || "").toLowerCase();

            if (status === "completed") {
                stopFakeProgress(100);
                hideAIProgress();
                cancelAIPolling();
                await clearFiles();
                displaySuccessMessage('Analyse færdig')
                await showView('ai_result', new URLSearchParams({ id }));
                return;
            }
            if (status === "failed") {
                stopFakeProgress(fakePct);
                hideAIProgress();
                cancelAIPolling();
                const startBtn = document.getElementById('ai-start');
                if (startBtn) startBtn.disabled = false;
                displayErrorMessage("Analysen mislykkedes. Prøv igen.");
            }
        }

        if (Date.now() - started > timeoutMs) {
            stopFakeProgress(fakePct)
            hideAIProgress();
            cancelAIPolling();
            return;
        }
        setTimeout(tick, intervalMs);
    }
    setTimeout(tick, intervalMs); // first poll after interval
}

/** Stop any active AI polling */
export function cancelAIPolling() {
    if (pollAbort) {
        try { pollAbort.abort(); } catch {}
        pollAbort = null;
    }
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}
function setAIProgress(p) {
    const bar = document.getElementById('ai-progress-bar');
    const pct = Math.max(0, Math.min(100, Math.round(p)));
    if (bar) bar.style.width = pct + '%';

    // staged status text
    const stageText = STAGES.reduce((t, s) => (pct >= s.pct ? s.text : t), "Starter…");
    setAIStatus(stageText);
    const txt = document.getElementById('ai-progress-percent');
    if (txt) txt.textContent = `${pct}% færdig`;
}


/**
 * Return the _id of the newest document (highest created timestamp).
 */
function getNewestId(docs) {
    if (!Array.isArray(docs) || docs.length === 0) return null;

    return docs.reduce((newest, doc) => {
        if (!newest || (doc.created || 0) > (newest.created || 0)) {
            return doc;
        }
        return newest;
    }, null)?._id || null;
}

async function clearFiles() {
    files = [];
    try { await persistFiles(files); } catch {}
    // UI reset
    if (list) list.innerHTML = '';
    const dt = new DataTransfer();
    fileInput.files = dt.files;
    startBtn.disabled = true;
    list.classList.add('d-none');
}


if (!list) {
    list = document.createElement('div');
    list.id = 'upload-list';
    list.className = 'mt-3 d-none';
    dropzone.after(list);
}

['dragenter','dragover'].forEach(evt =>
    dropzone.addEventListener(evt, e => { stop(e); toggleDrag(true); })
);
['dragleave','dragend','drop'].forEach(evt =>
    dropzone.addEventListener(evt, e => { stop(e); if (evt !== 'dragenter' && evt !== 'dragover') toggleDrag(false); })
);

dropzone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (dt?.files?.length) addFiles(dt.files);
});

fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
    fileInput.value = ''; // allow reselecting the same files
});


