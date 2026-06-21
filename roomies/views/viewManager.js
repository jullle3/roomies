import {
    isLoggedIn,
    setupBootstrapTooltips,
    updateMetaTags
} from "../utils.js";
import {basePath} from "../config/config.js";
import {loadProfileView} from "../profile/profile.js";
import {renderConversations} from "../conversations/conversations.js";
import {closeNavbarMenu} from "../header/header.js";
import {renderRoomDetail} from "../room_detail/room_detail.js";
import {
    getBlogPostBySlug,
    getBlogPostStructuredData,
    getBlogPostUrl,
    getBlogStructuredData,
    renderBlogPage
} from "../blog/blog.js";
import {
    renderSearchAgentCreate,
    renderSearchAgentEdit,
    renderSearchAgentOverview
} from "../roomie_agent/roomie_agent.js";

// Setup click events for all views
const views = {
    landing: document.getElementById('landing'),
    soeg_vaerelse: document.getElementById('soeg_vaerelse'),
    room_detail: document.getElementById('room_detail'),
    udlej_vaerelse: document.getElementById('udlej_vaerelse'),
    profile: document.getElementById('profile'),
    conversations: document.getElementById('conversations'),
    agent: document.getElementById('agent'),
    agent_create: document.getElementById('agent_create'),
    agent_edit: document.getElementById('agent_edit'),
    terms_and_conditions: document.getElementById('terms_and_conditions'),
    faq: document.getElementById('faq'),
    blog: document.getElementById('blog'),
};

// --- DOM ELEMENTS FOR PSEO HANDLING ---
const staticSeoContent = document.getElementById('static-seo-content');
const appRoot = document.getElementById('root');


// --- routes (path -> view) ---
// Enables paths to load specific views.  "roomies.dk/kort" loads kort view etc.
const routeToView = {
    '/': 'landing',
    '/ledige-vaerelser': 'soeg_vaerelse',
    '/vaerelse': 'room_detail',
    '/udlej-vaerelse': 'udlej_vaerelse',
    '/boligovervaagning': 'agent',
    '/boligovervaagning-opret': 'agent_create',
    '/boligovervaagning-rediger': 'agent_edit',
    '/profil': 'profile',
    '/beskeder': 'conversations',
    '/vilkaar': 'terms_and_conditions',
    '/blog': 'blog',
    '/login': 'login',
    '/spoergsmaal-om-roomies': 'faq',
};

// Starting view
let currentView = 'landing';
let previousView = null;
let currentViewParams = new URLSearchParams();

export function getCurrentView() {
    return currentView;
}

// The view navigated away from when entering the current one.
export function getPreviousView() {
    return previousView;
}

export function getCurrentViewParams() {
    return new URLSearchParams(currentViewParams.toString());
}

// All views that require login
const loginRequiredViews = ["login", "conversations", "agent_create", "agent_edit"];

// Store requested view to remember redirects after login popup
export let viewAfterLogin = null;
export let viewParamsAfterLogin = new URLSearchParams();
const POST_ONBOARDING_CONTEXT_KEY = 'postOnboardingContext';

// Store scroll position per SPA URL. New navigation starts at the top, while
// browser back/forward restores the exact place the user left.
const scrollPositions = {};
const SCROLL_RESTORE_DELAYS_MS = [0, 80, 180];
let currentScrollKey = getCurrentLocationScrollKey();

if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}


export function resetViewAfterLogin() {
    viewAfterLogin = null;
    viewParamsAfterLogin = new URLSearchParams();
}

export function rememberPostOnboardingContext(context = {}) {
    const params = normalizeParams(context.params);
    const returnUrl = context.returnUrl || buildViewUrl(context.view, params) || window.location.href;

    localStorage.setItem(POST_ONBOARDING_CONTEXT_KEY, JSON.stringify({
        view: context.view || currentView || null,
        params: params.toString(),
        action: context.action || null,
        returnUrl,
        createdAt: Date.now()
    }));
}

export function getPostOnboardingContext() {
    const raw = localStorage.getItem(POST_ONBOARDING_CONTEXT_KEY);
    if (!raw) return null;

    try {
        const context = JSON.parse(raw);
        if (!context || typeof context !== 'object') return null;
        return context;
    } catch (err) {
        localStorage.removeItem(POST_ONBOARDING_CONTEXT_KEY);
        return null;
    }
}

