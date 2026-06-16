import {authFetch} from "../auth/auth.js";
import {s3Url} from "../config/config.js";
import {isLoggedIn} from "../utils.js";
import {displayLoginModal, getCurrentView, getCurrentViewParams} from "../views/viewManager.js";

// Public roomie profiles (every user), loaded lazily the first time someone opens a
// profile and cached for the session. Small dataset, so one fetch covers everyone
// the user might inspect — across the inbox and the room detail view alike.
const roomieProfileCache = new Map();
let roomieProfilesPromise = null;

function loadRoomieProfiles() {
    if (!roomieProfilesPromise) {
        roomieProfilesPromise = authFetch('/roomies/users/profile')
            .then(async (response) => {
                if (!response.ok) {
                    const error = new Error('Kunne ikke hente profiler');
                    error.code = response.status;
                    throw error;
                }
                const profiles = await response.json();
                profiles.forEach(profile => roomieProfileCache.set(profile.id, profile));
                return roomieProfileCache;
            })
            .catch((error) => {
                // Allow a later retry instead of caching the failure.
                roomieProfilesPromise = null;
                throw error;
            });
    }
    return roomieProfilesPromise;
}

/**
 * Opens the read-only public profile of a roomie. Loads the (cached) public-profile
 * dataset on first use, then renders from cache. Used from the inbox and the room
 * detail view; the modal shell (#roomieProfileModal) lives globally in index.html.
 */
export async function openRoomieProfileModal(userId) {
    const modalEl = document.getElementById('roomieProfileModal');
    if (!modalEl || !userId) return;

    const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);

    // Public profiles require an authenticated request, so prompt login rather than
    // showing a generic "couldn't load" error to logged-out users.
    if (!isLoggedIn()) {
        setRoomieProfileModalState(modalEl, 'login');
        bindRoomieProfileLogin(modalEl, modal);
        modal.show();
        return;
    }

    setRoomieProfileModalState(modalEl, 'loading');
    modal.show();

    try {
        await loadRoomieProfiles();
        renderRoomieProfileCard(modalEl, roomieProfileCache.get(userId) || null);
    } catch (error) {
        // A session that expired mid-use lands here as a 401/403 — show login too.
        if (error?.code === 401 || error?.code === 403) {
            setRoomieProfileModalState(modalEl, 'login');
            bindRoomieProfileLogin(modalEl, modal);
        } else {
            setRoomieProfileModalState(modalEl, 'error');
        }
    }
}

function setRoomieProfileModalState(modalEl, state) {
    modalEl.querySelector('[data-rp-loading]')?.classList.toggle('d-none', state !== 'loading');
    modalEl.querySelector('[data-rp-error]')?.classList.toggle('d-none', state !== 'error');
    modalEl.querySelector('[data-rp-login]')?.classList.toggle('d-none', state !== 'login');
    modalEl.querySelector('[data-rp-content]')?.classList.toggle('d-none', state !== 'content');
}

function bindRoomieProfileLogin(modalEl, modal) {
    const button = modalEl.querySelector('[data-rp-login-btn]');
    if (!button || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
        modal.hide();
        displayLoginModal(getCurrentView(), getCurrentViewParams());
    });
}

function renderRoomieProfileCard(modalEl, profile) {
    setRoomieProfileModalState(modalEl, 'content');

    // A missing cache entry still resolves to a friendly card (deleted/unknown user).
    const safeProfile = profile || {};
    const interests = Array.isArray(safeProfile.interests) ? safeProfile.interests : [];

    const avatar = modalEl.querySelector('[data-rp-avatar]');
    if (avatar) avatar.innerHTML = renderProfileAvatar(safeProfile, 'roomie-profile-avatar-img');

    // First name only — not everyone wants their full name shown publicly.
    const nameEl = modalEl.querySelector('[data-rp-name]');
    if (nameEl) nameEl.textContent = String(safeProfile.full_name || '').trim().split(/\s+/)[0] || 'Roomie';

    const occupations = Array.isArray(safeProfile.occupation)
        ? safeProfile.occupation
        : (safeProfile.occupation ? [safeProfile.occupation] : []);
    const metaParts = [
        safeProfile.age ? `${safeProfile.age} år` : null,
        occupations.length ? occupations.join(', ') : null,
        capitalizeFirst(safeProfile.gender),
    ].filter(Boolean);
    const metaEl = modalEl.querySelector('[data-rp-meta]');
    if (metaEl) metaEl.textContent = metaParts.join(' · ');

    const vibesSection = modalEl.querySelector('[data-rp-vibes-section]');
    const vibes = modalEl.querySelector('[data-rp-vibes]');
    if (vibes) {
        vibes.innerHTML = interests
            .map(tag => `<span class="roomie-profile-vibe">${escapeHtml(tag)}</span>`)
            .join('');
    }
    const hasVibes = interests.length > 0;
    vibesSection?.classList.toggle('d-none', !hasVibes);

    const descSection = modalEl.querySelector('[data-rp-desc-section]');
    const desc = modalEl.querySelector('[data-rp-desc]');
    if (desc) desc.textContent = safeProfile.description || '';
    const hasDescription = Boolean(safeProfile.description);
    descSection?.classList.toggle('d-none', !hasDescription);

    // Without vibes or a description the body would be bare, so show a warm,
    // contact-encouraging message instead of empty space. The wording adapts to
    // how much the roomie has filled in (a complete blank reads differently than
    // a half-filled profile).
    const emptyEl = modalEl.querySelector('[data-rp-empty]');
    const isSparse = !hasVibes && !hasDescription;
    emptyEl?.classList.toggle('d-none', !isSparse);
    if (emptyEl && isSparse) {
        const firstName = getFirstName(safeProfile.full_name);
        const hasIntro = Boolean(
            safeProfile.profile_photo || safeProfile.age || safeProfile.gender || occupations.length
        );
        const message = hasIntro
            ? `${firstName} har ikke skrevet så meget om sig selv endnu — skriv og sig hej 👋`
            : `${firstName} har ikke udfyldt sin profil endnu 🙈`;
        const messageEl = emptyEl.querySelector('p') || emptyEl;
        messageEl.textContent = message;
    }
}

function getFirstName(fullName) {
    const name = String(fullName || '').trim();
    if (!name) return 'Denne roomie';
    return name.split(/\s+/)[0];
}

function capitalizeFirst(value) {
    if (!value) return null;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Renders a roomie's circular avatar, falling back to an icon when they have no photo.
 */
function renderProfileAvatar(profile, baseClass) {
    const photo = profile?.profile_photo;
    if (photo) {
        return `<img src="${escapeHtml(`${s3Url}/${photo}`)}" class="${baseClass}" alt="Profilbillede" loading="lazy">`;
    }
    return `<div class="${baseClass} ${baseClass}--fallback"><i class="fa-solid fa-user"></i></div>`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
