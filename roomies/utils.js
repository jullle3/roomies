import {updateStripePaymentElements} from "./login/login.js";
import {authFetch} from "./auth/auth.js";
import {displayLoginModal} from "./views/viewManager.js";
import {environment, stripe_buy_button_id, stripe_buy_button_publishable_key} from "./config/config.js";

export let currentUser = null;
let currentUserLoadPromise = null;
let stripeScriptPromise = null;
let stripeFallbackTimer = null;
export const DEFAULT_OG_IMAGE = 'https://roomiedanmark.dk/pics/opengraph3.webp';
export const DEFAULT_OG_URL = 'https://roomiedanmark.dk';
const DEV_ACCESS_GRANTED_KEY = 'roomies_dev_access_granted';
const DEV_ACCESS_PASSWORD = '1';


export function setupUtils() {
    updateStripePaymentElements();
    setupStripePaymentFallback();
    document.getElementById('error-message-remove').addEventListener('click', hideErrorMessage);
}

export function isDevEnvironment() {
    return environment === 'dev';
}

export function requireDevAccessGate() {
    if (!isDevEnvironment() || localStorage.getItem(DEV_ACCESS_GRANTED_KEY) === 'true') {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const gate = document.createElement('div');
        gate.id = 'dev-access-gate';
        gate.className = 'position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-4';
        gate.style.cssText = 'z-index: 99999; background: rgba(240, 246, 255, 0.96); backdrop-filter: blur(10px);';

        gate.innerHTML = `
            <form class="bg-white border rounded-4 shadow-lg p-4 p-md-5" style="width: min(100%, 420px);" novalidate>
                <div class="text-center mb-4">
                    <div class="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary bg-opacity-10 text-primary mb-3" style="width: 56px; height: 56px;">
                        <i class="fa-solid fa-lock"></i>
                    </div>
                    <h1 class="h4 fw-bold company-dark mb-2">Dev adgang</h1>
                    <p class="small text-muted mb-0">Indtast adgangsordet for at fortsætte.</p>
                </div>
                <div class="form-floating mb-3">
                    <input type="password" class="form-control rounded-3 border-light bg-light" id="dev-access-password" placeholder="Adgangsord" autocomplete="off" autofocus>
                    <label for="dev-access-password" class="text-secondary">Adgangsord</label>
                </div>
                <p class="small text-danger mb-3 d-none" id="dev-access-error">Forkert adgangsord.</p>
                <button type="submit" class="btn btn-primary rounded-pill fw-bold w-100 py-3">
                    Fortsæt <i class="fa-solid fa-arrow-right ms-2"></i>
                </button>
            </form>
        `;

        document.body.appendChild(gate);

        const form = gate.querySelector('form');
        const input = gate.querySelector('#dev-access-password');
        const error = gate.querySelector('#dev-access-error');

        setTimeout(() => input?.focus(), 0);

        form.addEventListener('submit', event => {
            event.preventDefault();

            if (input.value !== DEV_ACCESS_PASSWORD) {
                error.classList.remove('d-none');
                input.classList.add('is-invalid');
                input.select();
                return;
            }

            localStorage.setItem(DEV_ACCESS_GRANTED_KEY, 'true');
            gate.remove();
            resolve();
        });
    });
}


export function displayErrorMessage(message, ms = 6000) {
    const animation = document.getElementById("error-animation");

    // Reset animation safely
    if (animation && typeof animation.stop === 'function') {
        animation.stop();
    }

    let errorContainer = document.getElementById('error-container');
    let errorMessage = document.getElementById('error-message');

    errorMessage.innerHTML = message.replace(/\n/g, '<br>');
    errorContainer.style.display = 'block';
    errorContainer.classList.add('show');

    // Play safely
    if (animation && typeof animation.play === 'function') {
        animation.play();
    }

    // Clear any existing timeout to avoid multiple timeouts running simultaneously
    if (errorContainer.timeoutId) {
        clearTimeout(errorContainer.timeoutId);
    }

    // Start the fade-out effect after ms-1000 milliseconds to allow for 1 second of fade effect
    errorContainer.timeoutId = setTimeout(() => {
        errorContainer.classList.add('fade-out');
        // Finally, hide the message completely
        setTimeout(() => hideErrorMessage(), 1000);
    }, ms - 1000);
}

