import {authFetch} from "../auth/auth.js";
import {
    clearPostOnboardingContext,
    displayLoginModal,
    getCurrentView,
    getCurrentViewParams,
    getPostOnboardingContext,
    getPostOnboardingReturnUrl,
    rememberPostOnboardingContext,
    resetViewAfterLogin,
    showView,
    viewAfterLogin,
    viewParamsAfterLogin,
} from "../views/viewManager.js";
import {
    decodeJwt,
    displayErrorMessage,
    displaySuccessMessage,
    loadUser,
    resetCurrentUser,
    showConfirmationModal
} from "../utils.js";
import {setupProfileView} from "../profile/profile.js";
import {closeNavbarMenu, updateNavbar} from "../header/header.js";
import {google_auth_client_id, google_auth_redirect_url} from "../config/config.js";
import {
    startGlobalConversationUnreadPolling,
    stopGlobalConversationUnreadPolling
} from "../conversations/conversations.js";

function getApiErrorMessage(detail, fallbackMessage = "Der opstod en fejl. Prøv igen.") {
    if (typeof detail === "string") return detail;

    if (Array.isArray(detail)) {
        return detail
            .map(error => error?.msg || error?.message || error?.detail)
            .filter(Boolean)
            .join("\n") || fallbackMessage;
    }

    if (detail && typeof detail === "object") {
        return detail.msg || detail.message || detail.detail || fallbackMessage;
    }

    return fallbackMessage;
}

