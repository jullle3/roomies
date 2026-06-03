import {
    clearPostOnboardingContext,
    displayLoginModal,
    rememberPostOnboardingContext,
    showView
} from "../views/viewManager.js";
import {authFetch} from "../auth/auth.js";
import {
    decodeJwt,
    DEFAULT_OG_IMAGE,
    displayErrorMessage, displaySuccessMessage,
    getHousingById,
    getShortenedAddress, isSubscribed,
    prepareStripeBuyButton,
    updateMetaTags,
} from "../utils.js";
import {fetchAllAdvertisements, generateHousingCard, isHousingFavorite, updateLocalHousing} from "../housing_list/housing_list.js";
import {basePath, environment, s3Url} from "../config/config.js";
import {areaGroups, postalData} from "../config/hardcoded_data.js";
import {updateStripePaymentElements} from "../login/login.js";

const areaGroupIdToLabel = new Map(
    areaGroups.map(group => [String(group.id).trim(), group.label])
);

const DEFAULT_DETAIL_IMAGE = `${basePath}/pics/default4.webp`;
const LIVE_SCANNER_CONTACT_NOTE_TEXT = 'Populære boliger får hurtigt mange henvendelser. Se her hvordan du kommer først i køen';
const LIVE_SCANNER_MISSED_NOTE_TEXT = 'Denne bolig kan ikke længere kontaktes. Opret et BoligMatch og få besked med det samme, næste gang vi finder en lignende bolig.';
const POPULARITY_BADGE_MIN_INTEREST = 3;
const POPULARITY_BADGE_PULSE_MIN_INTEREST = 10;
const POPULARITY_BADGE_DISPLAY_CAP = 25;

function isLiveScannerListing(housing) {
    return Number.isInteger(housing?.posted_on_facebook_at) && housing.exchange_only !== true;
}

async function shouldShowLiveScannerAgentPrompt() {
    return false;
}