export function getPostOnboardingReturnUrl(fallbackUrl = window.location.href) {
    const context = getPostOnboardingContext();
    const returnUrl = context?.returnUrl || fallbackUrl;

    try {
        const url = new URL(returnUrl, window.location.origin);
        if (url.origin !== window.location.origin) {
            return fallbackUrl;
        }
        return url.href;
    } catch (err) {
        return fallbackUrl;
    }
}

export function clearPostOnboardingContext() {
    localStorage.removeItem(POST_ONBOARDING_CONTEXT_KEY);
}


// Skjul alle views, undtagen det aktive
function ensureViewVisibility(viewName){
    Object.values(views).forEach(v => {
        if (!v) return; // <-- Prevents crashes if HTML and JS are out of sync
        v.classList.remove('active');
        v.style.display = 'none';

        // SEO and accessibility.
        v.setAttribute('aria-hidden', 'true');
        v.setAttribute('hidden', '');
    });

    if (views[viewName]) {
        views[viewName].style.display = 'block';

        // Make the active view visible for crawlers.
        views[viewName].removeAttribute('aria-hidden');
        views[viewName].removeAttribute('hidden');
    }
}

const landingAnchorTargets = new Set(['#scanner-section']);

// All views are to be accessed via this method. It authorizes the user (if needed), loads required data and shows the
// view afterward
// UPDATE: Added 'updateUrl' parameter (defaults to true) to support PSEO
export async function showView(view, viewParams = new URLSearchParams(), updateUrl = true, options = {}) {
    viewParams = normalizeParams(viewParams);
    const requestedHash = normalizeLandingHash(view, options.hash);
    const shouldRestoreScroll = options.restoreScroll === true;

    // 1. Check if login is required
    if (loginRequiredView(view) && !isLoggedIn()) {
        displayLoginModal(view, viewParams);
        return;
    }

    if (view === "login"){
        return;
    }

    if (!views[view]) {
        console.log(`Invalid view: "${view}". Defaulting to 'landing'.`);
        view = 'landing';
    }

    // Restore params in case the user was redirected to a view after navigating through the login modal
    if (viewParams.toString() === "" && viewParamsAfterLogin instanceof URLSearchParams) {
        const restored = viewParamsAfterLogin.toString();
        if (restored !== "") {
            viewParams = new URLSearchParams(restored);   // clone
            viewParamsAfterLogin = new URLSearchParams(); // clear after use
        }
    }

    // --------------------------------------------------
    // NOW THAT WE KNOW WE ARE PROCEEDING, UPDATE THE DOM
    // --------------------------------------------------
    
    const targetScrollKey = options.scrollKey || getScrollKeyForView(view, viewParams, requestedHash);

    // Save the outgoing page before switching views. Fresh SPA navigation starts
    // at top, but browser back/forward can restore this saved position.
    saveScrollPosition(currentView, currentScrollKey);

    ensureViewVisibility(view);
    previousView = currentView;
    currentView = view;
    currentViewParams = new URLSearchParams(viewParams.toString());

    // --- FIX 1: HIDE STATIC CONTENT & SHOW APP ROOT ---
    // When the SPA takes over (user clicks a link), we must hide the PSEO content
    // and ensure the app container is visible.
    if (staticSeoContent) {
        staticSeoContent.style.display = 'none';
    }
    if (appRoot) {
        appRoot.style.display = 'block';
    }
    // --------------------------------------------------

    try {
            await loadViewData(view, viewParams);
            updateViewStatus(view);
    } catch (err) {
        console.error(`Error loading view "${view}":`, err);
        // Ensure the view is still shown (even if data failed to load)
        updateViewStatus(view);
    }

    if (shouldRestoreScroll && !requestedHash) {
        await restoreViewScroll(view, targetScrollKey);
    } else {
        jumpToTopInstant();
    }
    // --- UPDATED URL LOGIC ---
    // Store relevant params in URL such that users can share them with friends.
    if (updateUrl) {
        const path = viewToRoute[view] || "/";
        const param_string = viewParams.toString();
        const href = param_string
            ? `${basePath}${path}?${param_string}`
            : `${basePath}${path}`;
        const hrefWithHash = requestedHash ? `${href}${requestedHash}` : href;
        history.pushState({ view, params: viewParams.toString() }, '', hrefWithHash);
    } else {
        // PSEO Behavior: Keep current URL, but update state for back-button compatibility
        history.replaceState({ view, params: viewParams.toString() }, '', window.location.href);
    }

    currentScrollKey = targetScrollKey;
    scrollToLandingHash(requestedHash);
}