export function displaySuccessMessage(message, ms = 6000) {
    const animation = document.getElementById("success-animation");

    // Reset animation safely
    if (animation && typeof animation.stop === 'function') {
        animation.stop();
    }

    let successContainer = document.getElementById('success-container');
    let successMessage = document.getElementById('success-message');

    successMessage.innerHTML = message.replace(/\n/g, '<br>');
    successContainer.style.display = 'block';
    successContainer.classList.add('show');

    // Play safely
    if (animation && typeof animation.play === 'function') {
        animation.play();
    }

    if (successContainer.timeoutId) {
        clearTimeout(successContainer.timeoutId);
    }

    successContainer.timeoutId = setTimeout(() => {
        successContainer.classList.add('fade-out');
        setTimeout(() => hideSuccessMessage(), 1000);
    }, ms - 1000);
}

function hideErrorMessage() {
    let errorContainer = document.getElementById('error-container');
    errorContainer.style.display = 'none';
    errorContainer.classList.remove('show', 'fade-out');
}

export function hideSuccessMessage() {
    let successContainer = document.getElementById('success-container');
    successContainer.style.display = 'none';
    successContainer.classList.remove('show', 'fade-out');
}




/**
 * @typedef {Object} JwtPayload
 * @property {string} sub - The user ID (e.g., "682a4d3f...")
 * @property {string} email - User's email address
 * @property {string} full_name - User's full name
 * @property {boolean} email_notifications - Whether email notifications are enabled
 * @property {boolean} sms_notifications - Whether SMS notifications are enabled
 * @property {string} iss - Issuer (e.g., "https://roomies.dk")
 * @property {number} exp - Expiration timestamp
 * @property {number} iat - Issued at timestamp
 */

/**
 * Decodes the JWT token from localStorage.
 * * @returns {JwtPayload|null} The decoded token payload or null if no token exists.
 */
export function decodeJwt() {
    const jwt = localStorage.getItem('jwt');
    if (!jwt) {
        return null;
    }
    const base64Url = jwt.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}


function formatNumber(input) {
    let cursorPosition = input.selectionStart;  // Save the cursor position
    const originalLength = input.value.length;  // Save the original length of the string

    let with_dots = input.value;
    input.value = with_dots.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    // Adjust cursor position after formatting
    const newLength = input.value.length;
    cursorPosition = cursorPosition - (originalLength - newLength);

    input.setSelectionRange(cursorPosition, cursorPosition);
}


// Clean the params for an HTTP request removing any empty or whitespace-only values
export function cleanParams(params) {
    return Object.fromEntries(
        Object.entries(params).filter(([_, v]) => v && v.trim() !== '')
    );
}

export function removeDots(inputString) {
    return inputString.replace(/\./g, '');
}


export function parseFormattedInteger(value) {
    // Helper function to convert formatted string with delimiters to integer
    return parseInt(value.replace(/\./g, ''), 10);
}


/**
 * Shows a confirmation modal with a custom title, message, and action.
 * Automatically styles the icon/theme based on the button class.
 *
 * @param {string} title - The modal header.
 * @param {string} message - The body text (newlines become <br>).
 * @param {function} onConfirm - Callback fired when confirmed.
 * @param {string} [confirmButtonClass="btn-danger"] - Class for the confirm button (e.g., "btn-danger" for warning, "btn-primary" for info).
 */
export function showConfirmationModal(title, message, onConfirm, confirmButtonClass = "btn-danger") {
    // 1. Update Text Content
    $('#genericConfirmationModalLabel').text(title);
    // Use .html() to allow <br> tags for multi-line messages
    $('#genericConfirmationModalBody').html(message.replace(/\n/g, '<br>'));

    // 2. Cache Elements
    const $confirmButton = $('#confirmActionButton');
    const $icon = $('#confirmationIcon');
    const $modal = $('#genericConfirmationModal');

    // 3. Reset and Apply Button Classes
    $confirmButton.removeClass('btn-danger btn-primary btn-success btn-warning action-button');
    $confirmButton.text('Bekræft');
    $confirmButton.addClass(confirmButtonClass);
    $modal.removeClass('confirmation-intent-danger confirmation-intent-info');

    // 4. Dynamic "Theming" based on intent
    if (confirmButtonClass.includes('btn-danger')) {
        $modal.addClass('confirmation-intent-danger');
        $icon.attr('class', 'fa-solid fa-triangle-exclamation generic-confirmation-icon-symbol');
    }
    else {
        $modal.addClass('confirmation-intent-info');
        $icon.attr('class', 'fa-solid fa-circle-info generic-confirmation-icon-symbol');
    }

    // 5. Bind Click Handler
    $confirmButton.off('click').on('click', function() {
        try {
            onConfirm();
        } finally {
            $('#genericConfirmationModal').modal('hide');
        }
    });

    // 6. Show Modal
    $('#genericConfirmationModal').modal('show');
}