export async function loadHousingDetail(housing_id, detailParams = new URLSearchParams(window.location.search)) {
  try {
    resetHousingDetailView();

    if (!housing_id) {
        showHousingDetailLoadFailure("Boligen kunne ikke findes.");
        displayErrorMessage("Boligen kunne ikke findes. Linket mangler et bolig-id.");
        return;
    }

    const forceFetchAllowed = shouldForceFetchMissingHousing(detailParams);

    // 1. Fetch data
    // Detail pages treat the global advertisement list as a fast cache only.
    // It is Cloudflare-cached and usually instant, but it is still a large
    // shared payload and must not be force-refetched from here.
    const globalLookupTimeoutMs = forceFetchAllowed ? 1500 : 3000;
    let housing = await getHousingById(housing_id, '_id', {timeoutMs: globalLookupTimeoutMs});
    showDetailDebugToast(housing
        ? `Detail debug: getHousingById hit (${housing_id})`
        : `Detail debug: getHousingById miss (${housing_id})`);

    // If the cache misses, recover with the authoritative single-listing
    // endpoint. This keeps direct links reliable without downloading the full
    // ~1MB list again. `increment_view=false` avoids counting this recovery
    // fetch as a second view.
    if (!housing) {
        housing = await fetchMissingHousingById(housing_id, {timeoutMs: 5000});
        if (!housing) {
            housing = await getHousingById(housing_id, '_id', {timeoutMs: 1000});
        }
    }

    if (!housing) {
        showHousingDetailLoadFailure("Boligen kunne ikke findes.");
        displayErrorMessage("Boligen kunne ikke indlæses eller er ikke længere tilgængelig.");
        return;
    }

    const isFavorited = isHousingFavorite(housing._id);

    // 2. Populate Header & Basic Info
    const displayAddress = getShortenedAddress(housing);

    // Desktop & Mobile separate IDs for header info
    setText('detail-title', housing.title);
    setText('detail-title-mobile', housing.title);

    setText('detail-address', displayAddress);
    setText('detail-address-mobile', displayAddress);

    // Update Map Button Links to point to the specific housing on the map
    // Update Map Button Links to point to the specific housing on the map
      const mapBtn = document.getElementById('detail-map-btn');
      const mapBtnMobile = document.getElementById('detail-map-btn-mobile');

      // Check if the housing has a valid location with coordinates
      const hasLocation = housing.location &&
          Array.isArray(housing.location.coordinates) &&
          housing.location.coordinates.length === 2;

      if (hasLocation) {
          const mapLink = `/kort?id=${housing._id}`;
          if (mapBtn) {
              mapBtn.href = mapLink;
              mapBtn.classList.remove('d-none');
          }
          if (mapBtnMobile) {
              mapBtnMobile.href = mapLink;
              mapBtnMobile.classList.remove('d-none');
          }
      } else {
          // Hide the map buttons if no coordinates are present
          if (mapBtn) mapBtn.classList.add('d-none');
          if (mapBtnMobile) mapBtnMobile.classList.add('d-none');
      }

    // Metrics (Updated to handle nulls cleanly)
    setText('detail-size', housing.square_meters != null ? housing.square_meters : '-');
    setText('detail-rooms', housing.rooms != null ? housing.rooms : '-');

    // Updated Grid logic for Year and Energy
    updateConstructionYear(housing.construction_year);
    updateEnergyLabel(housing.energy_label);

    // 3. Economic Sidebar (Updated to handle Mobile IDs)
    const priceStr = formatCurrency(housing.price);
    setText('detail-price', priceStr);
    setText('detail-price-mobile', priceStr);

    const feeStr = formatCurrency(housing.monthly_fee);
    setText('detail-fee', feeStr);
    setText('detail-fee-mobile', feeStr);

    const impStr = formatCurrency(housing.improvements_price);
    setText('detail-improvements', impStr);
    setText('detail-improvements-mobile', impStr);

    // 4. Description & Facilities
    updateDescription(housing.description);
    updateFacilities(housing);

    // 5. Dates
    const createdDate = housing.created ? new Date(housing.created * 1000) : new Date();
    const dateStr = formatPostedDateTime(createdDate);

    setText('detail-created', dateStr);
    setText('detail-created-mobile', dateStr);

    // 6. Seller Info
    const sellerName = (housing.user && housing.user.name) ? housing.user.name : "Anonym Sælger";
    setText('detail-seller-name', sellerName);

    const sellerImg = document.getElementById('detail-seller-img');
    if(sellerImg && housing.user && housing.user.profileImage) {
        sellerImg.src = `${s3Url}/${housing.user.profileImage}`;
    } else if (sellerImg) {
        sellerImg.src = '/assets/default-avatar.png';
    }

    // 7. Carousel
    setupCarousel(housing);

      // --- NYT: Scraper Alert Banner & Modal ---
      const scraperAlertContainer = document.getElementById('detail-scraper-alert');

      if (scraperAlertContainer) {
          if (isLiveScannerListing(housing) && await shouldShowLiveScannerAgentPromptWithTimeout()) {
              scraperAlertContainer.innerHTML = `
            <div class="live-scanner-alert alert border-0 rounded-4 shadow-sm mb-4 d-flex flex-column flex-md-row align-items-start align-items-md-center gap-3">
                <div class="live-scanner-icon d-flex align-items-center justify-content-center rounded-circle">
                    <i class="fa-solid fa-satellite-dish fs-4" style="color: #D97706;"></i>
                </div>
                
                <div class="flex-grow-1">
                    <h6 class="fw-bold mb-1" style="color: #92400E;">Fundet af live overvågningen ⚡</h6>
                    <p class="live-scanner-text mb-0 small">
                    Populære andelsboliger får mange henvendelser på kort tid. Opret et BoligMatch, så du får besked med det samme, næste gang live overvågningen finder drømmeboligen.                    </p>
                </div>
                
                <div class="live-scanner-action flex-shrink-0">
                    <button type="button" id="detail-live-scanner-cta" class="live-scanner-cta btn btn-sm rounded-pill fw-bold px-3 py-2 hover-lift">
                        Få besked før andre
                    </button>
                </div>
            </div>
        `;
              scraperAlertContainer.classList.remove('d-none');
              setupLiveScannerCta();
          } else {
              scraperAlertContainer.innerHTML = '';
              scraperAlertContainer.classList.add('d-none');
          }
      }

    // 8. Favorite Button
    setupFavoriteButton(housing._id, isFavorited);

    // 9. Share Buttons (Top and Bottom)
    const shareBtnTop = document.getElementById('detail-share-btn');
    const shareBtnBottom = document.getElementById('detail-share-btn-bottom');

    const handleShareClick = (e) => {
        e.preventDefault();
        if (window.sharePage) window.sharePage();
    };

    if (shareBtnTop) shareBtnTop.onclick = handleShareClick;
    if (shareBtnBottom) shareBtnBottom.onclick = handleShareClick;

    // 10. Contact / Edit / Dashboard Button Logic
    //
    // The "Kontakt sælger" button is intentionally polymorphic. Future changes
    // should preserve these branches because several user journeys depend on
    // the same three button elements (desktop, mobile top, mobile bottom):
    //
    // 1. Owner view:
    //    The button becomes "Rediger annonce" and routes to the create/edit view.
    //
    // 2. Sold or reserved normal listing:
    //    The button is locked as "Boligen er solgt/reserveret" and does not
    //    open contact.
    //
    // 3. Sold or reserved live-scanner listing:
    //    The button stays as a CTA to create BoligMatch, but first clearly states
    //    "Boligen er solgt" or "Boligen er reserveret". This keeps the missed-listing
    //    upsell while making the unavailable status explicit.
    //
    // 4. Active listing, logged-out user:
    //    Opens the login modal and stores post-onboarding context so the user can
    //    return to this detail contact flow after login.
    //
    // 5. Active listing, logged-in but unsubscribed user:
    //    Checks subscription, prepares Stripe, then opens the payment modal.
    //
    // 6. Active listing, subscribed user:
    //    Fetches the full advertisement before contact handoff. Depending on the
    //    returned fields it either opens direct email contact, shows external
    //    redirect warning modals, redirects through successful_redirect, or routes
    //    to the native seller profile.
    //
    // The async contact handler also locks all three buttons while in flight to
    // avoid duplicate modals/redirects from repeated taps on mobile.
    const contactBtn = document.getElementById('detail-contact-btn');
    const contactBtnMobile = document.getElementById('detail-contact-btn-mobile');
    const contactBtnBottomMobile = document.getElementById('detail-contact-btn-bottom-mobile');
    const adminDashboards = Array.from(document.querySelectorAll('[data-admin-status-dashboard-detail]'));

    // Check if the current user is the owner
    const currentUser = decodeJwt();
    const isOwner = currentUser && housing.created_by && currentUser.sub === housing.created_by;
    const liveScannerListing = isLiveScannerListing(housing);
    const contactButtons = [contactBtn, contactBtnMobile, contactBtnBottomMobile];
    clearLiveScannerContactAssists(contactButtons);
    clearPopularityBadges(contactButtons);

    // --- Hjælpefunktion: Render Badges (Så vi kan opdatere dem live over billedet) ---
    const renderBadges = (currentHousing) => {
        const imageBadgesContainer = document.getElementById('detail-image-badges');
        if (imageBadgesContainer) {
            imageBadgesContainer.innerHTML = '';
            let badgesHtml = '';

            // Solgt trumfer reserveret
            if (currentHousing.sold) {
                badgesHtml += `<span class="badge-glass badge-sold"><i class="fa-solid fa-handshake"></i><span>Solgt</span></span>`;
            } else if (currentHousing.reserved) {
                badgesHtml += `<span class="badge-glass badge-reserved"><i class="fa-solid fa-hourglass-half"></i><span>Reserveret</span></span>`;
            }

            // Bytte-badge kan vises sammen med de andre
            if (currentHousing.exchange_only) {
                badgesHtml += `<span class="badge-glass badge-exchange"><i class="fa-solid fa-arrow-right-arrow-left"></i><span>Bytte</span></span>`;
            }

            imageBadgesContainer.innerHTML = badgesHtml;
        }
    };

    // Initial render af badges
    renderBadges(housing);

    // --- LOGIK FOR SÆLGER VS. KØBER ---
    if (isOwner) {
        // A. SÆLGER VISNING
        const editHtml = `<i class="fa-solid fa-pen-to-square me-2"></i> Rediger annonce`;

        const handleEditClick = (e) => {
            e.preventDefault();
            // Redirect to the create view (which serves as edit view for owners)
            showView('create');
        };

        contactButtons.forEach((btn) => {
            if (!btn) return;
            btn.innerHTML = editHtml;
            btn.onclick = handleEditClick;
            btn.href = "#";
            btn.className = 'btn btn-primary w-100 py-3 rounded-pill fw-bold shadow-sm transition-transform mb-3';
            btn.style.opacity = '';
            btn.style.cursor = '';
            btn.style.pointerEvents = '';
            btn.removeAttribute('aria-disabled');
            btn.removeAttribute('disabled');
        });

        // Opsætning af dashboard på både desktop og mobil
        const updateDashboardUI = (h) => {
            adminDashboards.forEach((dashboard) => {
                dashboard.classList.remove('d-none');

                const iconWrapper = dashboard.querySelector('[data-dashboard-status-icon-wrapper]');
                const icon = dashboard.querySelector('[data-dashboard-status-icon]');
                const statusText = dashboard.querySelector('[data-dashboard-status-text]');

                // Altid vis at brugerens bolig er synlig, da den altid vil være visible = true såfremt den kan ses på detail viewet
                if (iconWrapper && icon && statusText) {
                    iconWrapper.style.backgroundColor = '#fff';
                    icon.className = 'fa-solid fa-eye text-success fs-5';
                    statusText.textContent = 'Aktiv';
                    statusText.style.color = 'var(--company-dark)';
                }

                const btnReserved = dashboard.querySelector('[data-btn-toggle-reserved-detail]');
                const textReserved = dashboard.querySelector('[data-text-toggle-reserved-detail]');
                if (btnReserved && textReserved) {
                    if (h.reserved) {
                        btnReserved.style.backgroundColor = '#d97706';
                        btnReserved.style.color = '#fff';
                        textReserved.textContent = 'Fjern Reservation';
                    } else {
                        btnReserved.style.backgroundColor = '#fef3c7';
                        btnReserved.style.color = '#d97706';
                        textReserved.textContent = 'Markér Reserveret';
                    }
                }

                const btnSold = dashboard.querySelector('[data-btn-toggle-sold-detail]');
                const textSold = dashboard.querySelector('[data-text-toggle-sold-detail]');
                if (btnSold && textSold) {
                    if (h.sold) {
                        btnSold.style.backgroundColor = '#166534';
                        btnSold.style.color = '#fff';
                        textSold.textContent = 'Fortryd Solgt';
                    } else {
                        btnSold.style.backgroundColor = '#dcfce7';
                        btnSold.style.color = '#166534';
                        textSold.textContent = 'Markér Solgt';
                    }
                }

                const btnUpgradeDetail = dashboard.querySelector('[data-btn-upgrade-housing-detail]');
                if (btnUpgradeDetail) {
                    const isAlreadyPaid = h.marketing_paid === true;
                    btnUpgradeDetail.classList.toggle('d-none', isAlreadyPaid);
                }
            });

            // Opdater badges over billedet
            renderBadges(h);
        };

        const handleReservedToggle = async () => {
            const newState = !housing.reserved;
            try {
                const res = await authFetch(`/advertisement/${housing._id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reserved: newState })
                });
                if (res.ok) {
                    housing.reserved = newState;
                    updateDashboardUI(housing);
                } else throw new Error();
            } catch(err) { displayErrorMessage("Kunne ikke opdatere status."); }
        };

        const handleSoldToggle = async () => {
            const newState = !housing.sold;
            try {
                const res = await authFetch(`/advertisement/${housing._id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sold: newState })
                });
                if (res.ok) {
                    housing.sold = newState;
                    updateDashboardUI(housing);
                } else throw new Error();
            } catch(err) { displayErrorMessage("Kunne ikke opdatere status."); }
        };

        const handleUpgradeClick = (e) => {
            e.preventDefault();
            const upsellModalElement = document.getElementById('upsellModal');

            if (upsellModalElement) {
                const modal = bootstrap.Modal.getInstance(upsellModalElement) || new bootstrap.Modal(upsellModalElement);
                modal.show();
            } else {
                displayErrorMessage("Kunne ikke indlæse opgraderings-modulet. Prøv at opdatere siden.");
            }
        };

        adminDashboards.forEach((dashboard) => {
            const btnReserved = dashboard.querySelector('[data-btn-toggle-reserved-detail]');
            const btnSold = dashboard.querySelector('[data-btn-toggle-sold-detail]');
            const btnUpgrade = dashboard.querySelector('[data-btn-upgrade-housing-detail]');

            if (btnReserved) btnReserved.onclick = handleReservedToggle;
            if (btnSold) btnSold.onclick = handleSoldToggle;
            if (btnUpgrade) btnUpgrade.onclick = handleUpgradeClick;
        });

        updateDashboardUI(housing);

    } else {
        // B. KØBER VISNING

        // Skjul admin dashboard for almindelige brugere
        adminDashboards.forEach((dashboard) => dashboard.classList.add('d-none'));

        // Hvis boligen er solgt, skal kontakt-knappen låses
        if (housing.sold || housing.reserved) {
            if (liveScannerListing) {
                const statusLabel = housing.sold ? 'Boligen er solgt' : 'Boligen er reserveret';
                setupLiveScannerMissedContactButtons(contactButtons, statusLabel);
            } else {
                const statusLabel = housing.sold ? 'Boligen er solgt' : 'Boligen er reserveret';
                const btnHtml = `<i class="fa-solid fa-lock me-2"></i> ${statusLabel}`;

                const disableButton = (btn) => {
                    if (!btn) return;
                    btn.innerHTML = btnHtml;
                    btn.className = 'btn w-100 py-3 rounded-pill fw-bold shadow-sm mb-3 disabled btn-secondary';
                    btn.style.opacity = '0.7';
                    btn.style.cursor = 'not-allowed';
                    btn.href = "#";
                    btn.onclick = (e) => e.preventDefault();
                };

                disableButton(contactBtn);
                disableButton(contactBtnMobile);
                disableButton(contactBtnBottomMobile);
            }

        } else {
            // Normal kontakt-logik (Boligen er aktiv eller reserveret)
            const isExchange = housing.exchange_only === true;
            const btnText = isExchange ? 'Kontakt sælger' : 'Kontakt sælger';
            const btnIcon = isExchange ? 'fa-regular fa-envelope' : 'fa-regular fa-envelope';
            const btnHtml = `<i class="${btnIcon} me-2"></i> ${btnText}`;
            const btnClassName = 'btn btn-primary w-100 py-3 rounded-pill fw-bold shadow-sm transition-transform mb-3';
            let isContactFlowPending = false;

            const setContactButtonsNormal = () => {
                contactButtons.forEach((btn) => {
                    if (!btn) return;
                    btn.innerHTML = btnHtml;
                    btn.onclick = handleContactClick;
                    btn.href = "#";
                    btn.className = btnClassName;
                    btn.style.opacity = '';
                    btn.style.cursor = '';
                    btn.style.pointerEvents = '';
                    btn.removeAttribute('aria-disabled');
                    btn.removeAttribute('disabled');
                });
            };

            const setContactButtonsLoading = () => {
                contactButtons.forEach((btn) => {
                    if (!btn) return;
                    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Åbner kontakt...';
                    btn.className = `${btnClassName} disabled`;
                    btn.style.opacity = '0.8';
                    btn.style.cursor = 'wait';
                    btn.style.pointerEvents = 'none';
                    btn.setAttribute('aria-disabled', 'true');
                    btn.setAttribute('disabled', '');
                });
            };

            const handleContactClick = async (e) => {
                e.preventDefault();

                if (isContactFlowPending) return;

                isContactFlowPending = true;
                setContactButtonsLoading();

                try {
                    // 1. Tjek om brugeren er logget ind
                    const user = decodeJwt();

                    if (!user) {
                        const loginParams = new URLSearchParams({
                            id: housing._id
                        });
                        rememberPostOnboardingContext({
                            view: 'detail',
                            params: loginParams,
                            action: 'contact_seller',
                            returnUrl: `${window.location.origin}${basePath}/detaljer?${loginParams.toString()}`
                        });
                        displayLoginModal('detail', loginParams);
                        return;
                    }

                    // --- NYT: Tjek for aktivt abonnement før kontakt info hentes ---
                    const hasSub = await isSubscribed();

                    if (!hasSub) {
                        const paymentParams = new URLSearchParams({
                            id: housing._id
                        });
                        rememberPostOnboardingContext({
                            view: 'detail',
                            params: paymentParams,
                            action: 'contact_seller',
                            returnUrl: `${window.location.origin}${basePath}/detaljer?${paymentParams.toString()}`
                        });

                        await prepareStripeBuyButton();
                        updateStripePaymentElements();
                        const el = document.getElementById('stripePayment');
                        const clientRefId = el?.getAttribute('client-reference-id')?.trim();

                        if (!clientRefId) {
                            displayErrorMessage('Betalingen blev afbrudt, da vi ikke kunne identificere din bruger. Log ind og prøv igen.', 8000);
                            return;
                        }

                        const paymentModal = new bootstrap.Modal(document.getElementById('paymentModal'));
                        paymentModal.show();
                        return;
                    }
    
                    // 2. Hent den fulde boligmodel for at få adgang til udvidet info
                    const response = await authFetch(`/advertisement/${housing._id}`);

                    if (response.status === 401) {
                        const loginParams = new URLSearchParams({
                            id: housing._id
                        });
                        rememberPostOnboardingContext({
                            view: 'detail',
                            params: loginParams,
                            action: 'contact_seller',
                            returnUrl: `${window.location.origin}${basePath}/detaljer?${loginParams.toString()}`
                        });
                        displayLoginModal('detail', loginParams);
                        return;
                    }

                    if (!response.ok) {
                        displayErrorMessage("Kunne ikke hente kontaktinformation. Prøv igen senere.");
                        return;
                    }

                    const fullHousing = await response.json();
                    clearPostOnboardingContext();
                    const isFacebookPost = Number.isInteger(housing?.posted_on_facebook_at);
                    const hasSellerEmail = Boolean(fullHousing.seller_email);

                    // 3. HÅNDTERING AF DIREKTE KONTAKT
                    // Facebook posts should route users back to Facebook. We intentionally
                    // never expose seller_email for those listings.
                    if (hasSellerEmail && !isFacebookPost) {
                        const modalEl = document.getElementById('directContactModal');

                        // Indsæt data
                        document.getElementById('direct-seller-name').textContent = fullHousing.seller_name || 'Ukendt Sælger';
                        document.getElementById('direct-seller-email').textContent = fullHousing.seller_email;

                        // Klargør "Send mail" knap (inkluderer adressen i emnefeltet for god UX)
                        const mailtoBtn = document.getElementById('btn-mailto-seller');
                        const subject = encodeURIComponent(`Vedrørende din andelsbolig på ${housing.address}`);
                        mailtoBtn.href = `mailto:${fullHousing.seller_email}?subject=${subject}`;

                        // Klargør "Kopier mail" knap
                        const copyBtn = document.getElementById('btn-copy-email');
                        copyBtn.onclick = () => {
                            navigator.clipboard.writeText(fullHousing.seller_email).then(() => {
                                const originalHtml = copyBtn.innerHTML;
                                copyBtn.innerHTML = '<i class="fa-solid fa-check me-2 text-success"></i>Kopieret!';
                                setTimeout(() => { copyBtn.innerHTML = originalHtml; }, 2000);
                            });
                        };

                        const modalInstance = new bootstrap.Modal(modalEl);
                        modalInstance.show();
                        return; // Stop her, vi skal ikke viderestille
                    }

                    // 4. EKSISTERENDE LOGIK: Eksterne platforme viderestilling
                    if (fullHousing.scraped_realtor_url) {
                        const proceedToRedirect = () => {
                            const params = new URLSearchParams();
                            params.append('redirect_url', fullHousing.scraped_realtor_url);
                            showView('successful_redirect', params);
                        };

                        const isAndelsguide = fullHousing.scraped_realtor_url.toLowerCase().includes('andelsguide.dk');
                        const hasSeenFacebookPopup = localStorage.getItem('hasSeenFacebookExternalRedirectPopup');
                        const hasSeenPopup = localStorage.getItem('hasSeenExternalRedirectPopup');

                        if (isFacebookPost && !hasSeenFacebookPopup) {
                            const modalEl = document.getElementById('facebookExternalRedirectModal');
                            const modalInstance = new bootstrap.Modal(modalEl);

                            const continueBtn = document.getElementById('btn-continue-facebook-external');
                            continueBtn.onclick = () => {
                                localStorage.setItem('hasSeenFacebookExternalRedirectPopup', 'true');
                                modalInstance.hide();
                                proceedToRedirect();
                            };

                            modalInstance.show();
                        } else if (isAndelsguide && !hasSeenPopup) {
                            const modalEl = document.getElementById('externalRedirectModal');
                            const modalInstance = new bootstrap.Modal(modalEl);

                            const continueBtn = document.getElementById('btn-continue-external');
                            continueBtn.onclick = () => {
                                localStorage.setItem('hasSeenExternalRedirectPopup', 'true');
                                modalInstance.hide();
                                proceedToRedirect();
                            };

                            modalInstance.show();
                        } else {
                            proceedToRedirect();
                        }

                    } else {
                        // 5. EKSISTERENDE LOGIK: Native annonce - gå direkte til sælgers profil
                        const params = new URLSearchParams();
                        params.append('id', housing.created_by);
                        showView('seller_profile', params);
                    }
                } catch (err) {
                    console.error(err);
                    displayErrorMessage("Der skete en fejl. Prøv igen senere.");
                } finally {
                    isContactFlowPending = false;
                    setContactButtonsNormal();
                }
            };

            setContactButtonsNormal();

            if (liveScannerListing) {
                attachLiveScannerContactNotes(contactButtons);
            }

            attachPopularityBadges(contactButtons, housing);
        }

    }

    // Exchange Match Box
    renderExchangeMatchBox(housing);

    // --- 11. SEO OPTIMERING FOR DELING & INDEKSERING (Synkroniseret med Cloudflare Worker) ---
    const cleanUrl = `${window.location.origin}/detaljer?id=${housing._id}`;

    // 1. Byg lokationsstreng (f.eks. "8361 Hasselager" eller "Aarhus")
    let locationStr = "";
    if (housing.postal_number && housing.city) {
        locationStr = `${housing.postal_number} ${housing.city}`;
    } else if (housing.city || housing.postal_name) {
        locationStr = housing.city || housing.postal_name;
    }

    const streetStr = `${housing.street_name || ''} ${housing.house_number || ''}`.trim();
    const isSwap = housing.exchange_only;
    const actionKeyword = isSwap ? "Bytte andelsbolig" : "Andelsbolig til salg";

    // 2. Byg SEO Titlen (Samme logik som Worker)
    let seoTitle = `${actionKeyword}`;
    if (locationStr) seoTitle += ` i ${locationStr}`;
    if (streetStr) seoTitle += ` - ${streetStr}`;

    // Google klipper titler ved ~60-65 tegn
    if (seoTitle.length < 45) {
        seoTitle += ` | roomies`;
    } else if (seoTitle.length > 65) {
        seoTitle = seoTitle.substring(0, 62) + '...';
    }

    // 3. Byg SEO Beskrivelse (Samme logik som Worker)
    let seoDescription = `${actionKeyword} på ${housing.square_meters != null ? housing.square_meters : '-'} m² med ${housing.rooms != null ? housing.rooms : '-'} værelser`;
    if (locationStr) seoDescription += ` beliggende i ${locationStr}. `;
    else seoDescription += `. `;

    if (housing.price) seoDescription += `Pris: ${formatCurrency(housing.price).replace(' kr.', '')} kr. `;
    if (housing.monthly_fee) seoDescription += `Boligafgift: ${formatCurrency(housing.monthly_fee).replace(' kr.', '')} kr./md. `;
    if (housing.description) {
        seoDescription += housing.description.substring(0, 80).trim().replace(/\n/g, ' ') + '...';
    }

    const ogImage = getPrimaryHousingImageUrl(housing);

    // Kald funktionen til JSON-LD (nu med de samme strings!)
    injectHousingJSONLD(housing, seoTitle, seoDescription, cleanUrl, ogImage, streetStr);

    // 12. Report Advertisement Button Logic
    const reportBtn = document.getElementById('detail-report-btn');
    if (reportBtn) {
        reportBtn.onclick = (e) => {
            e.preventDefault();
            const user = decodeJwt();

            if (!user) {
                const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
                loginModal.show();
                return;
            }

            const reportModal = new bootstrap.Modal(document.getElementById('reportModal'));
            document.getElementById('reportForm').reset();
            document.getElementById('submitReportBtn').dataset.housingId = housing._id;
            reportModal.show();
        };
    }

    const reportForm = document.getElementById('reportForm');
    if (reportForm) {
        reportForm.onsubmit = async (e) => {
            e.preventDefault();
            const reason = document.getElementById('report-reason').value;
            const comment = document.getElementById('report-comment').value;
            const submitBtn = document.getElementById('submitReportBtn');
            const hId = submitBtn.dataset.housingId;

            if (!reason) {
                displayErrorMessage("Vælg venligst en årsag.");
                return;
            }

            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Sender...';
            submitBtn.disabled = true;

            try {
                const res = await authFetch(`/advertisement/${hId}/report`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason, comment })
                });

                if (res.ok) {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('reportModal'));
                    if (modal) modal.hide();

                    displaySuccessMessage("Tak for din anmeldelse. Vi undersøger sagen hurtigst muligt.");
                } else {
                    displayErrorMessage("Der opstod en fejl. Prøv venligst igen senere.");
                }
            } catch (err) {
                displayErrorMessage("Kunne ikke oprette forbindelse til serveren.");
            } finally {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        };
    }

    // 13. Lignende boliger (Similar Housings)
    renderSimilarHousings(housing).catch((err) => {
        console.error("Failed to render similar housings in background:", err);
    });

    updateMetaTags(seoTitle, seoDescription, cleanUrl, ogImage);

    checkAndTriggerSuccessModal(housing, isOwner)
  } catch (err) {
    console.error('loadHousingDetail crashed:', err);
    showDetailDebugToast(`Detail CRASH: ${err.message}`);
    showHousingDetailLoadFailure("Boligen kunne ikke indlæses.");
    displayErrorMessage("Kunne ikke indlæse boligen. Prøv at genindlæse siden.");
  }
}