function updateViewStatus(view) {
    // Only show selected view
    Object.values(views).forEach(v => {
        if (!v) return;
        v.classList.remove('active');
        v.style.display = 'none';
    });

    const el = views[view];
    el.style.display = 'block';
    el.classList.remove('active');

    // Landing is a large, mostly static page with several image-heavy and animated
    // sections. Avoid forcing a synchronous reflow just to replay the generic view
    // fade when users navigate back to it inside the SPA.
    const shouldRestartViewTransition = view !== 'landing';
    if (shouldRestartViewTransition) {
        // force reflow so the browser sees the state change
        void el.offsetWidth; // or el.getBoundingClientRect();
    }
    // now add the class to trigger the fade where the transition is restarted
    el.classList.add('active');

    setTimeout(() => {
        if (views[view]) {
            views[view].classList.add('active');
        }
        // Reinitialize any Bootstrap tooltips since some HTML is injected dynamically
        setupBootstrapTooltips();
    } , 10);

    optimizeSEOMetadata(view)
    updateNavAriaCurrent(view);
    closeNavbar();
}

// Store values that will be needed after successful login
export function displayLoginModal(requestedView, viewParams) {
    viewAfterLogin = requestedView;  // Remember the original view
    viewParamsAfterLogin = normalizeParams(viewParams);  // Remember the original params

    const subtitle = document.querySelector('#loginModal .modal-body .text-center p.text-secondary');
    if (subtitle) {
        const isContactFlow = requestedView === 'room_detail' && viewParamsAfterLogin.get('contact') === '1';
        subtitle.textContent = isContactFlow
            ? 'Log ind for at skrive til din nye roomie'
            : 'Log ind for at se detaljer';
    }

    const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
    loginModal.show();
}

// Load content for a given view
async function loadViewData(view, viewParams) {
    switch (view) {
        case "room_detail":
            await renderRoomDetail(viewParams.get("id"));
            break;
        case "udlej_vaerelse": {
            const module = await import("../udlej_vaerelse/udlej_vaerelse.js");
            await module.setupRentRoomView();
            await module.refreshRentRoomFormFromOwnerRooms({preferLocalDraft: true});
            break;
        }
        case "profile":
            await loadProfileView();
            break;
        case "conversations":
            await renderConversations(viewParams.get("besked_id") || viewParams.get("id"), {
                draftReceiverId: viewParams.get("modtager"),
                draftRoomId: viewParams.get("room"),
            });
            break;
        case "agent":
            renderSearchAgentOverview();
            break;
        case "agent_create":
            await renderSearchAgentCreate();
            break;
        case "agent_edit":
            await renderSearchAgentEdit(viewParams.get("id"));
            break;
        case "blog":
            renderBlogPage(viewParams.get("slug"));
            break;
        default:
            break;
    }
}

export function setupViews() {
    const clickableElements = document.querySelectorAll('[data-view]');

    clickableElements.forEach(element => {
        element.addEventListener('click', function(e) {
            e.preventDefault();
            // Remove 'active' class from all clickable elements
            clickableElements.forEach(el => el.classList.remove('active'));
            // Add 'active' class to the clicked element if it's not the logo (handled separately if needed)
            if (this !== document.querySelector('.navbar-brand')) {
                this.classList.add('active');
            }
        });
    });
}

function loginRequiredView(viewName) {
    return loginRequiredViews.includes(viewName);
}

function closeNavbar() {
    closeNavbarMenu();
}


function jumpToTopInstant() {
    // Jump to top of the website, and execute it instantly.
    const root = getScrollRoot();
    // 1. Temporarily disable smooth scrolling
    root.style.scrollBehavior = 'auto';      // or 'unset'
    // 2. Jump
    root.scrollTop = 0;                      // instant
    // 3. Restore previous behaviour
    root.style.scrollBehavior = '';
}

