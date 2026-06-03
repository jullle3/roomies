import {
    checkAndDisplayEmailWarnings,
    isLoggedIn,
    loadStripeScript,
    loadUser,
    requireDevAccessGate,
    setupBootstrapTooltips, setupMissingEmailHandler,
    setupUtils,
    updateStripeConfig
} from "./utils.js";
import {handleRouting, setupViews, showView} from "./views/viewManager.js";
import {setupProfileView} from "./profile/profile.js";
import {setupLogoutView} from "./logout/logout.js";
import {extractURLJWT, handleOTPLink, setupLoginView} from "./login/login.js";
import {loadHousingStats, SetupHeader} from "./header/header.js";
import {SetupFooter} from "./footer/footer.js";
import {
    fetchAdvertisementData,
    initDynamicScrapedCount,
    initDynamicUserCount,
    loadFeaturedHousings,
    loadScannerHighlightedListings
} from "./landing/landing.js";
import {environment} from "./config/config.js";
import {setupConversationsView, startGlobalConversationUnreadPolling} from "./conversations/conversations.js";


function logBuildVersionInDev() {
    if (environment !== 'dev') return;

    const scriptEl = document.querySelector('script[src*="mergedJS.js"][src*="roomies_version="]');
    const src = scriptEl?.getAttribute('src') || '';

    let version = 'ukendt';
    if (src) {
        try {
            const scriptUrl = new URL(src, window.location.origin);
            version = scriptUrl.searchParams.get('roomies_version') || 'ukendt';
        } catch (err) {
            console.warn('Kunne ikke parse frontend versions-URL', err);
        }
    }

    console.info(`[roomies] Frontend version: ${version}`);
}

function isStaticSeoPath(pathname) {
    if (!pathname) return false;
    return pathname.includes('/tilsalg/') ||
        pathname.includes('/bytte/') ||
        pathname.includes('/alle-boliger/') ||
        pathname.includes('/omraader/');
}

async function showLandingFallbackOnInitError() {
    // Keep static PSEO pages untouched; they already have server-rendered HTML.
    if (isStaticSeoPath(window.location.pathname)) {
        return;
    }

    try {
        await showView('landing', new URLSearchParams(), false);
    } catch (fallbackError) {
        console.error('Failed to render landing fallback:', fallbackError);
    }
}

async function loadLottiePlayerWhenNeeded() {
    if (isStaticSeoPath(window.location.pathname)) {
        return;
    }

    try {
        await import('@lottiefiles/lottie-player');
    } catch (err) {
        console.error('Failed to load Lottie player:', err);
    }
}

function preloadCreateHousingDataInBackground() {
    if (!isLoggedIn()) return;

    preloadCreateHousingData()
        .catch(err => console.error("Create housing preload failed (bg)", err));
}


document.addEventListener('DOMContentLoaded', async () => {
    logBuildVersionInDev();
    // Failsafe: force-remove the loader after 15s no matter what.
    // Prevents infinite spinner if an unexpected error or hang occurs (e.g. flaky mobile in-app browsers).
    const failsafeTimeout = setTimeout(() => {
        console.warn('Failsafe: removing app loader after timeout');
        removeAppLoader();
    }, 20000);

    try {
        await requireDevAccessGate();

        // 1. Initial Configuration
        await loadLottiePlayerWhenNeeded();
        updateStripeConfig();
        insertSearchComponents();

        // 2. Setup Views & Event Listeners
        setupHousingListView();
        setupCreateHousingView();
        setupViews();
        setupUtils();
        SetupFooter();
        setupLoginView();
        setupLogoutView();
        setupBootstrapTooltips();
        setupMapView();
        setupConversationsView();
        SetupHeader();
        setupProfileView()

        // 3. Process URL Auth (Must happen before loading user)
        await handleOTPLink();
        await extractURLJWT();

        // 4. Start shared data jobs after URL auth. Some jobs are gated by
        // isLoggedIn(), so OTP/JWT links must be processed before this point.
        startBackgroundJobs();

        // 5. Load Data
        // Check if we are on the landing page OR a static PSEO page.
        // If so, DO NOT await loadUser(). This allows the static HTML to render instantly.
        const url = new URL(window.location.href);

        const isSimpleLanding = (url.pathname === '/');
        const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
        const isDetailPath = normalizedPath === '/detaljer';
        const isPseoPath = (
            url.pathname.startsWith('/tilsalg') ||
            url.pathname.startsWith('/bytte') ||
            url.pathname.startsWith('/omraader') ||
            url.pathname.startsWith('/alle-boliger')
        );

        if (isSimpleLanding || isPseoPath || isDetailPath) {
            // Non-blocking: Load user in background so the UI renders immediately
            loadUser()
                .then(() => {
                    startGlobalConversationUnreadPolling();
                    preloadCreateHousingDataInBackground();
                })
                .catch(err => console.error("User load failed (bg)", err));
        } else {
            // For app-views (e.g., /detaljer, /profil) we must await the user state
            await loadUser();
            startGlobalConversationUnreadPolling();
            preloadCreateHousingDataInBackground();
        }

        // 6. Routing (Render the View)
        // This decides which view to show (e.g., detail view or list view)
        await handleRouting();
    } catch (err) {
        console.error('Critical init error:', err);
        await showLandingFallbackOnInitError();
    } finally {
        // ALWAYS remove the loader, even if routing/data-loading failed
        clearTimeout(failsafeTimeout);
        removeAppLoader();
    }

    // 7. Post-Load Logic (non-critical — errors here must not block the UI)
    try {
        const advertisementData = await fetchAdvertisementData();
        if (advertisementData) {
            loadScannerHighlightedListings(advertisementData);
            loadFeaturedHousings(advertisementData);
            loadHousingStats(advertisementData);
            initDynamicUserCount(advertisementData.total_users);
            initDynamicScrapedCount(advertisementData.total_scraped);
        }

        setupMissingEmailHandler()
    } catch (err) {
        console.error('Post-load error:', err);
    }
});


function removeAppLoader() {
    // 1. Cancel the pending timer (if the app loaded super fast)
    if (window.loaderTimeout) {
        clearTimeout(window.loaderTimeout);
        window.loaderTimeout = null;
    }

    const loader = document.getElementById('app-loader');
    if (loader) {
        // 2. Check if the loader is currently visible
        if (loader.classList.contains('show-loader')) {
            // Scenario: SLOW Load (> 200ms)
            // The user sees the spinner. We must fade it out smoothly.
            loader.classList.remove('show-loader'); // This triggers the opacity: 0 transition

            setTimeout(() => {
                loader.remove();
            }, 400); // Wait for the 0.4s CSS transition to finish
        } else {
            // Scenario: FAST Load (< 200ms)
            // The loader is still invisible (opacity: 0).
            // Remove it instantly. The user never saw it.
            loader.remove();
        }
    }
}


function startBackgroundJobs() {
    // Initialize global state for housings to null (indicating 'loading')
    window.housings = null;

    // Start fetching advertisements in the BACKGROUND (Non-blocking).
    // FIXED: We now assign this to window.housingFetchPromise so getHousingById can await it!
    window.housingFetchPromise = fetchAllAdvertisements().catch(err => console.error("Failed to fetch ads in background", err));
}