function shouldForceFetchMissingHousing(detailParams) {
    return detailParams?.get('force_fetch_allowed') === 'true';
}

// This prompt is non-critical. If agent loading is slow, render the listing and
// skip the upsell instead of blocking the detail page.
async function shouldShowLiveScannerAgentPromptWithTimeout() {
    try {
        return await waitForDetailPromiseWithTimeout(
            shouldShowLiveScannerAgentPrompt(),
            1800,
            'Timed out loading live-scanner agent prompt state'
        );
    } catch (err) {
        console.warn('Skipping live-scanner agent prompt state on detail page:', err);
        return false;
    }
}

// Recovery path for direct detail links. It fetches the single listing without
// incrementing views because deep-link recovery should not count views twice.
async function fetchMissingHousingById(housingId, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5000;

    try {
        showDetailDebugToast(`Detail debug: direkte bolig-fetch (${housingId})`);
        const response = await waitForDetailPromiseWithTimeout(
            authFetch(`/advertisement/${housingId}?increment_view=false`),
            timeoutMs,
            `Timed out direct-fetching housing ${housingId}`
        );

        if (!response.ok) {
            showDetailDebugToast(`Detail debug: direkte bolig-fetch fejlede (${response.status})`);
            return null;
        }

        const fetchedHousing = await response.json();

        updateLocalHousing(fetchedHousing);
        return fetchedHousing;
    } catch (err) {
        console.error(`Failed to direct-fetch missing housing ${housingId}:`, err);
        return null;
    }
}