export function isLoggedIn() {
    return localStorage.getItem('jwt') !== null;
}

/**
 * @returns {boolean} True if the user is still subscribed, false otherwise.
 */
export async function isSubscribed() {
    let response = await authFetch("/roomies/is-subscribed")
    return response.ok
}

// Load and store info about the logged-in user
export async function loadUser(force = false) {
    if (!isLoggedIn()) {
        currentUser = null;
        currentUserLoadPromise = null;
        return null;
    }

    if (currentUser && !force) {
        return currentUser;
    }

    if (currentUserLoadPromise && !force) {
        return currentUserLoadPromise;
    }

    currentUserLoadPromise = (async () => {
        const jwt = decodeJwt()
        const response = await authFetch(`/roomies/user/${jwt.sub}`);

        if (!response.ok) {
            let body = await response.json()
            displayErrorMessage(body.detail);
            return null;
        }

        currentUser = await response.json()
        checkAndDisplayEmailWarnings();
        return currentUser;
    })();

    try {
        return await currentUserLoadPromise;
    } finally {
        currentUserLoadPromise = null;
    }
}

export async function ensureCurrentUserLoaded() {
    return loadUser(false);
}

export function resetCurrentUser(){
    currentUser = null;
    currentUserLoadPromise = null;
}

export function setCurrentUser(user) {
    currentUser = user || null;
    currentUserLoadPromise = null;
    checkAndDisplayEmailWarnings();
}

// Called when user clicks "favorite" icon on an housing
// Called when user clicks "favorite" icon on an housing
export async function favoriteHousing(id_to_update, housingId) {
    if (currentUser === null) {
        displayLoginModal(null, null)
        return;
    }

    const isFavorited = currentUser.favorite_advertisements.includes(housingId);

    // 1. Find the CONTAINER element (the div with the ID attribute)
    const container = document.querySelector(`[${id_to_update}="${housingId}"]`);

    if (!container) {
        console.warn(`Favorite container for housing ${housingId} not found.`);
        return;
    }

    // 2. Find the ICON element inside
    const iconElement = container.querySelector('i');

    // Determine the operation: if currently favorited, we want to remove it, otherwise add it.
    const addOperation = !isFavorited;

    if (addOperation) {
        // --- ADDING TO FAVORITES ---
        currentUser.favorite_advertisements.push(housingId);

        // Update Container (New Design uses .active for color)
        container.classList.add("active");

        // Update Icon (FontAwesome: Regular -> Solid)
        if (iconElement) {
            iconElement.classList.remove("fa-regular");
            iconElement.classList.add("fa-solid");

            // REMOVED: Legacy Bootstrap Icons support which caused the font conflict
        }

    } else {
        // --- REMOVING FROM FAVORITES ---
        currentUser.favorite_advertisements = currentUser.favorite_advertisements.filter(item => item !== housingId);

        // Update Container
        container.classList.remove("active");

        // Update Icon (FontAwesome: Solid -> Regular)
        if (iconElement) {
            iconElement.classList.remove("fa-solid");
            iconElement.classList.add("fa-regular");

            // REMOVED: Legacy Bootstrap Icons support which caused the font conflict
        }
    }

    // Query the backend to update the user's favorites
    const response = await authFetch('/roomies/user', {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            favorite_advertisement: housingId,
            favorite_advertisement_add_operation: addOperation
        })
    });

    if (!response.ok) {
        displayErrorMessage("Noget gik galt");
    }
}


// Only load stripe when its actually needed
export function loadStripeScript() {
    if (stripeScriptPromise) {
        return stripeScriptPromise;
    }

    stripeScriptPromise = new Promise((resolve, reject) => {
        if (document.querySelector('script[src="https://js.stripe.com/v3/buy-button.js"]')) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = "https://js.stripe.com/v3/buy-button.js";
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });

    return stripeScriptPromise;
}

export function setupBootstrapTooltips() {
    document
        .querySelectorAll('[data-bs-toggle="tooltip"]')
        .forEach(el => bootstrap.Tooltip.getOrCreateInstance(el));
}