export function setupLoginView() {
    // Navbar login button
    const loginBtn = document.getElementById("login");
    if (loginBtn) {
        loginBtn.addEventListener('click', (event) => {
            displayLoginModal(null, null)
        });
    }

// --- GOOGLE AUTH LISTENERS ---
    const googleLoginWrapper = document.getElementById('googleLoginWrapper');
    const googleLoginBtn = document.getElementById('googleLoginBtn');

    if (googleLoginWrapper && googleLoginBtn) {
        // 1. Define the in-app browser check
        const isInAppBrowser = () => {
            const ua = navigator.userAgent || navigator.vendor || window.opera;
            return /FBAN|FBAV|Instagram|LinkedIn|Snapchat|TikTok/i.test(ua);
        };

        // 2. If it's a SAFE browser, reveal the button and attach the listener
        if (!isInAppBrowser()) {
            // Remove 'd-none' to show the button
            googleLoginWrapper.classList.remove('d-none');

            // The "eller" divider only makes sense when the real Google button is
            // shown — reveal it alongside the button, not for the in-app notice.
            const loginModalOr = document.getElementById('loginModalOr');
            if (loginModalOr) {
                loginModalOr.classList.remove('d-none');
            }

            // Attach the click event
            googleLoginBtn.addEventListener('click', (e) => {
                e.preventDefault();
                initiateGoogleLogin();
            });
        } else {
            // In-app browser (Facebook, Instagram, etc.): Google blocks OAuth here
            // (disallowed_useragent). Show a notice nudging the user to open the
            // site in a real browser, with a copy-link helper.
            const inAppBrowserNotice = document.getElementById('inAppBrowserNotice');
            const copyLinkBtn = document.getElementById('copyLinkBtn');

            if (inAppBrowserNotice) {
                inAppBrowserNotice.classList.remove('d-none');
            }

            if (copyLinkBtn) {
                copyLinkBtn.addEventListener('click', async () => {
                    const url = window.location.href;
                    const label = copyLinkBtn.querySelector('span');
                    const original = label ? label.textContent : '';

                    const showCopied = () => {
                        copyLinkBtn.classList.add('is-copied');
                        if (label) label.textContent = 'Link kopieret!';
                        setTimeout(() => {
                            copyLinkBtn.classList.remove('is-copied');
                            if (label) label.textContent = original;
                        }, 2000);
                    };

                    try {
                        await navigator.clipboard.writeText(url);
                        showCopied();
                    } catch (err) {
                        // Fallback for older / restricted webviews
                        const tmp = document.createElement('textarea');
                        tmp.value = url;
                        tmp.style.position = 'fixed';
                        tmp.style.opacity = '0';
                        document.body.appendChild(tmp);
                        tmp.focus();
                        tmp.select();
                        try {
                            document.execCommand('copy');
                            showCopied();
                        } catch (e2) {
                            // Last resort: surface the URL so the user can copy manually
                            window.prompt('Kopiér linket og åbn det i din browser:', url);
                        }
                        document.body.removeChild(tmp);
                    }
                });
            }
        }
    }

    // Add event listener to toggle password visibility for all password inputs
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    passwordInputs.forEach(input => {
        const toggleIcon = document.createElement('span');
        toggleIcon.classList.add('input-group-text', 'toggle-password');
        toggleIcon.innerHTML = '<i class="bi bi-eye-slash"></i>';

        // Check if parent exists to avoid errors
        if(input.parentNode) {
            input.parentNode.insertBefore(toggleIcon, input.nextSibling);
        }

        toggleIcon.addEventListener('click', function() {
            const passwordIcon = this.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                passwordIcon.classList.remove('bi-eye-slash');
                passwordIcon.classList.add('bi-eye');
            } else {
                input.type = 'password';
                passwordIcon.classList.remove('bi-eye');
                passwordIcon.classList.add('bi-eye-slash');
            }
        });
    });

    // Login Form Submit
    const loginForm = document.getElementById('modalLoginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async e => {
            e.preventDefault();
            if (!loginForm.reportValidity()) return;

            // --- UX IMPROVEMENT START ---
            const submitBtn = document.getElementById('loginModalSubmit');
            let originalBtnContent = "";
            if (submitBtn) {
                originalBtnContent = submitBtn.innerHTML;
                // Show spinner and disable button
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Sender...';
                submitBtn.disabled = true;
            }
            // --- UX IMPROVEMENT END ---

            const user_email = document.getElementById('modal-login-email').value
            const payload = { email : user_email };

            try {
                const response = await authFetch('/roomies/login/request-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const response_json = await response.json();

                if (!response.ok) {
                    displayErrorMessage(getApiErrorMessage(response_json.detail))
                    return
                }

                document.getElementById('email-sent-to').textContent = ` til ${user_email}`

                const loginModalEl = document.getElementById('loginModal');
                const loginCodeModalEl = document.getElementById('loginCodeModal');

                const loginModal = bootstrap.Modal.getInstance(loginModalEl) || new bootstrap.Modal(loginModalEl);
                const loginCodeModal = new bootstrap.Modal(loginCodeModalEl);

                loginModalEl.addEventListener('hidden.bs.modal', function onHidden() {
                    loginModalEl.removeEventListener('hidden.bs.modal', onHidden);
                    loginCodeModal.show();
                });

                loginModal.hide();

            } catch (error) {
                console.error("Login error:", error);
                displayErrorMessage("Der opstod en fejl. Prøv igen senere.");
            } finally {
                // Always reset button state (whether success or failure)
                if (submitBtn) {
                    submitBtn.innerHTML = originalBtnContent;
                    submitBtn.disabled = false;
                }
            }
        });
    }

    // OTP Code Submit
    const codeSubmitBtn = document.getElementById('loginCodeSubmit');
    if (codeSubmitBtn) {
        codeSubmitBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const form = document.getElementById('modalCodeForm');
            if (!form.reportValidity()) return;

            // --- UX IMPROVEMENT START ---
            let originalBtnContent = codeSubmitBtn.innerHTML;
            codeSubmitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Bekræfter...';
            codeSubmitBtn.disabled = true;
            // --- UX IMPROVEMENT END ---

            try {
                const login_code = document.getElementById('modal-login-code').value
                const email = document.getElementById('modal-login-email').value

                const verificationSuccessful = await performOTPVerification(login_code, email, 'loginCodeModal')
                if (!verificationSuccessful) return;

                const loginCodeModalEl = document.getElementById('loginCodeModal');
                const loginCodeModal = bootstrap.Modal.getInstance(loginCodeModalEl) || new bootstrap.Modal(loginCodeModalEl);

                // Just hide it, no need to chain anything else
                loginCodeModal.hide();
            } catch (error) {
                console.error("OTP verification error:", error);
            } finally {
                // Always reset button state
                codeSubmitBtn.innerHTML = originalBtnContent;
                codeSubmitBtn.disabled = false;
            }
        });
    }


    // Resend Code Link Logic
    const resendLink = document.getElementById('resendCodeLink');
    if (resendLink) {
        resendLink.addEventListener('click', async (e) => {
            e.preventDefault();

            // 1. Get the email that was entered in the previous step
            const emailInput = document.getElementById('modal-login-email');
            const email = emailInput ? emailInput.value : null;

            if (!email) {
                displayErrorMessage("Kunne ikke finde email. Prøv at logge ind forfra.");
                return;
            }

            // 2. UX: Visual feedback (prevent spam clicking)
            const originalText = resendLink.innerText;
            resendLink.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sender...';
            resendLink.style.pointerEvents = 'none'; // Disable clicks
            resendLink.classList.add('text-muted');

            try {
                // 3. Call the API again
                const response = await authFetch('/roomies/login/request-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email })
                });

                if (response.ok) {
                    // Success feedback
                    resendLink.innerHTML = '<i class="fa-solid fa-check me-1"></i>Sendt!';
                    displaySuccessMessage(`Ny kode sendt til ${email}`);

                    // Reset button after 30 seconds to prevent spam
                    setTimeout(() => {
                        resendLink.innerText = originalText;
                        resendLink.style.pointerEvents = 'auto';
                        resendLink.classList.remove('text-muted');
                    }, 30000);
                } else {
                    const err = await response.json();
                    displayErrorMessage(err.detail || "Kunne ikke sende koden igen.");
                    // Revert immediately on error
                    resendLink.innerText = originalText;
                    resendLink.style.pointerEvents = 'auto';
                    resendLink.classList.remove('text-muted');
                }
            } catch (error) {
                console.error("Resend error:", error);
                displayErrorMessage("Der opstod en fejl.");
                resendLink.innerText = originalText;
                resendLink.style.pointerEvents = 'auto';
                resendLink.classList.remove('text-muted');
            }
        });
    }

    // Register modal Submit
    const registerForm = document.getElementById('modalRegisterForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!registerForm.reportValidity()) return;

            const userData = {
                email : document.getElementById('modal-register-email').value,
                full_name : document.getElementById('modal-register-fullname').value,
            };

            const response = await authFetch('/roomies/user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
            const response_json = await response.json();

            if (!response.ok) {
                displayErrorMessage(getApiErrorMessage(response_json.detail))
                return
            }

            // Transition to OTP modal
            const registerModalEl = document.getElementById('registerModal');
            const logincodeModalEl = document.getElementById('loginCodeModal');
            // We need to fill the email for the OTP modal
            document.getElementById('modal-login-email').value = userData.email;
            document.getElementById('email-sent-to').textContent = ` til ${userData.email}`;

            const registerModal = bootstrap.Modal.getInstance(registerModalEl) || new bootstrap.Modal(registerModalEl);
            const loginCodeModal = new bootstrap.Modal(logincodeModalEl);

            registerModalEl.addEventListener('hidden.bs.modal', function onHidden() {
                registerModalEl.removeEventListener('hidden.bs.modal', onHidden);
                loginCodeModal.show();
            });

            registerModal.hide();
        });
    }

    // ---------------------------------------------------------
    // FIXED TRANSITIONS START HERE
    // ---------------------------------------------------------

    // 1. Login -> Register (Fixed to remove lingering listeners)
    const showRegisterLink = document.getElementById('showRegisterModalLink');
    if (showRegisterLink) {
        showRegisterLink.addEventListener('click', (e) => {
            e.preventDefault();

            const loginModalEl = document.getElementById('loginModal');
            const registerModalEl = document.getElementById('registerModal');

            const loginModal = bootstrap.Modal.getInstance(loginModalEl) || new bootstrap.Modal(loginModalEl);
            const registerModal = bootstrap.Modal.getInstance(registerModalEl) || new bootstrap.Modal(registerModalEl);

            loginModalEl.addEventListener('hidden.bs.modal', function onHidden() {
                loginModalEl.removeEventListener('hidden.bs.modal', onHidden);
                registerModal.show();
            });

            loginModal.hide();
        });
    }

    // 2. Register -> Login (Clean transition)
    const showLoginLink = document.getElementById('showLoginModalLink');
    if (showLoginLink) {
        showLoginLink.addEventListener('click', (e) => {
            e.preventDefault();

            const registerModalEl = document.getElementById('registerModal');
            const loginModalEl = document.getElementById('loginModal');

            const registerModal = bootstrap.Modal.getInstance(registerModalEl) || new bootstrap.Modal(registerModalEl);
            const loginModal = bootstrap.Modal.getInstance(loginModalEl) || new bootstrap.Modal(loginModalEl);

            registerModalEl.addEventListener('hidden.bs.modal', function onHidden() {
                registerModalEl.removeEventListener('hidden.bs.modal', onHidden);
                loginModal.show();
            });

            registerModal.hide();
        });
    }
}