// Clears stale listing state before async work starts, so direct detail loads
// show a real loading surface instead of a blank grey view.
function resetHousingDetailView() {
    [
        'detail-title',
        'detail-title-mobile',
        'detail-address',
        'detail-address-mobile',
        'detail-size',
        'detail-rooms',
        'detail-year',
        'detail-energy-label',
        'detail-price',
        'detail-price-mobile',
        'detail-fee',
        'detail-fee-mobile',
        'detail-improvements',
        'detail-improvements-mobile',
        'detail-created',
        'detail-created-mobile',
        'detail-seller-name',
        'detail-description'
    ].forEach((id) => setText(id, ''));

    const carouselInner = document.getElementById('detail-carousel-inner');
    if (carouselInner) {
        carouselInner.innerHTML = `
            <div class="carousel-item active" style="height: 500px; background-color: #f8f9fa;">
                <div class="h-100 d-flex align-items-center justify-content-center text-muted">
                    <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Indlæser bolig...
                </div>
            </div>
        `;
    }

    [
        'detail-carousel-indicators',
        'detail-image-badges',
        'detail-scraper-alert',
        'detail-exchange-match-box',
        'detail-facilities-list',
        'similar-housings-container'
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });

    [
        'detail-scraper-alert',
        'detail-exchange-match-box',
        'detail-facilities-container',
        'similar-housings-section'
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
    });

    document.querySelectorAll('[data-admin-status-dashboard-detail]').forEach((dashboard) => {
        dashboard.classList.add('d-none');
    });

    const sellerImg = document.getElementById('detail-seller-img');
    if (sellerImg) sellerImg.src = '/assets/default-avatar.png';

    ['detail-map-btn', 'detail-map-btn-mobile'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.href = '#';
        btn.classList.add('d-none');
    });

    const loadingButtonHtml = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Indlæser...';
    ['detail-contact-btn', 'detail-contact-btn-mobile', 'detail-contact-btn-bottom-mobile'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.innerHTML = loadingButtonHtml;
        btn.href = '#';
        btn.onclick = (event) => event.preventDefault();
        btn.className = 'btn btn-primary w-100 py-3 rounded-pill fw-bold shadow-sm transition-transform mb-3 disabled';
        btn.style.opacity = '0.8';
        btn.style.cursor = 'wait';
        btn.style.pointerEvents = 'none';
        btn.setAttribute('aria-disabled', 'true');
    });

    const favBtn = document.getElementById('detail-fav-btn');
    if (favBtn) {
        favBtn.classList.remove('active');
        favBtn.removeAttribute('data-housing-id-detail');
        favBtn.onclick = null;
        const heartIcon = favBtn.querySelector('i');
        if (heartIcon) heartIcon.className = 'fa-regular fa-heart';
    }
}