// Shrink image while keeping dimensional proportions
export async function shrinkImage(file, maxEdge = 1600) {
    const img = await createImageBitmap(file);

    const ratio = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    // Draw to an off‑screen canvas
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const type = file.type === 'image/jpeg' && self.chrome ? 'image/webp' : file.type;
    const blob = await off.convertToBlob({ type, quality: 0.90 });
    return new File([blob], file.name.replace(/\.\w+$/, '.webp'), { type: blob.type });
}


/**
 * Build a shortened, non-duplicating address string.
 */
export function getShortenedAddress(housing) {
    // 1. Destructure street_name (ignoring house_number)
    const {
        street_name,
        postal_number,
        postal_name,
        city,
        floor,
        floor_side
    } = housing;

    if (!postal_number) return "Ikke angivet";

    const street = street_name?.trim() || "";

    // 2. Build the City/Zip part (Existing Logic)
    const postal_name_trimmed = postal_name?.trim() || "";
    const town = city?.trim() || "";

    let cityPart = "";

    if (postal_name_trimmed && town && postal_name_trimmed.toLowerCase() === town.toLowerCase()) {
        cityPart = `${postal_number} ${postal_name_trimmed}`;
    } else if (postal_name_trimmed && town) {
        cityPart = `${postal_number} ${postal_name_trimmed} - ${town}`;
    } else if (postal_name_trimmed) {
        cityPart = `${postal_number} ${postal_name_trimmed}`;
    } else if (town) {
        cityPart = `${postal_number} - ${town}`;
    } else {
        cityPart = `${postal_number}`;
    }

    // 3. Combine Street and City parts
    // Format: "Street Name, 1234 City"
    let base = street
        ? `${street}, ${cityPart}`
        : cityPart;

    // 4. Add Floor/Side Suffix
    const floorStr = (floor ?? "").toString().trim();
    const sideStr = (floor_side ?? "").toString().trim();
    const suffix = [floorStr, sideStr].filter(Boolean).join(" ");

    return suffix ? `${base} - ${suffix}` : base;
}



function sharePage() {
    const url = window.location.href;

    if (navigator.share) {
        navigator.share({
            title: document.title,
            url: url // Text removed, now it just shares the link and title
        }).catch(err => console.warn("Bruger afviste deling", err));
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url)
            // Fixed: changed showSuccessMessage to displaySuccessMessage to match utils.js
            .then(() => displaySuccessMessage("Link kopieret ✅"))
            .catch(() => alert("Du skal give din browser tilladelse til at kopiere til klipholder først."));
    } else {
        alert("Deling understøttes ikke");
    }
}

/**
 * Opdaterer SEO og meta-tags dynamisk for SPA-views.
 * * VIGTIGE TAGS FOR SPA SEO:
 * - Canonical (<link rel="canonical">): Fortæller Google, hvad den "sande" URL for
 * indholdet er. Kritisk for SPAs for at undgå, at Google ser alle undersider
 * som værende duplikater af forsiden (index.html).
 * - og:url (Open Graph): Sikrer at Facebook, LinkedIn, Messenger m.fl. linker direkte
 * til den specifikke bolig/underside.
 * - twitter:url: Bruges af X (Twitter), Slack, Discord m.fl.
 *
 * @param {string} title - Sidens titel (bruges til <title>, Open Graph og Twitter)
 * @param {string} desc - Sidens meta-beskrivelse
 * @param {string} [url=window.location.href] - Den specifikke (kanoniske) URL for dette view
 * @param {string} [img='https://roomiedanmark.dk/pics/opengraph3.webp'] - Billede til social deling
 */