// --- GOOGLE AUTH LOGIC ---
function initiateGoogleLogin() {
    const scope = encodeURIComponent('openid email profile');
    const redirect_uri = encodeURIComponent(google_auth_redirect_url);
    const client_id = encodeURIComponent(google_auth_client_id);
    const returnUrl = getPostOnboardingReturnUrl(window.location.href);
    const state = encodeURIComponent(returnUrl);

    if (!getPostOnboardingContext()) {
        // Persist the view AND its params (e.g. the room id) so we can restore the
        // exact page after the full-page Google redirect — in-memory viewAfterLogin
        // is wiped by the reload, and returnUrl alone isn't used to rebuild the view.
        rememberPostOnboardingContext({
            view: getCurrentView(),
            params: getCurrentViewParams(),
            returnUrl,
        });
    }

    // Redirect the user
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${client_id}&redirect_uri=${redirect_uri}&response_type=code&scope=${scope}&state=${state}`;
}


// Updates that are to be ran after user logged in
export async function updateAfterLogin(jwt, modalToHideID) {
    updateJWT(jwt);
    updateNavbar();

    closeNavbarMenu();

    // Error bounds to ensure login flow completes
    try {
        await loadUser();
        startGlobalConversationUnreadPolling();
    } catch (e) { console.error("Could not load user", e); }

    try {
        setupProfileView();
    } catch (e) { console.error("Could not setup profile", e); }

    if (modalToHideID != null) {
        const modalEl = document.getElementById(modalToHideID);
        if(modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if(modal) modal.hide();
        }
    }

    const redirectUrl = localStorage.getItem('postLoginRedirect');
    if (redirectUrl) {
        localStorage.removeItem('postLoginRedirect');
        window.location.href = redirectUrl;
        return;
    }

    const onboardingContext = getPostOnboardingContext();
    if (onboardingContext?.view) {
        await showView(onboardingContext.view, new URLSearchParams(onboardingContext.params || ''));
        clearPostOnboardingContext();
        resetViewAfterLogin();
        return;
    }

    if (viewAfterLogin === null) {
        // No explicit post-login destination (e.g. generic navbar login). Re-show the
        // current view so its logged-in load logic runs (e.g. the udlej-værelse form
        // populates from the user's existing listings) without a full page refresh.
        await showView(getCurrentView(), getCurrentViewParams(), false);
        return;
    }

    await showView(viewAfterLogin, viewParamsAfterLogin);
    resetViewAfterLogin();
}

export function updateJWT(jwt) {
    localStorage.setItem('jwt', jwt);
    updateStripePaymentElements();
}

export function updateStripePaymentElements() {
    const decodedJwt = decodeJwt();
    if (decodedJwt) {
        const stripeBtn = document.getElementById('stripePayment');
        if(stripeBtn) {
            const returnUrl = getPostOnboardingReturnUrl(window.location.href);
            setStripeAttributeIfChanged(stripeBtn, 'client-reference-id', decodedJwt.sub);
            setStripeAttributeIfChanged(stripeBtn, 'success-url', returnUrl);
            setStripeAttributeIfChanged(stripeBtn, 'cancel-url', returnUrl);
        }
    }
}

function setStripeAttributeIfChanged(element, name, value) {
    if (element.getAttribute(name) !== value) {
        element.setAttribute(name, value);
    }
}


export async function handleOTPLink(){
    const params = new URLSearchParams(window.location.search);
    const login_code = params.get("otp");
    const email = params.get("email");
    const legacyId = params.get("id");
    const messageId = params.get("besked_id");

    if (!login_code) {
        return false;
    }

    rememberRoomRedirectFromOTPParams(params, email);

    const legacyIdIsLoginIdentity = !email && Boolean(legacyId);
    const verificationSuccessful = await performOTPVerification(login_code, email, null, legacyIdIsLoginIdentity ? legacyId : null);

    if (verificationSuccessful) {
        removeOTPParamsFromURL(legacyIdIsLoginIdentity && Boolean(messageId));
    }

    return verificationSuccessful;
}

function rememberRoomRedirectFromOTPParams(params, email) {
    const roomId = getRoomIdFromOTPParams(params, email);
    if (!roomId) return;

    const roomParams = new URLSearchParams({id: roomId});
    localStorage.removeItem('postLoginRedirect');
    rememberPostOnboardingContext({
        view: 'room_detail',
        params: roomParams,
        returnUrl: `/vaerelse?${roomParams.toString()}`
    });
}

function getRoomIdFromOTPParams(params, email) {
    const explicitRoomId = params.get("room_id") || params.get("roomId") || params.get("room");
    if (explicitRoomId) return explicitRoomId;

    const id = params.get("id");
    if (!id) return null;

    const view = params.get("view");
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";

    if (view === "room_detail" || view === "vaerelse" || pathname === "/vaerelse") {
        return id;
    }

    if (email && !view) {
        return id;
    }

    return null;
}

function removeOTPParamsFromURL(removeLegacyId = false) {
    const url = new URL(window.location.href);
    url.searchParams.delete("otp");
    url.searchParams.delete("email");

    if (removeLegacyId) {
        url.searchParams.delete("id");
    }

    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function performOTPVerification(login_code, email, modalToCloseID, id = null) {

    const requestBody = {
        login_code: login_code
    };

    // Dynamically attach either email or id
    if (email) {
        requestBody.email = email;
    } else if (id) {
        requestBody.id = id;
    }

    const response = await authFetch('/roomies/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    if (!response.ok) {
        displayErrorMessage("Vi kunne desværre ikke logge dig ind, prøv igen");
        return false;
    }

    await updateAfterLogin(result.jwt, modalToCloseID);
    displaySuccessMessage("Du er nu logget ind");
    return true;
}


export async function extractURLJWT() {
    const params = new URLSearchParams(window.location.search);
    let jwt = params.get('jwt');

    // Your backend returns 'token' instead of 'jwt' for Google Auth
    if (!jwt) {
        jwt = params.get('token');
    }

    if (jwt) {
        localStorage.setItem('jwt', jwt);

        // Remove token from URL for cleaner UI
        params.delete('jwt');
        params.delete('token');
        const cleanQuery = params.toString();
        const newUrl = `${window.location.origin}${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`;
        window.history.replaceState(null, '', newUrl);

        await updateAfterLogin(jwt)
        displaySuccessMessage("Du er nu logget ind")
        return true;
    }

    return false;
}


export function setupLogoutView() {
    document.getElementById("logout").addEventListener('click', (event) => {
        event.preventDefault();

        showConfirmationModal(
            "Log ud",
            "Er du sikker på, at du vil logge ud?",
            () => {
                // Clear JWT from localStorage
                localStorage.removeItem('jwt');
                resetCurrentUser();
                stopGlobalConversationUnreadPolling();

                // Clean the users information from the website
                // We add simple checks to ensure elements exist before accessing properties
                const nameInput = document.getElementById('fullName-profile');
                if (nameInput) nameInput.value = '';
                const emailInput = document.getElementById('email-profile');
                if (emailInput) emailInput.value = '';

                updateNavbar();
            },
            "btn-primary" // Use primary color (Blue) since this isn't a destructive action like delete
        );
    });
}
