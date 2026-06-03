import {renderAgents} from "../agent/agent.js";
import {
    displayErrorMessage, getHousingById,
    isLoggedIn,
    prepareStripeBuyButton,
    isSubscribed,
    setupBootstrapTooltips,
    updateMetaTags
} from "../utils.js";
import {loadHousingDetail} from "../housing_detail/housing_detail.js";
import {loadSellerProfile} from "../seller_profile/seller_profile.js";
import {attachSearchComponentToView, sendSearchData, persistListScrollState, ensureHousingListRendered} from "../housing_list/housing_list.js";
import {initMap} from "../housing_map/housing_map.js";
import {updateStripePaymentElements} from "../login/login.js";
import {basePath} from "../config/config.js";
import {loadAgentForEdit} from "../agent_edit/agent_edit.js";
import {loadProfileView} from "../profile/profile.js";
import {cancelAgentPromo, scheduleAgentPromo} from "../agent/agent_promo.js";
import {ensureHousingDataLoaded} from "../housing_create/housing_create.js";
import {renderConversations} from "../conversations/conversations.js";
import {closeNavbarMenu} from "../header/header.js";
import {
    getBlogPostBySlug,
    getBlogPostStructuredData,
    getBlogPostUrl,
    getBlogStructuredData,
    renderBlogPage
} from "../blog/blog.js";

// Setup click events for all views
const views = {
    landing: document.getElementById('landing'),
    sell_landing: document.getElementById('sell_landing'),
    // ai_analysis: document.getElementById('ai_analysis'),
    // ai_result: document.getElementById('ai_result'),
    housing_list: document.getElementById('housing_list'),
    housing_map: document.getElementById('housing_map'),
    // Hack to redirect users to that page when completing login
    login: document.getElementById('housing_list'),  // popup
    detail: document.getElementById('detail'),
    create: document.getElementById('create'),
    agent: document.getElementById('agent'),
    agent_create: document.getElementById('agent_create'),
    agent_edit: document.getElementById('agent_edit'),
    profile: document.getElementById('profile'),
    conversations: document.getElementById('conversations'),
    seller_profile: document.getElementById('seller_profile'),
    successful_redirect: document.getElementById('successful_redirect'),
    terms_and_conditions: document.getElementById('terms_and_conditions'),
    about_us: document.getElementById('about_us'),
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
    '/liste': 'housing_list',
    '/kort': 'housing_map',
    // '/ai-analyse': 'ai_analysis',
    // '/ai-resultat': 'ai_result',
    '/detaljer': 'detail',
    '/saelg-andelsbolig-selv-koncept': 'sell_landing',
    '/saelg-andelsbolig-selv': 'create',
    '/boligovervaagning': 'agent',
    '/boligerovervaagning-opret': 'agent_create',
    '/boligerovervaagning-rediger': 'agent_edit',
    '/profil': 'profile',
    '/beskeder': 'conversations',
    '/saelger': 'seller_profile',
    '/redirect-success': 'successful_redirect',
    '/vilkaar': 'terms_and_conditions',
    '/om-os': 'about_us',
    '/blog': 'blog',
    '/login': 'login',  // Hack to prompt users for login and payment, the view doesnt actually exist
    '/spoergsmaal-om-andelsbolig': 'faq',
};

// Starting view
let currentView = 'landing';
let currentViewParams = new URLSearchParams();

export function getCurrentView() {
    return currentView;
}

// All views that require login
// Updated: Removed 'agent', added 'agent_create' and 'agent_edit'
const loginRequiredViews = ["agent_create", "agent_edit", "login", "seller_profile", "successful_redirect", "login", "conversations"];
const payWalledViews = ["seller_profile", "successful_redirect", "login"];

// Store requested view to remember redirects after login popup
export let viewAfterLogin = null;
export let viewParamsAfterLogin = new URLSearchParams();
const POST_ONBOARDING_CONTEXT_KEY = 'postOnboardingContext';