export function updateMetaTags(
    title,
    desc,
    url = window.location.href, // Default til den nuværende URL
    img = 'https://roomiedanmark.dk/pics/opengraph3.webp' // Dit standard OpenGraph billede
) {
    // 1. Page title and description
    document.title = title;
    let descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.setAttribute('content', desc);

    // Rens URL'en for legacy interne parametre (f.eks. ?view=landing), så Google får en ren URL
    let cleanUrl;
    try {
        const urlObj = new URL(url);
        urlObj.searchParams.delete('view');
        cleanUrl = urlObj.toString();
    } catch (e) {
        cleanUrl = url;
    }

    // Intern helper-funktion til at oprette tags dynamisk, hvis de ikke allerede findes i <head>
    const setOrCreateTag = (tagName, attrName, attrValue, contentAttrName, contentValue) => {
        let tag = document.querySelector(`${tagName}[${attrName}="${attrValue}"]`);
        if (!tag) {
            tag = document.createElement(tagName);
            tag.setAttribute(attrName, attrValue);
            document.head.appendChild(tag);
        }
        tag.setAttribute(contentAttrName, contentValue);
    };

    // 2. Canonical URL (Kritisk for SPAs!)
    setOrCreateTag('link', 'rel', 'canonical', 'href', cleanUrl);

    // 3. Open Graph tags
    setOrCreateTag('meta', 'property', 'og:title', 'content', title);
    setOrCreateTag('meta', 'property', 'og:description', 'content', desc);
    setOrCreateTag('meta', 'property', 'og:image', 'content', img);
    setOrCreateTag('meta', 'property', 'og:url', 'content', cleanUrl);

    // 4. Twitter card tags
    setOrCreateTag('meta', 'name', 'twitter:title', 'content', title);
    setOrCreateTag('meta', 'name', 'twitter:description', 'content', desc);
    setOrCreateTag('meta', 'name', 'twitter:image', 'content', img);
    setOrCreateTag('meta', 'name', 'twitter:url', 'content', cleanUrl);
}


export function updateStripeConfig() {
    const stripeButton = ensureStripeBuyButtonElement();
    if (!stripeButton) return;

    const mount = document.getElementById("stripe-payment-button-mount");
    if (!mount) return null;

    if (stripeButton.getAttribute("buy-button-id") !== stripe_buy_button_id) {
        stripeButton.setAttribute("buy-button-id", stripe_buy_button_id);
    }
    if (stripeButton.getAttribute("publishable-key") !== stripe_buy_button_publishable_key) {
        stripeButton.setAttribute("publishable-key", stripe_buy_button_publishable_key);
    }

    if (stripeButton.parentElement !== mount) {
        mount.replaceChildren(stripeButton);
    }
    return stripeButton;
}

export async function prepareStripeBuyButton() {
    const stripeButton = ensureStripeBuyButtonElement();
    if (!stripeButton) return null;

    updateStripeConfig();

    if (!window.customElements?.get('stripe-buy-button')) {
        try {
            await loadStripeScript();
        } catch (error) {
            console.warn('Stripe buy button script could not be loaded:', error);
        }
    }

    return stripeButton;
}

function ensureStripeBuyButtonElement() {
    let stripeButton = document.getElementById("stripePayment");
    if (stripeButton) return stripeButton;

    const mount = document.getElementById("stripe-payment-button-mount");
    if (!mount) return null;

    stripeButton = document.createElement("stripe-buy-button");
    stripeButton.id = "stripePayment";
    stripeButton.setAttribute("buy-button-id", stripe_buy_button_id);
    stripeButton.setAttribute("publishable-key", stripe_buy_button_publishable_key);

    mount.replaceChildren(stripeButton);
    return stripeButton;
}

function setupStripePaymentFallback() {
    const paymentModal = document.getElementById('paymentModal');
    if (!paymentModal) return;

    paymentModal.addEventListener('shown.bs.modal', () => {
        setStripeFallbackVisible(false);
        if (stripeFallbackTimer) clearTimeout(stripeFallbackTimer);

        stripeFallbackTimer = setTimeout(() => {
            if (stripeButtonLooksBlockedOrBroken()) {
                setStripeFallbackVisible(true);
            }
        }, 5000);
    });

    paymentModal.addEventListener('hidden.bs.modal', () => {
        if (stripeFallbackTimer) clearTimeout(stripeFallbackTimer);
        setStripeFallbackVisible(false);
    });
}

function setStripeFallbackVisible(visible) {
    const fallback = document.getElementById('stripe-payment-fallback');
    if (!fallback) return;

    fallback.classList.toggle('d-none', !visible);
}