/**
 * Save scroll position for the current view.
 * Useful for preserving user's position when navigating away and back.
 */
function saveScrollPosition(viewName, scrollKey = currentScrollKey) {
    if (!viewName) return;

    const root = getScrollRoot();
    scrollPositions[scrollKey] = {
        view: viewName,
        top: root.scrollTop
    };
}

/**
 * Restore scroll position for a given view if it was previously saved.
 */
function restoreScrollPosition(viewName, scrollKey = currentScrollKey) {
    const state = getSavedScrollState(viewName, scrollKey);
    if (!state) return false;

    return applySavedScrollPosition(viewName, state);
}

async function restoreViewScroll(viewName, scrollKey = currentScrollKey) {
    const state = getSavedScrollState(viewName, scrollKey);

    if (!state) {
        jumpToTopInstant();
        return false;
    }

    for (const delay of SCROLL_RESTORE_DELAYS_MS) {
        if (delay > 0) {
            await wait(delay);
        }

        await waitForNextFrame();
        restoreScrollPosition(viewName, scrollKey);
    }

    return true;
}

function getSavedScrollState(viewName, scrollKey = currentScrollKey) {
    const state = scrollPositions[scrollKey];

    if (typeof state === 'number') {
        return {view: viewName, top: state};
    }

    if (!state || typeof state.top !== 'number') {
        return null;
    }

    if (state.view && state.view !== viewName) {
        return null;
    }

    return state;
}

function applySavedScrollPosition(viewName, state) {
    const root = getScrollRoot();

    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    root.scrollTop = clampScrollTop(state.top);
    root.style.scrollBehavior = previousScrollBehavior;
    return true;
}

function clampScrollTop(value) {
    const root = getScrollRoot();
    const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
    return Math.max(0, Math.min(Math.round(value), maxScrollTop));
}

function getScrollRoot() {
    return document.scrollingElement || document.documentElement;
}

function getCurrentLocationScrollKey() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getScrollKeyForView(view, params = new URLSearchParams(), hash = '') {
    const viewUrl = buildViewUrl(view, params);
    if (!viewUrl) return getCurrentLocationScrollKey();

    const url = new URL(viewUrl);
    return `${url.pathname}${url.search}${hash || ''}`;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForNextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}


// Helps crawlers and browsers understand what the active view is
function updateNavAriaCurrent(view) {
    document.querySelectorAll('nav [data-view]').forEach(link => {
        link.removeAttribute('aria-current');
    });
    const activeLink = document.querySelector(`nav [data-view="${view}"]`);
    if (activeLink) {
        activeLink.setAttribute('aria-current', 'page');
    }
}

/**
 * Updates SEO metadata based on the active view.
 * @param {string} view - Det interne ID for viewet
 */