// Keeps route failures visible inside the detail view when data cannot load.
function showHousingDetailLoadFailure(message) {
    setText('detail-title', message);
    setText('detail-title-mobile', message);

    const carouselInner = document.getElementById('detail-carousel-inner');
    if (carouselInner) {
        carouselInner.innerHTML = `
            <div class="carousel-item active" style="height: 500px; background-color: #f8f9fa;">
                <div class="h-100 d-flex flex-column align-items-center justify-content-center text-muted text-center px-4">
                    <i class="fa-regular fa-circle-xmark fs-1 mb-3" aria-hidden="true"></i>
                    <div class="fw-bold">${message}</div>
                    <div class="small mt-1">Prøv at åbne linket igen eller gå tilbage til listen.</div>
                </div>
            </div>
        `;
    }

    ['detail-contact-btn', 'detail-contact-btn-mobile', 'detail-contact-btn-bottom-mobile'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.innerHTML = '<i class="fa-solid fa-lock me-2"></i>Boligen kan ikke vises';
        btn.href = '#';
        btn.onclick = (event) => event.preventDefault();
        btn.className = 'btn btn-secondary w-100 py-3 rounded-pill fw-bold shadow-sm mb-3 disabled';
        btn.style.opacity = '0.75';
        btn.style.cursor = 'not-allowed';
        btn.style.pointerEvents = 'none';
        btn.setAttribute('aria-disabled', 'true');
    });
}


function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
}

function waitForDetailPromiseWithTimeout(promise, timeoutMs, message) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
}

function openLiveScannerModal() {
    setupFacebookScraperModalActions();

    const fbModalEl = document.getElementById('facebookScraperModal');
    if (fbModalEl) {
        const fbModal = bootstrap.Modal.getOrCreateInstance(fbModalEl);
        fbModal.show();
    } else {
        displayErrorMessage("Kunne ikke åbne live overvågningen. Prøv at opdatere siden.");
    }
}

function clearLiveScannerContactAssists(buttons) {
    buttons.forEach((btn) => {
        if (!btn?.parentElement) return;
        btn.parentElement
            .querySelectorAll('[data-live-scanner-contact-assist]')
            .forEach((note) => note.remove());
    });
}

function getHousingInterestCount(housing) {
    const rawCount = housing?.views ?? housing?.view_count ?? housing?.viewCount ?? 0;
    const count = Number(rawCount);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function clearPopularityBadges(buttons) {
    buttons.forEach((btn) => {
        if (!btn?.parentElement) return;
        btn.parentElement
            .querySelectorAll('[data-detail-popularity-badge]')
            .forEach((badge) => badge.remove());
    });
}

function attachPopularityBadges(buttons, housing) {
    clearPopularityBadges(buttons);

    const interestCount = getHousingInterestCount(housing);
    if (interestCount < POPULARITY_BADGE_MIN_INTEREST) return;

    const displayCount = interestCount >= POPULARITY_BADGE_DISPLAY_CAP
        ? `${POPULARITY_BADGE_DISPLAY_CAP}+`
        : interestCount.toString();
    const shouldPulse = interestCount >= POPULARITY_BADGE_PULSE_MIN_INTEREST;

    buttons.forEach((btn) => {
        if (!btn?.parentElement) return;

        const badge = document.createElement('div');
        badge.className = `detail-popularity-badge${shouldPulse ? ' is-hot' : ''}`;
        badge.setAttribute('data-detail-popularity-badge', 'true');
        badge.innerHTML = `
            <span class="detail-popularity-icon" aria-hidden="true">
                <i class="fa-solid fa-fire-flame-curved"></i>
            </span>
            <span>Populær bolig: <strong>${displayCount} købere</strong> har allerede vist interesse</span>
        `;

        btn.insertAdjacentElement('afterend', badge);
    });
}

function attachLiveScannerContactNotes(buttons) {
    clearLiveScannerContactAssists(buttons);

    buttons.forEach((btn) => {
        if (!btn?.parentElement) return;

        const note = document.createElement('button');
        note.type = 'button';
        note.className = 'live-scanner-contact-note';
        note.setAttribute('data-live-scanner-contact-assist', 'true');
        note.innerHTML = `
            <i class="fa-solid fa-circle-info mt-1" aria-hidden="true"></i>
            <span>${LIVE_SCANNER_CONTACT_NOTE_TEXT}</span>
        `;
        note.onclick = (e) => {
            e.preventDefault();
            openLiveScannerModal();
        };

        btn.insertAdjacentElement('afterend', note);
    });
}

function setupLiveScannerMissedContactButtons(buttons, statusLabel = 'ikke længere tilgængelig') {
    clearLiveScannerContactAssists(buttons);

    const handleMissedClick = async (e) => {
        e.preventDefault();
        await showView('agent_create');
    };

    buttons.forEach((btn) => {
        if (!btn?.parentElement) return;

        btn.innerHTML = `
            <span class="live-scanner-missed-status">
                <i class="fa-solid fa-lock me-2"></i>${statusLabel}
            </span>
            <span class="live-scanner-missed-action">
                Gik du glip af den? Opret BoligMatch
            </span>
        `;
        btn.className = 'btn btn-primary w-100 py-3 rounded-pill fw-bold shadow-sm transition-transform mb-3 live-scanner-missed-cta';
        btn.style.opacity = '';
        btn.style.cursor = '';
        btn.href = '#';
        btn.onclick = handleMissedClick;

        const note = document.createElement('div');
        note.className = 'live-scanner-missed-note';
        note.setAttribute('data-live-scanner-contact-assist', 'true');
        note.innerHTML = `
            <i class="fa-solid fa-satellite-dish mt-1" aria-hidden="true"></i>
            <span>${LIVE_SCANNER_MISSED_NOTE_TEXT}</span>
        `;

        btn.insertAdjacentElement('afterend', note);
    });
}

function setupLiveScannerCta() {
    const cta = document.getElementById('detail-live-scanner-cta');
    if (!cta) return;

    cta.onclick = (e) => {
        e.preventDefault();
        openLiveScannerModal();
    };
}

function setupFacebookScraperModalActions() {
    const readyBtn = document.getElementById('facebook-scraper-ready-btn');
    const paymentBtn = document.getElementById('facebook-scraper-payment-btn');

    if (readyBtn) readyBtn.onclick = async (e) => {
        e.preventDefault();

        const modalEl = document.getElementById('facebookScraperModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal?.hide();
        }

        await showView('agent_create');
    };

    if (paymentBtn) paymentBtn.onclick = (e) => {
        e.preventDefault();

        const contactBtn = document.getElementById('detail-contact-btn')
            || document.getElementById('detail-contact-btn-mobile')
            || document.getElementById('detail-contact-btn-bottom-mobile');

        if (!contactBtn) {
            displayErrorMessage('Kunne ikke åbne kontaktflowet. Prøv at opdatere siden.');
            return;
        }

        const startContactFlow = () => contactBtn.click();
        const modalEl = document.getElementById('facebookScraperModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) {
                modalEl.addEventListener('hidden.bs.modal', startContactFlow, {once: true});
                modal.hide();
                return;
            }
        }

        startContactFlow();
    };
}