// Store scroll position for each view to preserve UX when navigating back
const scrollPositions = {};
const SCROLL_RESTORE_DELAYS_MS = [0, 80, 180];

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

        // SEO & Tilgængeligheds FIX:
        v.setAttribute('aria-hidden', 'true');
        v.setAttribute('hidden', '');
    });

    if (views[viewName]) {
        views[viewName].style.display = 'block';

        // Gør det aktive view synligt for crawlere:
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

    let popup = null;
    let scrapedUrl = null;

    // 1. Check if login is required
    if (loginRequiredView(view) && !isLoggedIn()) {
        // If user is in a housing detail view and tries to access a login
        // protected view, remember the current URL, so we can redirect back
        // after login (e.g. from login link in email).
        if (currentView === 'detail' && (view === 'seller_profile' || view === 'successful_redirect')) {
            localStorage.setItem('postLoginRedirect', window.location.href);
        }

        displayLoginModal(view, viewParams);
        return;
    }

    // 2. Check if subscription is required
    if (payWalledView(view) && !(await isSubscribed())) {
        rememberPostOnboardingContext({
            view,
            params: viewParams,
            action: 'payment',
            returnUrl: buildViewUrl(view, viewParams) || window.location.href
        });
        await prepareStripeBuyButton();
        updateStripePaymentElements();

        const el = document.getElementById('stripePayment');
        const clientRefId = el?.getAttribute('client-reference-id')?.trim();

        if (!clientRefId) {
            console.error('Betaling afbrudt: mangler client-reference-id');
            displayErrorMessage('Betalingen blev afbrudt, da vi ikke kunne identificere din bruger. Log ind og prøv igen.', 8000);
            return;
        }

        new bootstrap.Modal('#paymentModal').show();
        return;
    }

    if (view === "login"){
        return;
    }

    // 3. ONLY open the tab if the user is logged in, subscribed, and the view is 'successful_redirect'
    if (view === 'successful_redirect') {
        scrapedUrl = viewParams.get('redirect_url')?.trim();
        if (scrapedUrl) {
            // Note: Since we awaited isSubscribed(), strict popup blockers might intervene here.
            // However, this prevents the "flashing" behavior of opening/closing tabs prematurely.
            popup = window.open('', '_blank');
        }
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

    // Handle redirects for view "successful_redirect"
    if (scrapedUrl) {
        if (popup) {
            // allowed & popup is open → navigate it
            popup.location.href = scrapedUrl;
        } else {
            // popup was blocked (or failed) → fall back to same‑tab navigation
            window.location.href = scrapedUrl;
        }
        // Dont change views when users are redirected to realtors.
        return;
    }

    // --------------------------------------------------
    // NOW THAT WE KNOW WE ARE PROCEEDING, UPDATE THE DOM
    // --------------------------------------------------
    
    // Save scroll position only for housing_list so we can restore it when
    // the user navigates back (other views always start at the top).
    if (currentView === 'housing_list') {
        saveScrollPosition(currentView);
        // Also save the pagination depth when leaving the list view, so we can
        // restore all loaded pages if the user navigates back.
        persistListScrollState();
    }

    ensureViewVisibility(view);
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

    // Map/list/detail are activated before data loading so slow fetches do not
    // leave users on an invisible view or app-level spinner, especially on mobile.
    // Map still needs a visible container before initMap() + fitBounds().
    try {
        if (view === 'housing_map') {
            updateViewStatus(view);
            await new Promise(requestAnimationFrame); // let layout apply
            await loadViewData(view, viewParams);
        } else if (view === 'housing_list') {
            updateViewStatus(view);
            await waitForNextPaint();
            await loadViewData(view, viewParams);
        } else if (view === 'detail') {
            updateViewStatus(view);
            await loadViewData(view, viewParams);
        } else {
            await loadViewData(view, viewParams);
            updateViewStatus(view);
        }
    } catch (err) {
        console.error(`Error loading view "${view}":`, err);
        // Ensure the view is still shown (even if data failed to load)
        updateViewStatus(view);
    }

    // Only schedule the promo on "browsing" views (List & Map)
    if (view === 'housing_list' || view === 'housing_map') {
        scheduleAgentPromo();
    } else {
        // Cancel timer/hide popup if navigating to Detail, Login, Profile etc.
        cancelAgentPromo();
    }

    // Restore scroll position only for housing_list; all other views start at top
    if (view === 'housing_list') {
        await restoreViewScroll(view);
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

    scrollToLandingHash(requestedHash);
}


function updateViewStatus(view) {
    // Only show selected view
    Object.values(views).forEach(v => {
        if (!v) return;
        v.classList.remove('active');
        v.style.display = 'none';
    });

    if (view === 'housing_list' || view === 'housing_map') {
        attachSearchComponentToView(view);
    }

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

function waitForNextPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
}

// Store values that will be needed after successful login
export function displayLoginModal(requestedView, viewParams) {
    viewAfterLogin = requestedView;  // Remember the original view
    viewParamsAfterLogin = normalizeParams(viewParams);  // Remember the original params

    const subtitle = document.querySelector('#loginModal .modal-body .text-center p.text-secondary');
    if (subtitle) {
        const isContactFlow = requestedView === 'detail' && viewParamsAfterLogin.get('contact') === '1';
        subtitle.textContent = isContactFlow
            ? 'Log ind for at kontakte sælger'
            : 'Log ind for at se detaljer';
    }

    const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
    loginModal.show();
}

// Load content for a given view
async function loadViewData(view, viewParams) {
    switch (view) {
        case "create": // Garanter data indlæses når 'Sælg andelsbolig selv' viewet åbnes
            await ensureHousingDataLoaded();
            break;
        case "detail":
            await loadHousingDetail(viewParams.get("id"), viewParams)
            break;
        case "seller_profile":
            await loadSellerProfile(viewParams.get("id"))
            break;
        // case "successful_redirect":
        //     let redirect_url = viewParams.get("redirect_url")
        //     if (typeof redirect_url === 'string' && redirect_url.trim() !== '') {
        //         openInNewTab(redirect_url)
        //     }
        //     break;
        case "agent":
            renderAgents()
            break;
        case "agent_edit":
            const id = viewParams.get('id');
            if (id) {
                await loadAgentForEdit(id);
            }
            break;
        case "housing_list":
            await ensureHousingListRendered();
            break;
        case "housing_map":
            // Load map only on entering the view, to save costs.
            await initMap()
            let housing_id = viewParams.get("id")
            if (housing_id === null){
                await sendSearchData('map', false, null)
            } else {
                await sendSearchData('map', false, [housing_id])
            }
            break;
        // case "ai_analysis":
        //     if (!isLoggedIn()) {
        //         break;
        //     }
            // Fetch results since they're showed on the analysis view
            // loadAIResults()
            //
            // break;
        // case "ai_result":
        //     cancelAIPolling()
        //     await renderAIResult(viewParams.get("id"))
        //     break;
        case "profile":
            await loadProfileView();
            break;
        case "conversations":
            await renderConversations(viewParams.get("besked_id") || viewParams.get("id"));
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

function payWalledView(viewName) {
    return payWalledViews.includes(viewName);
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
function saveScrollPosition(viewName) {
    if (!viewName) return;

    const root = getScrollRoot();
    scrollPositions[viewName] = {
        top: root.scrollTop,
        anchor: captureVisibleScrollAnchor(viewName)
    };
}

/**
 * Restore scroll position for a given view if it was previously saved.
 */
function restoreScrollPosition(viewName) {
    const state = getSavedScrollState(viewName);
    if (!state) return false;

    return applySavedScrollPosition(viewName, state);
}

async function restoreViewScroll(viewName) {
    const state = getSavedScrollState(viewName);

    if (!state) {
        jumpToTopInstant();
        return false;
    }

    for (const delay of SCROLL_RESTORE_DELAYS_MS) {
        if (delay > 0) {
            await wait(delay);
        }

        await waitForNextFrame();
        restoreScrollPosition(viewName);
    }

    return true;
}

function getSavedScrollState(viewName) {
    const state = scrollPositions[viewName];

    if (typeof state === 'number') {
        return {top: state, anchor: null};
    }

    if (!state || typeof state.top !== 'number') {
        return null;
    }

    return state;
}

function applySavedScrollPosition(viewName, state) {
    const root = getScrollRoot();
    let targetTop = state.top;

    const anchorId = state.anchor?.id;
    if (anchorId && views[viewName]) {
        const anchorEl = views[viewName].querySelector(`[data-scroll-anchor-id="${anchorId}"]`);
        if (anchorEl) {
            targetTop = root.scrollTop + anchorEl.getBoundingClientRect().top - state.anchor.topOffset;
        }
    }

    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    root.scrollTop = clampScrollTop(targetTop);
    root.style.scrollBehavior = previousScrollBehavior;
    return true;
}

function captureVisibleScrollAnchor(viewName) {
    if (viewName !== 'housing_list') {
        return null;
    }

    const viewEl = views[viewName];
    if (!viewEl) return null;

    const anchors = Array.from(viewEl.querySelectorAll('[data-scroll-anchor-id]'));
    if (anchors.length === 0) return null;

    const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
    let fallbackAnchor = null;

    for (const anchor of anchors) {
        const rect = anchor.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= viewportHeight) {
            continue;
        }

        const candidate = {
            id: anchor.getAttribute('data-scroll-anchor-id'),
            topOffset: rect.top
        };

        if (rect.top >= 0) {
            return candidate;
        }

        fallbackAnchor = candidate;
    }

    return fallbackAnchor;
}

function clampScrollTop(value) {
    const root = getScrollRoot();
    const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
    return Math.max(0, Math.min(Math.round(value), maxScrollTop));
}

function getScrollRoot() {
    return document.scrollingElement || document.documentElement;
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
 * Opdaterer SEO metadata baseret på det aktive view med data-drevne søgeord.
 * @param {string} view - Det interne ID for viewet
 */
function optimizeSEOMetadata(view) {
    const baseUrl = window.location.origin;

    // Don't clear structured data for detail - managed by housing_detail.js
    if (view !== 'detail') {
        setStructuredData(null);
        // Clean up detail-specific schemas when navigating away
        const detailSchema = document.getElementById('schema-housing-detail');
        if (detailSchema) detailSchema.remove();
    }

    if (view === 'create') {
        // Fokusord: Sælg andelsbolig selv, salg af andelsbolig, gratis, bytte
        updateMetaTags(
            'Sælg andelsbolig selv – 100% gratis | Salg & Bytte',
            'Sælg din andelsbolig selv og spar mægleren. Det er 100% gratis at oprette din annonce til salg eller bytte af andelsbolig.',
            `${baseUrl}/saelg-andelsbolig`
        );
    }
    else if (view === 'sell_landing') {
        // Fokusord: Sælg andelsbolig selv, sælg uden mægler, bytte andelsbolig
        updateMetaTags(
            'Sælg din andelsbolig selv – 100% gratis | Salg & Bytte',
            'Står du overfor et salg eller bytte af din andelsbolig? Lad roomies hjælpe dig trygt og nemt videre. Uanset om din bolig ligger i København, Aarhus, på Frederiksberg, Amager, Østerbro eller et andet sted i Danmark, gør vi det enkelt at finde den rette køber.',
            `${baseUrl}/saelg-andelsbolig-selv-koncept`
        );

        setStructuredData({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "Må jeg sælge min andelsbolig selv?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Ja, du må i høj grad gerne sælge din andelsbolig selv. Faktisk er selvsalg den mest almindelige måde at sælge andelsboliger på i Danmark. Du behøver ingen ejendomsmægler, da andelsboligforeningens administrator typisk står for at udarbejde overdragelsesaftalen og håndtere det juridiske papirarbejde."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvad er processen når jeg sælger selv?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Processen er simpel: 1. Undersøg først, hvilke regler og processer der gælder i din specifikke andelsboligforening (f.eks. krav til vurderingsmand). 2. Opret en gratis annonce på roomies og fremvis boligen for interesserede købere. 3. Når du har fundet din køber, giver du besked til foreningens administrator, som herefter opretter overdragelsesaftalen og indhenter bestyrelsens godkendelse."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Er det usikkert at sælge uden en ejendomsmægler?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Nej, og salg går ofte hurtigere ved selvsalg. Alt salg af andelsboliger skal lovpligtigt godkendes af andelsboligforeningens bestyrelse. Det er foreningens professionelle administrator (ofte en advokat), der udarbejder selve købsaftalen og håndterer købesummen sikkert via en deponeringskonto. Mæglerens primære job er blot at finde køberen, hvilket vi hjælper dig med."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvad koster det at sælge andelsbolig?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Hos roomies er det 100% gratis at sælge. Dine eneste udgifter ved et selvsalg vil typisk være et overdragelsesgebyr til foreningens administrator, udgiften til en vurderingsmand, et gebyr til banken for indfrielse af dit eventuelle lån, samt et el- og VVS-tjek, hvis din forening kræver det."
                    }
                }
            ]
        });
    }
    else if (view === 'faq') {
        // Fokusord: FAQ andelsbolig, ofte stillede spørgsmål, køb og salg
        updateMetaTags(
            'Ofte stillede spørgsmål | roomies',
            'Få svar på alle dine spørgsmål om køb, salg og bytte af andelsboliger og læs mere om hvordan roomies fungerer her.',
            `${baseUrl}/faq`
        );

        // Udfylder Schema markup baseret på din HTML FAQ struktur
        setStructuredData({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "Hvordan fungerer konceptet?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "I dag er andelsboligmarkedet spredt ud over hele internettet – på DBA, Boliga, i over 50 forskellige Facebook-grupper og mange andre steder. Det problem løser vi. Vi samler markedet ét sted og gør det skjulte marked synligt for alle. Det er 100% gratis at sælge eller bytte din andelsbolig via os, og vi sørger for at annoncere din bolig ud til mange tusinde købere."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Koster det penge at sælge min andelsbolig?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Nej, det er 100% gratis at oprette en salgs- eller bytteannonce på roomies. Vi har fjernet de dyre mellemled, så du trygt kan finde den rette køber uden at skulle have penge op af lommen."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvad koster det at kontakte en sælger?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "For kun 99 kr. om måneden får du fuld adgang til at kontakte alle sælgere direkte og se de fulde adressedetaljer. Der er 0 skjulte gebyrer og absolut ingen binding – du kan afmelde dig præcis, når du vil. Vores pris er desuden over 75% billigere end lignende portaler."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvad er processen når jeg sælger selv?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Overordnet set er processen simpel: 1. Undersøg først, hvilke regler og processer der gælder i din specifikke andelsboligforening (f.eks. krav til vurderingsmand). 2. Opret en gratis annonce på roomies. Vi finder interesserede købere og du fremviser boligen. 3. Når du har fundet din køber, giver du besked til foreningens administrator, som herefter opretter overdragelsesaftalen og indhenter bestyrelsens godkendelse."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvordan fungerer BoligMatch?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Med BoligMatch overvåger vi markedet for dig helt automatisk. Du opretter dine kriterier (f.eks. pris, størrelse og område), og vi sender dig en e-mail i samme sekund, som en andelsbolig, der matcher dine drømme, bliver sat til salg."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvor kommer boligerne fra?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Boligerne på platformen kommer fra to primære kilder. Flere og flere andelshavere opretter selv deres salgs- og bytteannoncer direkte hos os, fordi det er gratis, og fordi vi hjælper med salget. For at hjælpe dig med at overvåge et ellers uoverskueligt marked, bruger vi derudover avanceret teknologi til automatisk at indsamle annoncer fra resten af internettet, herunder DBA, Boliga og diverse internetsider. På den måde behøver du kun at lede ét sted. Vi håber du finder drømmeboligen hos os 😊"
                    }
                }
            ]
        });
    }
    else if (view === 'housing_list') {
        // Fokusord: Andelsboliger til salg, andelslejlighed, køb andelsbolig
        updateMetaTags(
            'Andelsboliger til salg i København, Aarhus og hele Danmark',
            'Se alle aktuelle andelsboliger til salg her. Find din nye andelslejlighed i København (inkl. 2100 Østerbro), Amager, Frederiksberg, Aarhus. m.m.',
            `${baseUrl}/liste`
        );
    }
    else if (view === 'agent') {
        // Fokusord: Køb andelsbolig, andelsbolig til salg
        updateMetaTags(
            'Køb andelsbolig | Få besked når andelsboliger sættes til salg',
            'Gå ikke glip af drømmeboligen. Opret et gratis BoligMatch og få besked så snart, drømmebolien sættes til salg til salg.',
            `${baseUrl}/boligovervaagning`
        );
    }
    else if (view === 'housing_map') {
        updateMetaTags(
            'Kort over andelsboliger til salg | Find andelsbolig nær dig',
            'Søg efter andelsboliger til salg via vores kort. Find nemt en andelsbolig i indre København, Amager, Frederiksberg, Lyngby, Aarhus og resten af landet.',
            `${baseUrl}/kort`
        );
    }
    else if (view === 'terms_and_conditions') {
        // Fokusord: Vilkår, betingelser, regler for roomies
        updateMetaTags(
            'Vilkår og Betingelser | roomies',
            'Læs de gældende vilkår og betingelser for brug af roomies. Få overblik over betingelser for annoncering, abonnement og persondatahåndtering.',
            `${baseUrl}/vilkaar`
        );
    }
    else if (view === 'conversations') {
        updateMetaTags(
            'Beskeder | roomies',
            'Se og svar på dine samtaler med sælgere på roomies.',
            `${baseUrl}/beskeder`
        );
    }
    else if (view === 'about_us') {
        // Fokusord: Om roomies, mission, billig andelsbolig portal
        updateMetaTags(
            'Om roomies | Nem, billig og hurtig bolighandel',
            'Læs historien bag roomies. Vi tilstræber at gøre det mere gennemsigtigt, billigt og nemt at købe, sælge og bytte andelsboliger i Danmark.',
            `${baseUrl}/om-os`
        );
    }
    else if (view === 'blog') {
        const post = getBlogPostBySlug(currentViewParams.get('slug'));
        if (post) {
            updateMetaTags(
                `${post.title} | roomies`,
                post.excerpt,
                `${baseUrl}${getBlogPostUrl(post)}`
            );
            setStructuredData(getBlogPostStructuredData(post, baseUrl));
        } else {
            updateMetaTags(
                'Blog | roomies',
                'Læs historier, tips og erfaringer fra andelsboligmarkedet. Få inspiration til boligjagten, selvsalg og BoligMatch.',
                `${baseUrl}/blog`
            );
            setStructuredData(getBlogStructuredData(baseUrl));
        }
    }
    else if (view === 'detail') {
        // Håndteres fortsat dynamisk af de specifikke controllere
    }
    else {
        // FORSIDEN (Fallback)
        // Fokusord: Andelsbolig København/Aarhus, køb, salg, bytte
        updateMetaTags(
            'Andelsboliger til salg | Køb, Salg & Bytte af andelsbolig',
            'Danmarks nye portal for andelsboliger. Find andelsboliger til salg i København, Frederiksberg og Aarhus, eller sælg din andelsbolig selv – 100% gratis.',
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
    // 🛑 STATIC SEO CONTENT PROTECTION
    // ---------------------------------------------------------
    if (isStaticSeoRoute(path)) {
        // --- FIX 2: HIDE APP ROOT ON LOAD ---
        if (appRoot) appRoot.style.display = 'none';
        if (staticSeoContent) staticSeoContent.style.display = 'block';
        return;
    }

    let v = pathToView(url.pathname);

    // ---------------------------------------------------------
    // 🔄 Backwards Compatibility: Legacy Social Media Links
    // ---------------------------------------------------------
    // Detects old format: https://roomies.dk/?id=...&view=detail
    // If we are on the landing page (pathname '/') and see 'view=detail', we redirect.
    if ((!v || v === 'landing') && url.searchParams.get('view') === 'detail') {
        // Remove the legacy 'view' param.
        // When showView() calls history.pushState, it will generate the
        // new, clean URL (e.g., /detaljer?id=...) automatically.
        url.searchParams.delete('view');

        // Ensure we actually have an ID to show
        const id = url.searchParams.get('id');
        if (id) {
            const housing = await getHousingById(id)
            if (housing) {
                v = 'detail';
            } else {
                displayErrorMessage("Boligen er desværre solgt");
            }
        }
    }

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

// Hjælpefunktion til at håndtere JSON-LD
function setStructuredData(jsonObj) {
    // Fjern eksisterende JSON-LD scripts først
    let existingScript = document.querySelector('script[type="application/ld+json"]');
    if (existingScript) {
        existingScript.remove();
    }

    // Tilføj nyt, hvis jsonObj er angivet
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
        showView(event.state.view, params, false).then(() => {
            document.dispatchEvent(new CustomEvent('view:changed', {
                detail: { view: event.state.view, params }
            }));
        }).catch(err => {
            console.error("Error loading view on popstate:", err);
        });
    }
});

window.showView = showView;