function optimizeSEOMetadata(view) {
    const baseUrl = window.location.origin;

    if (view !== 'room_detail') {
        setStructuredData(null);
        const detailSchema = document.getElementById('schema-housing-detail');
        if (detailSchema) detailSchema.remove();
    }

    if (view === 'faq') {
        updateMetaTags(
            'Spørgsmål og svar om værelser og roomies',
            'Få svar på spørgsmål om at finde værelse til leje, udleje et værelse, skrive med roomies og bruge Roomie Danmark gratis.',
            `${baseUrl}/spoergsmaal-om-roomies`
        );
    }
    else if (view === 'soeg_vaerelse') {
        updateMetaTags(
            'Værelse til leje – ledige værelser i hele Danmark',
            'Find ledige værelser til leje i København, Aarhus, Odense og Aalborg. Filtrér efter pris og indflytning – og skriv gratis til din nye roomie uden betalingsmur.',
            `${baseUrl}/ledige-vaerelser`
        );
    }
    else if (view === 'room_detail') {
        // The room detail renderer updates metadata once the cached room is loaded.
    }
    else if (view === 'udlej_vaerelse') {
        updateMetaTags(
            'Udlej værelse gratis – lej dit værelse ud',
            'Udlej dit værelse gratis hos Roomie Danmark. Opret en annonce og lej dit værelse ud til en tryg roomie blandt studerende og unge på boligjagt – uden skjulte gebyrer.',
            `${baseUrl}/udlej-vaerelse`
        );
    }
    else if (view === 'terms_and_conditions') {
        updateMetaTags(
            'Vilkår og betingelser',
            'Læs vilkår for brug af roomies på roomiedanmark.dk, herunder profiler, værelsesannoncer, beskeder, SøgeAgent og persondata.',
            `${baseUrl}/vilkaar`
        );
    }
    else if (view === 'conversations') {
        updateMetaTags(
            'Beskeder',
            'Se og svar på dine samtaler med roomies om værelser, fællesskab og næste hjem.',
            `${baseUrl}/beskeder`
        );
    }
    else if (view === 'agent' || view === 'agent_create' || view === 'agent_edit') {
        updateMetaTags(
            'SøgeAgent | Få besked om nye værelser',
            'Opret en gratis SøgeAgent og få besked, når et værelse matcher dit budget og dine områder.',
            `${baseUrl}/boligovervaagning`
        );
    }
    else if (view === 'profile') {
        updateMetaTags(
            'Profil | Roomie Danmark',
            'Udfyld din roomie-profil med billede, interesser og ønsker, så andre kan lære dig bedre at kende.',
            `${baseUrl}/profil`
        );
    }
    else if (view === 'blog') {
        const post = getBlogPostBySlug(currentViewParams.get('slug'));
        if (post) {
            updateMetaTags(
                `${post.title} | Roomie Danmark`,
                post.excerpt,
                `${baseUrl}${getBlogPostUrl(post)}`
            );
            setStructuredData(getBlogPostStructuredData(post, baseUrl));
        } else {
            updateMetaTags(
                'Blog om værelser, studiebolig og roomies | Roomie Danmark',
                'Læs tips og erfaringer om at finde værelse til leje, studiebolig og en god roomie – og om et mere fair boligmarked uden betalingsmure.',
                `${baseUrl}/blog`
            );
            setStructuredData(getBlogStructuredData(baseUrl));
        }
    }
    else {
        updateMetaTags(
            'Find værelse til leje – eller udlej dit eget | Roomie Danmark',
            'Find ledige værelser i København, Aarhus, Odense og Aalborg – eller udlej dit værelse gratis. Skriv gratis til alle roomies, ingen betalingsmur.',
            baseUrl
        );
    }
}
// --- reverse (view -> path) ---
const viewToRoute = Object.fromEntries(
    Object.entries(routeToView).map(([p,v]) => [v,p])
);

function buildViewUrl(view, params = new URLSearchParams()) {
    if (!view || !viewToRoute[view]) return null;

    const safeParams = normalizeParams(params);
    const path = `${basePath}${viewToRoute[view]}`;
    const query = safeParams.toString();
    return `${window.location.origin}${path}${query ? `?${query}` : ''}`;
}

function pathToView(pathname) {
    let normalizedPath = pathname || '/';

    if (basePath && basePath !== '/' && normalizedPath.startsWith(basePath)) {
        normalizedPath = normalizedPath.slice(basePath.length) || '/';
    }

    if (normalizedPath.length > 1) {
        normalizedPath = normalizedPath.replace(/\/+$/, '');
    }

    return routeToView[normalizedPath] || null;
}

function normalizeLandingHash(view, hash) {
    if (view !== 'landing' || !hash) return '';

    const normalizedHash = hash.startsWith('#') ? hash : `#${hash}`;
    return landingAnchorTargets.has(normalizedHash) ? normalizedHash : '';
}

function scrollToLandingHash(hash) {
    if (!hash) return;

    const scrollToTarget = () => {
        const target = document.querySelector(hash);
        target?.scrollIntoView({behavior: 'auto', block: 'start'});
    };

    requestAnimationFrame(scrollToTarget);
    setTimeout(scrollToTarget, 150);
    setTimeout(scrollToTarget, 500);
    window.addEventListener('load', scrollToTarget, {once: true});
}