function formatCurrency(amount) {
    // If the value is genuinely missing, return a dash instead of misleading "0 kr."
    if (amount === undefined || amount === null) return "-";
    return new Intl.NumberFormat('da-DK').format(amount) + ' kr.';
}

function formatPostedDateTime(date) {
    const formattedDate = date.toLocaleDateString('da-DK', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const formattedTime = date.toLocaleTimeString('da-DK', {
        hour: '2-digit',
        minute: '2-digit'
    });

    return `${formattedDate} kl. ${formattedTime}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getHousingImageUrls(housing) {
    if (Array.isArray(housing?.images) && housing.images.length > 0) {
        return housing.images
            .filter(img => img?.name)
            .map(img => `${s3Url}/${img.name}`);
    }

    return [DEFAULT_DETAIL_IMAGE];
}

function getPrimaryHousingImageUrl(housing) {
    return getHousingImageUrls(housing)[0] || DEFAULT_DETAIL_IMAGE;
}

function getEmptyExchangeCriteriaHtml() {
    return `
        <div class="exchange-empty-state rounded-4 p-4">
            <div class="d-flex align-items-start gap-3">
                <div class="exchange-empty-state-icon" aria-hidden="true">
                    <i class="fa-solid fa-circle-info"></i>
                </div>
                <div>
                    <div class="fw-bold text-dark mb-2">Byttekrav kommer snart</div>
                    <p class="mb-0 text-muted" style="line-height: 1.65; font-size: 0.96rem;">
                        Denne sælger har endnu ikke angivet specifikke krav til bytte. Du kan roligt række ud for at høre, om din andelsbolig kunne have deres interesse.
                    </p>
                </div>
            </div>
        </div>
    `;
}


function setupCarousel(housing) {
    const images = getHousingImageUrls(housing);
    const hasRealImages = Array.isArray(housing?.images) && housing.images.some(img => img?.name);
    const carouselInner = document.getElementById('detail-carousel-inner');
    const carouselIndicators = document.getElementById('detail-carousel-indicators');

    if (!carouselInner) return;

    carouselInner.innerHTML = '';
    if (carouselIndicators) carouselIndicators.innerHTML = '';

    if (images.length > 0) {
        images.forEach((imgUrl, index) => {
            const isActive = index === 0 ? 'active' : '';

            // SEO Optimering for billeder (Alt text)
            const tradeType = housing.exchange_only ? 'Bytte andelsbolig' : 'Andelsbolig til salg';
            const location = housing.city ? `i ${housing.postal_number || ''} ${housing.city}`.trim() : '';
            const titleText = housing.title || housing.street_name || 'Bolig';

            // Output eks: "Andelsbolig til salg i 2200 København N - Flot lejlighed - Billede 1 af 5"
            const imageLabel = hasRealImages ? `Billede ${index + 1} af ${images.length}` : 'Standardbillede';
            const altText = `${tradeType} ${location} - ${titleText} - ${imageLabel}`.replace(/\s+/g, ' ').trim();
            const onClickAttribute = hasRealImages ? `onclick="openFullScreen(${index})"` : '';
            const cursorStyle = hasRealImages ? 'cursor: pointer;' : 'cursor: default;';

            const slideHtml = `
                <div class="carousel-item ${isActive}" style="height: 500px; background-color: #f8f9fa;">
                    <img src="${imgUrl}" class="d-block w-100 h-100"
                         style="object-fit: cover; ${cursorStyle}" 
                         ${onClickAttribute}
                         alt="${altText}">
                </div>
            `;
            carouselInner.insertAdjacentHTML('beforeend', slideHtml);

            // Vi opdaterer også aria-label for skærmlæsere her
            if (carouselIndicators && images.length > 1) {
                const indicatorHtml = `
                    <button type="button" 
                            data-bs-target="#listingImagesCarousel" 
                            data-bs-slide-to="${index}"
                            class="${isActive}" 
                            aria-current="${isActive === 'active' ? 'true' : 'false'}" 
                            aria-label="Billede ${index + 1}">
                    </button>
                `;
                carouselIndicators.insertAdjacentHTML('beforeend', indicatorHtml);
            }
        });
    }
}


function setupFavoriteButton(housingId, isFavorited) {
    const favBtn = document.getElementById('detail-fav-btn');
    if(!favBtn) return;

    const heartIcon = favBtn.querySelector('i');

    favBtn.setAttribute("data-housing-id-detail", housingId);

    if (isFavorited) {
        favBtn.classList.add('active');
        heartIcon.className = 'fa-solid fa-heart';
    } else {
        favBtn.classList.remove('active');
        heartIcon.className = 'fa-regular fa-heart';
    }

    favBtn.onclick = (e) => {
        e.preventDefault();
        window.favoriteHousing("data-housing-id-detail", housingId);
    };
}

function updateFacilities(housing) {
    const container = document.getElementById('detail-facilities-container');
    const list = document.getElementById('detail-facilities-list');

    if (!container || !list) return;

    list.innerHTML = '';
    const facilities = [];

    // Husdyr er undtagelsen: Vises altid, men med forskellig tekst/styling
    if (housing.pets_allowed) {
        facilities.push({ icon: 'fa-solid fa-paw', text: 'Husdyr tilladt', active: true });
    } else {
        facilities.push({ icon: 'fa-solid fa-paw', text: 'Husdyr ikke tilladt', active: false });
    }

    // Resten vises KUN hvis de er true
    if (housing.balcony) facilities.push({ icon: 'fa-solid fa-sun', text: 'Altan/terrasse', active: true });
    if (housing.parking_included) facilities.push({ icon: 'fa-solid fa-square-parking', text: 'Parkering', active: true });
    if (housing.elevator) facilities.push({ icon: 'fa-solid fa-elevator', text: 'Elevator', active: true });
    if (housing.located_at_top) facilities.push({ icon: 'fa-solid fa-arrows-up-to-line', text: 'Øverste etage', active: true });
    if (housing.smoke_free) facilities.push({ icon: 'fa-solid fa-ban-smoking', text: 'Røgfrit hjem', active: true });

    if (facilities.length === 0) {
        container.classList.add('d-none');
    } else {
        container.classList.remove('d-none');
        facilities.forEach(fac => {
            const activeClass = fac.active ? 'active' : 'inactive';
            const html = `
                <div class="col">
                    <div class="facility-tile ${activeClass}">
                        <i class="${fac.icon}"></i>
                        <span class="facility-text">${fac.text}</span>
                    </div>
                </div>
            `;
            list.insertAdjacentHTML('beforeend', html);
        });
    }
}

function updateEnergyLabel(label) {
    const energyEl = document.getElementById('detail-energy-label');
    if (!energyEl) return;

    energyEl.innerHTML = '';
    energyEl.style.backgroundColor = ''; // Reset background

    if (!label) {
        energyEl.textContent = "Ej oplyst";
        energyEl.className = "text-muted fw-bold";
        return;
    }

    const normLabel = label.toUpperCase();
    const config = getEnergyConfig(normLabel);

    energyEl.textContent = normLabel;
    energyEl.style.backgroundColor = config.bg;
    energyEl.className = 'energy-badge';
}

function getEnergyConfig(label) {
    switch (label) {
        case 'A2020': return { bg: '#007800' };
        case 'A2015': return { bg: '#239a3b' };
        case 'A2010': return { bg: '#5bbf47' };
        case 'A': return { bg: '#239a3b' };
        case 'B': return { bg: '#b7d75d' };
        case 'C': return { bg: '#f2d71a' };
        case 'D': return { bg: '#f2a127' };
        case 'E': return { bg: '#e86726' };
        case 'F': return { bg: '#b52424' };
        case 'G': return { bg: '#68386c' };
        default: return { bg: '#e9ecef' };
    }
}

function updateConstructionYear(year) {
    const yearEl = document.getElementById('detail-year');
    if (!yearEl) return;

    if (year) {
        yearEl.textContent = year;
        yearEl.className = 'fw-bold fs-5 text-dark';
    } else {
        yearEl.textContent = 'Ej oplyst';
        yearEl.className = 'text-muted fw-bold';
    }
}

function updateDescription(description) {
    const descEl = document.getElementById('detail-description');
    const btnEl = document.getElementById('detail-description-btn');

    if (!descEl) return;

    // Reset state
    descEl.textContent = description || 'Ingen beskrivelse.';
    descEl.style.maxHeight = '';
    descEl.classList.remove('truncated');
    if(btnEl) btnEl.classList.add('d-none');

    // If description is long (approx 500 chars)
    if (description && description.length > 500) {

        // Start in truncated state
        descEl.classList.add('truncated');

        if(btnEl) {
            btnEl.classList.remove('d-none');
            btnEl.textContent = "Læs mere";

            const newBtn = btnEl.cloneNode(true);
            btnEl.parentNode.replaceChild(newBtn, btnEl);

            newBtn.onclick = (e) => {
                e.preventDefault();
                const isTruncated = descEl.classList.contains('truncated');

                if (isTruncated) {
                    // EXPAND
                    const fullHeight = descEl.scrollHeight;
                    descEl.style.maxHeight = fullHeight + 'px';
                    descEl.classList.remove('truncated');
                    newBtn.textContent = "Vis mindre";

                    setTimeout(() => {
                        if (!descEl.classList.contains('truncated')) {
                            descEl.style.maxHeight = 'none';
                        }
                    }, 600);
                } else {
                    // COLLAPSE
                    descEl.style.maxHeight = descEl.scrollHeight + 'px';
                    descEl.offsetHeight; // force reflow

                    descEl.classList.add('truncated');
                    descEl.style.maxHeight = ''; // clear inline to let CSS take over

                    newBtn.textContent = "Læs mere";
                    descEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            };
        }
    }
}

/**
 * Renders the Exchange (Swap) Match Box showing what the seller is looking for.
 * Uses housing.exchange_criteria directly from the advertisement object.
 */
function renderExchangeMatchBox(housing) {
    const container = document.getElementById('detail-exchange-match-box');
    if (!container) return;

    // Reset state
    container.innerHTML = '';
    container.classList.add('d-none');

    // Only show for exchange listings
    if (!housing.exchange_only) return;

    const criteria = housing.exchange_criteria;
    let contentHtml = getEmptyExchangeCriteriaHtml();

    // If there is a free-text description of the exchange criteria, display ONLY this text.
    if (criteria?.text && criteria.text.trim() !== '') {
        const formattedText = criteria.text.replace(/\n/g, '<br>');
        contentHtml = `
            <div class="exchange-text-content p-3">
                <i class="fa-solid fa-quote-left quote-icon text-primary mb-2 opacity-50"></i>
                <p class="mb-0 text-dark fw-medium" style="line-height: 1.6; font-size: 0.95rem;">
                    ${formattedText}
                </p>
            </div>
        `;
    } else if (criteria && typeof criteria === 'object') {
        // Fallback: Build grid items if no free-text exists
        const formatNum = (val) => new Intl.NumberFormat('da-DK').format(val);
        const buildRangeString = (min, max, unit = '') => {
            if (min != null && max != null) {
                if (min === max) return `${formatNum(min)} ${unit}`;
                return `${formatNum(min)} - ${formatNum(max)} ${unit}`;
            }
            if (max != null) return `Max ${formatNum(max)} ${unit}`;
            if (min != null) return `Min. ${formatNum(min)} ${unit}`;
            return null;
        };

        const items = [];

        if (criteria.areas && Array.isArray(criteria.areas) && criteria.areas.length > 0) {
            const formatArea = (area) => {
                const normalizedArea = String(area).trim();
                if (areaGroupIdToLabel.has(normalizedArea)) return areaGroupIdToLabel.get(normalizedArea);
                if (postalData[normalizedArea]) return `${normalizedArea} - ${postalData[normalizedArea]}`;
                return normalizedArea;
            };
            const mappedAreas = criteria.areas
                .map(formatArea)
                .filter(area => area && area.trim() !== '');

            if (mappedAreas.length > 0) {
                const areaLinesHtml = mappedAreas
                    .map(area => `<span class="swap-value-line">${escapeHtml(area)}</span>`)
                    .join('');

                items.push({
                    icon: 'fa-solid fa-map-location-dot',
                    label: 'Ønskede områder',
                    valueHtml: `<div class="swap-value-list">${areaLinesHtml}</div>`,
                    title: mappedAreas.join(', '),
                    wrap: true
                });
            }
        } else if (criteria.postal_number) {
            const postalName = postalData[String(criteria.postal_number)];
            const postalLabel = postalName ? `${criteria.postal_number} - ${postalName}` : String(criteria.postal_number);
            items.push({ icon: 'fa-solid fa-map-location-dot', label: 'Område', value: `${postalLabel}` });
        }

        const feeStr = buildRangeString(null, criteria.monthly_price_to, 'kr.');
        if (feeStr) items.push({ icon: 'fa-solid fa-coins', label: 'Boligafgift', value: feeStr });

        const priceStr = buildRangeString(null, criteria.price_to, 'kr.');
        if (priceStr) items.push({ icon: 'fa-solid fa-tag', label: 'Pris', value: priceStr });

        const sizeStr = buildRangeString(criteria.square_meters_from, criteria.square_meters_to, 'm²');
        if (sizeStr) items.push({ icon: 'fa-solid fa-house', label: 'Størrelse', value: sizeStr });

        const roomStr = buildRangeString(criteria.rooms_from, criteria.rooms_to, 'rum');
        if (roomStr) items.push({ icon: 'fa-solid fa-bed', label: 'Værelser', value: roomStr });

        if (items.length > 0) {
            const itemsHtml = items.map(item => {
                const valueClass = item.wrap ? 'swap-value swap-value-wrap' : 'swap-value text-truncate';
                const valueText = item.value ?? '';
                const valueTitle = item.title ?? valueText;
                const titleAttr = valueTitle ? ` title="${escapeHtml(valueTitle)}"` : '';
                const valueContent = item.valueHtml || escapeHtml(valueText);

                return `
            <div class="col-12 col-md-6 mb-3">
                <div class="d-flex align-items-center gap-3 swap-item-row">
                    <div class="d-flex align-items-center justify-content-center bg-white rounded-circle shadow-sm" style="width: 36px; height: 36px; min-width: 36px;">
                        <i class="${item.icon} text-primary fs-6"></i>
                    </div>
                    <div class="swap-item-content">
                        <div class="swap-label">${item.label}</div>
                        <div class="${valueClass}"${titleAttr}>${valueContent}</div>
                    </div>
                </div>
            </div>
        `;
            }).join('');

            contentHtml = `<div class="row g-2">${itemsHtml}</div>`;
        }
    }

    container.innerHTML = `
        <div class="swap-glass-card p-4 mb-4">
            <div class="d-flex align-items-center justify-content-between mb-4 pb-3 border-bottom border-light">
                <div class="d-flex align-items-center gap-3">
                    <div class="swap-icon-wrapper">
                        <i class="fa-solid fa-arrow-right-arrow-left fa-lg"></i>
                    </div>
                    <div>
                        <h5 class="fw-bold mb-0 text-dark">Sælger søger bytte</h5>
                        <small class="text-muted">Matcher din bolig disse ønsker? Kontakt sælger før det er for sent.</small>
                    </div>
                </div>
            </div>

            ${contentHtml}
        </div>
    `;

    container.classList.remove('d-none');
}

/**
 * Injicerer Schema Markup dynamisk for detaljesiden.
 * Synkroniseret til at matche Cloudflare Workerens 'RealEstateListing' format.
 */
export function injectHousingJSONLD(housing, seoTitle, seoDesc, canonicalUrl, seoImage, streetStr) {
    const existingSchema = document.getElementById('schema-housing-detail');
    if (existingSchema) existingSchema.remove();

    // Bolig & Pris Schema Markup (Matcher Worker 1:1)
    const schemaData = {
        "@context": "https://schema.org",
        "@type": "RealEstateListing",
        "name": seoTitle,
        "description": seoDesc,
        "url": canonicalUrl,
        "image": seoImage || DEFAULT_OG_IMAGE,
        "datePosted": housing.created ? new Date(housing.created * 1000).toISOString() : undefined,
        "offers": {
            "@type": "Offer",
            "price": housing.price || 0,
            "priceCurrency": "DKK",
            "availability": "https://schema.org/InStock"
        },
        "address": {
            "@type": "PostalAddress",
            "streetAddress": streetStr,
            "addressLocality": housing.city || housing.postal_name,
            "postalCode": housing.postal_number?.toString(),
            "addressCountry": "DK"
        }
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'schema-housing-detail';
    script.text = JSON.stringify(schemaData);

    document.head.appendChild(script);
}


window.openFullScreen = async (index) => {
    const params = new URLSearchParams(window.location.search);
    const housingId = params.get('id');
    const housing = await getHousingById(housingId);

    if(!housing) return;

    const imageUrls = getHousingImageUrls(housing);
    const galleryEl = document.getElementById('fullImageScrollGallery');
    const modalEl = document.getElementById('fullImageModal');
    if (!galleryEl || !modalEl) return;

    galleryEl.innerHTML = '';
    galleryEl.scrollTop = 0;

    imageUrls.forEach((imgUrl, i) => {
        galleryEl.insertAdjacentHTML('beforeend', `
            <figure class="full-image-scroll-item" data-full-image-index="${i}">
                <div class="full-image-frame">
                    <img src="${imgUrl}" alt="Boligbillede ${i + 1} af ${imageUrls.length}">
                </div>
            </figure>
        `);
    });
    galleryEl.insertAdjacentHTML('beforeend', `
        <div class="full-image-gallery-footer">
            <button type="button" class="btn btn-light rounded-pill fw-bold px-4 py-3 shadow-sm" data-bs-dismiss="modal">
                <i class="fa-solid fa-arrow-left me-2"></i>Tilbage til boligen
            </button>
        </div>
    `);

    const modal = new bootstrap.Modal(modalEl);

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            modal.hide();
        }
    };

    modalEl.addEventListener('shown.bs.modal', () => {
        document.addEventListener('keydown', handleKeyDown);
        const targetImage = galleryEl.querySelector(`[data-full-image-index="${index}"]`);
        if (targetImage) {
            targetImage.scrollIntoView({block: 'start'});
        }
    }, { once: true });

    modalEl.addEventListener('hidden.bs.modal', () => {
        document.removeEventListener('keydown', handleKeyDown);
        galleryEl.innerHTML = '';
    }, { once: true });

    modal.show();
};

/**
 * Renders up to 3 similar housing listings at the bottom of the detail page.
 * If the current listing has a postal_number, only listings from that same
 * postal number are shown. Otherwise it falls back to the general eligible pool.
 * Enforces strict 'exchange_only' matching and excludes sold/reserved properties.
 */
async function renderSimilarHousings(currentHousing) {
    const section = document.getElementById('similar-housings-section');
    const container = document.getElementById('similar-housings-container');

    if (!section || !container) return;

    try {
        // 1. Ensure the global housing pool is loaded gracefully
        if (!window.housings || window.housings.length === 0) {
            if (window.housingFetchPromise) {
                // Await the background job that main.js already started!
                await waitForDetailPromiseWithTimeout(
                    window.housingFetchPromise,
                    2500,
                    'Timed out waiting for similar housings background data'
                );
            } else if (typeof fetchAllAdvertisements === 'function') {
                await waitForDetailPromiseWithTimeout(
                    fetchAllAdvertisements(),
                    2500,
                    'Timed out fetching similar housings data'
                );
            }
        }

        if (!window.housings || !Array.isArray(window.housings)) return;

        // 2. Filter the housings based on strict criteria
        const candidates = window.housings.filter(h => {
            if (h._id === currentHousing._id) return false;
            if (!!h.exchange_only !== !!currentHousing.exchange_only) return false;
            if (h.sold || h.reserved || h.deleted) return false;
            return true;
        });

        const currentPostalNumber = currentHousing.postal_number != null
            ? String(currentHousing.postal_number).trim()
            : "";
        const selectionPool = currentPostalNumber
            ? candidates.filter(h => String(h.postal_number ?? "").trim() === currentPostalNumber)
            : candidates;

        // 3. Shuffle the selection pool randomly
        for (let i = selectionPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [selectionPool[i], selectionPool[j]] = [selectionPool[j], selectionPool[i]];
        }

        // 4. Render selection. Postal matching may legitimately return fewer than 3.
        const randomSelection = selectionPool.slice(0, 3);

        if (randomSelection.length > 0) {
            container.innerHTML = randomSelection.map((h, index) =>
                generateHousingCard(h, "data-housing-id-similar", index)
            ).join('');
            section.classList.remove('d-none');
        } else {
            section.classList.add('d-none');
        }
    } catch (error) {
        console.error("Failed to load similar housings:", error);
        // Fail gracefully without breaking the rest of the detail page
        section.classList.add('d-none');
    }
}

/**
 * Viser succes-modalen med forsinkelse, hvis brugeren er ejeren,
 * og de ikke har set den for denne bolig før.
 */
export function checkAndTriggerSuccessModal(housing, isOwner) {
    // 1. Afbryd hvis brugeren ikke er ejeren
    if (!isOwner) return;

    // 2. Tjek om vi allerede har vist modalen for denne bolig
    const storageKey = `has_shown_modal_${housing._id}`;
    const hasBeenShown = localStorage.getItem(storageKey);

    // 3. Hvis den IKKE er vist før, så kører vi fejringen
    if (!hasBeenShown) {

        // Sæt flaget permanent med det samme
        localStorage.setItem(storageKey, 'true');

        // Vent 1.5 sekunder og vis modalen
        setTimeout(() => {
            const successModalEl = document.getElementById('listingSuccessModal');
            if (successModalEl) {
                const modalInstance = bootstrap.Modal.getOrCreateInstance(successModalEl);

                // Sæt funktionalitet på dele-knappen
                const shareBtn = document.getElementById('btn-share-new-listing');
                if (shareBtn) {
                    shareBtn.onclick = () => {
                        const url = window.location.href;
                        if (navigator.share) {
                            navigator.share({
                                title: housing.title || 'Andelsbolig til salg',
                                text: 'Tjek min andelsbolig ud på roomies!',
                                url: url
                            }).catch(err => console.warn("Bruger afviste deling", err));
                        } else if (navigator.clipboard) {
                            navigator.clipboard.writeText(url)
                                .then(() => displaySuccessMessage("Link kopieret ✅"))
                                .catch(() => alert("Klipholder adgang nægtet."));
                        }
                    };
                }

                modalInstance.show();
            }
        }, 1500);
    }
}

function isLocalOrDevDebugHost() {
    return environment === 'local' || environment === 'dev';
}

export function showDetailDebugToast(message) {
    if (!isLocalOrDevDebugHost()) return;
    displaySuccessMessage(message, 2200);
}