function stripeButtonLooksBlockedOrBroken() {
    const stripeButton = document.getElementById('stripePayment');
    if (!stripeButton) return false;

    const hasConfig = Boolean(
        stripeButton.getAttribute('buy-button-id') &&
        stripeButton.getAttribute('publishable-key')
    );
    if (!hasConfig) return true;

    const visibleText = (stripeButton.textContent || '').toLowerCase();
    if (visibleText.includes('something went wrong') || visibleText.includes('publishable key')) {
        return true;
    }

    const root = stripeButton.shadowRoot;
    if (root) {
        const shadowText = (root.textContent || '').toLowerCase();
        if (shadowText.includes('something went wrong') || shadowText.includes('publishable key')) {
            return true;
        }
        if (root.querySelector('iframe, button, a')) {
            return false;
        }
    }

    const stripeScriptIsPresent = Boolean(document.querySelector('script[src="https://js.stripe.com/v3/buy-button.js"]'));
    const stripeElementIsDefined = Boolean(window.customElements?.get('stripe-buy-button'));

    return !stripeScriptIsPresent || !stripeElementIsDefined;
}

/**
 * Find an agent in window.agents by a specific field value.
 * Defaults to searching by '_id' if no field is provided.
 *
 * @param {string} value - The value to search for.
 * @param {string} [field='_id'] - The property name to match against (e.g. 'advertisement_id').
 * @returns {any|null} The matching agent document, or null if not found.
 */
export function getAgentById(value, field = '_id') {
    if (!window.agents) return null;

    for (const agent of window.agents) {
        // We cast both to String to ensure robust matching (e.g. ObjectId vs string)
        if (agent && agent[field] && String(agent[field]) === String(value)) {
            return agent;
        }
    }
    return null;
}

export function checkAndDisplayEmailWarnings() {
    const globalWarning = document.getElementById('global-email-warning');
    const profileWarning = document.getElementById('missing-email-section');

    // Vi tjekker nu direkte på den friske 'currentUser' hentet fra databasen
    if (isLoggedIn() && currentUser) {
        if (!currentUser.email || currentUser.email.trim() === '') {
            // Vis den globale sticky bar
            if (globalWarning) {
                globalWarning.classList.remove('d-none');
                document.body.style.paddingTop = '124px'; // Gør plads til bjælken
            }

            // Vis lokal advarsel på profilsiden
            if (profileWarning) {
                profileWarning.classList.remove('d-none');
            }
            return;
        }
    }

    // Skjul advarsler og reset body padding, hvis bruger er logget ud eller HAR en email
    if (globalWarning) {
        globalWarning.classList.add('d-none');
    }
    if (profileWarning) {
        profileWarning.classList.add('d-none');
    }

    document.body.style.paddingTop = '66px';
}


// Eksporter denne så den kan bruges fra andre filer
export function openMissingEmailModal() {
    // 1. Prepare Modal Text
    $('#missingContactSubmit').text('Gem oplysninger');

    // 2. Pre-fill phone if available
    if (currentUser && currentUser.phone_number) {
        $('#contact-phone').val(currentUser.phone_number);
    }

    // 3. Show Modal
    const modalEl = document.getElementById('missingContactInfoModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    // 4. Handle Form Submit
    $('#contactInfoForm').off('submit').on('submit', async function(ev) {
        ev.preventDefault();

        const email = $('#contact-email').val();
        const phone = $('#contact-phone').val();

        if (!email) {
            displayErrorMessage("Email er påkrævet");
            return;
        }

        try {
            const updateRes = await authFetch('/roomies/user/contact-info', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, phone })
            });

            if (updateRes.ok) {
                modal.hide();

                // Update global currentUser
                if (currentUser) {
                    currentUser.email = email;
                    currentUser.phone_number = phone;
                }

                // FJERNER BÅDE DEN GLOBALE OG LOKALE ADVARSEL OMGÅENDE
                checkAndDisplayEmailWarnings();

                // Opdater the read-only input in the main form (kun hvis det findes i DOM'en)
                if ($('#email-profile').length) {
                    $('#email-profile').val(email);
                }

                displaySuccessMessage("Oplysninger opdateret");
            } else {
                const err = await updateRes.json();
                displayErrorMessage(err.detail || "Kunne ikke opdatere oplysninger");
            }
        } catch (err) {
            console.error(err);
            displayErrorMessage("Der opstod en fejl.");
        }
    });
}

// Den globale click-handler bruger nu bare den nye funktion
export function setupMissingEmailHandler() {
    $('#btn-add-email-profile, #btn-add-email-global').off('click').on('click', function(e) {
        e.preventDefault();
        openMissingEmailModal();
    });
}

window.sharePage = sharePage;
window.formatNumber = formatNumber;
window.hideSuccessMessage = hideSuccessMessage;
window.hideErrorMessage = hideErrorMessage;
window.favoriteHousing = favoriteHousing;
window.displayErrorMessage = displayErrorMessage;
