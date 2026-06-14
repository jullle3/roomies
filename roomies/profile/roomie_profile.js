import {authFetch} from "../auth/auth.js";
import {s3Url} from "../config/config.js";

// Public roomie profiles (every user), loaded lazily the first time someone opens a
// profile and cached for the session. Small dataset, so one fetch covers everyone
// the user might inspect — across the inbox and the room detail view alike.
const roomieProfileCache = new Map();
let roomieProfilesPromise = null;

function loadRoomieProfiles() {
    if (!roomieProfilesPromise) {
        roomieProfilesPromise = authFetch('/roomies/users/profile')
            .then(async (response) => {
                if (!response.ok) throw new Error('Kunne ikke hente profiler');
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
    setRoomieProfileModalState(modalEl, 'loading');
    modal.show();

    try {
        await loadRoomieProfiles();
        renderRoomieProfileCard(modalEl, roomieProfileCache.get(userId) || null);
    } catch (error) {
        setRoomieProfileModalState(modalEl, 'error');
    }
}

function setRoomieProfileModalState(modalEl, state) {
    modalEl.querySelector('[data-rp-loading]')?.classList.toggle('d-none', state !== 'loading');
    modalEl.querySelector('[data-rp-error]')?.classList.toggle('d-none', state !== 'error');
    modalEl.querySelector('[data-rp-content]')?.classList.toggle('d-none', state !== 'content');
}

function renderRoomieProfileCard(modalEl, profile) {
    setRoomieProfileModalState(modalEl, 'content');

    // A missing cache entry still resolves to a friendly card (deleted/unknown user).
    const safeProfile = profile || {};
    const interests = Array.isArray(safeProfile.interests) ? safeProfile.interests : [];

    const avatar = modalEl.querySelector('[data-rp-avatar]');
    if (avatar) avatar.innerHTML = renderProfileAvatar(safeProfile, 'roomie-profile-avatar-img');

    const nameEl = modalEl.querySelector('[data-rp-name]');
    if (nameEl) nameEl.textContent = safeProfile.full_name || 'Roomie';

    const metaParts = [
        safeProfile.age ? `${safeProfile.age} år` : null,
        safeProfile.occupation || null,
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
    vibesSection?.classList.toggle('d-none', interests.length === 0);

    const descSection = modalEl.querySelector('[data-rp-desc-section]');
    const desc = modalEl.querySelector('[data-rp-desc]');
    if (desc) desc.textContent = safeProfile.description || '';
    descSection?.classList.toggle('d-none', !safeProfile.description);

    const hasAnyDetails = Boolean(
        safeProfile.profile_photo || safeProfile.age || safeProfile.occupation
        || safeProfile.gender || interests.length || safeProfile.description
    );
    modalEl.querySelector('[data-rp-empty]')?.classList.toggle('d-none', hasAnyDetails);
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