export async function handleRouting() {
    const url = new URL(window.location.href);
    const path = url.pathname;

    // ---------------------------------------------------------
    // STATIC SEO CONTENT PROTECTION
    // ---------------------------------------------------------
    if (isStaticSeoRoute(path)) {
        // --- FIX 2: HIDE APP ROOT ON LOAD ---
        if (appRoot) appRoot.style.display = 'none';
        if (staticSeoContent) staticSeoContent.style.display = 'block';
        return;
    }

    let v = pathToView(url.pathname);

    // Default to landing if view is still unknown
    v = v || 'landing';

    await showView(v, url.searchParams, true, {hash: url.hash});
}

// SPA link-interceptor
document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/"]');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const href = a.getAttribute('href');
    // Use the helper function here
    if (isStaticSeoRoute(href)) {
        return; // Allow default browser behavior (hard load)
    }

    e.preventDefault();
    const url = new URL(a.href, location.origin);
    const view = pathToView(url.pathname);

    showView(view, url.searchParams, true, {hash: url.hash})
});


/**
 * Normalize various "params" shapes into a safe URLSearchParams instance.
 *
 * Why:
 * - Prevents crashes like `null is not an object (evaluating 't.get'/'t.toString')`
 * when callers pass `null`, plain objects, or query strings.
 *
 * Accepted inputs:
 * - URLSearchParams: returned as-is
 * - string: "a=1&b=2" or "?a=1&b=2"
 * - plain object: { a: "1", b: "2" } (values are stringified by URLSearchParams)
 * - null/undefined/anything else: returns empty params
 *
 * Guarantee:
 * - Always returns a URLSearchParams (never null)
 *
 * Examples:
 * normalizeParams("?redirect_url=https%3A%2F%2Fexample.com").get("redirect_url")
 * normalizeParams({ page: 1, size: 50 }).toString() // "page=1&size=50"
 * normalizeParams(null).toString() // ""
 *
 * @param {URLSearchParams|string|Record<string, any>|null|undefined} p
 * @returns {URLSearchParams}
 */
function normalizeParams(p) {
    if (p instanceof URLSearchParams) return p;

    if (typeof p === "string") {
        return new URLSearchParams(p.startsWith("?") ? p.slice(1) : p);
    }

    if (p && typeof p === "object") {
        return new URLSearchParams(p);
    }

    return new URLSearchParams();
}

/**
 * Checks if a given path or href should bypass the SPA routing
 * and load as a static HTML page (PSEO).
 */
function isStaticSeoRoute(path) {
    if (!path) return false;
    return path.includes('/tilsalg/') ||
        path.includes('/bytte/') ||
        path.includes('/alle-boliger/') ||
        path.includes('/omraader/');
}

// Helper for JSON-LD.
function setStructuredData(jsonObj) {
    // Remove existing JSON-LD scripts first.
    let existingScript = document.querySelector('script[type="application/ld+json"]');
    if (existingScript) {
        existingScript.remove();
    }

    // Add new JSON-LD if provided.
    if (jsonObj) {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.text = JSON.stringify(jsonObj);
        document.head.appendChild(script);
    }
}


// Support navigating back and forth between pages while preserving URL params
window.addEventListener('popstate', (event) => {
    // If we pop back to a PSEO URL, re-run routing (which will just return/do nothing, showing static content)
    const path = window.location.pathname;
    // Use the helper function here
    if (isStaticSeoRoute(path)) {
        window.location.reload();
        return;
    }

    if (event.state && event.state.view) {
        const params = new URLSearchParams(event.state.params || '');

        // Pass updateUrl = false so we don't push a new history state while navigating back/forward
        showView(event.state.view, params, false, {
            hash: window.location.hash,
            restoreScroll: true,
            scrollKey: getCurrentLocationScrollKey()
        }).then(() => {
            document.dispatchEvent(new CustomEvent('view:changed', {
                detail: { view: event.state.view, params }
            }));
        }).catch(err => {
            console.error("Error loading view on popstate:", err);
        });
        return;
    }

    const view = pathToView(window.location.pathname) || 'landing';
    const params = new URLSearchParams(window.location.search);
    showView(view, params, false, {
        hash: window.location.hash,
        restoreScroll: true,
        scrollKey: getCurrentLocationScrollKey()
    }).catch(err => {
        console.error("Error loading view on popstate:", err);
    });
});

window.showView = showView;
