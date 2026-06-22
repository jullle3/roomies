import {authFetch} from "../auth/auth.js";
import {s3Url} from "../config/config.js";
import {displayErrorMessage, displaySuccessMessage, decodeJwt, currentUser, setCurrentUser} from "../utils.js";
import {showView} from "../views/viewManager.js";
import {getCachedMyRooms, preloadMyRooms} from "../rooms/room_cache.js";
import {cropAvatarFile, isAvatarCropperAvailable} from "../components/avatar_cropper.js";
import {areaAutocompleteOptions} from "../config/hardcoded_data.js";

// Generous ceiling so large phone photos go through — the server compresses anyway.
const PROFILE_MAX_PHOTO_SIZE_BYTES = 12 * 1024 * 1024;
const PROFILE_AREA_SUGGESTION_LIMIT = 4;
const PROFILE_AREA_LOOKUP = new Map(areaAutocompleteOptions.map(area => [String(area.id), area]));
let profilePhotoName = null;
let pendingProfilePhotoFile = null;
let currentRoomieProfileSnapshot = {};
let selectedProfileAreas = [];

// Tracks whether the roomie-profile form has edits the user hasn't saved yet, so
// navigation can warn before leaving. The photo is excluded because it uploads
// immediately on selection (see handleProfilePhotoSelected).
let humanProfileDirty = false;

export function isHumanProfileFormDirty() {
    return humanProfileDirty === true;
}

function markHumanProfileDirty(event) {
    // The photo input auto-saves, so its changes don't count as unsaved edits.
    if (event && event.target && event.target.id === 'profile-photo-input') return;
    humanProfileDirty = true;
}

export function setupProfileView() {
    setupProfileSettingsHandlers();
    setupConversationsShortcut();
    setupHumanProfileHandlers();
}

export async function loadProfileView() {
    const userId = populateProfileView();

    if (userId) {
        if (currentUser && currentUser._id === userId) {
            updateProfileUI(currentUser);
        } else {
            try {
                const response = await authFetch(`/roomies/user/${userId}`);
                if (response.ok) {
                    const userProfile = await response.json();
                    updateProfileUI(userProfile);
                }
            } catch (err) {
                console.warn("Could not fetch fresh profile data. Relying on JWT.", err);
            }
        }

        await renderProfileRoomListings(userId);
    }
}

async function renderProfileRoomListings(userId) {
    const listingBtn = document.getElementById('btn-my-listing');
    if (!listingBtn) return;

    const rooms = await getProfileRooms(userId);
    if (!rooms.length) {
        listingBtn.classList.add('d-none');
        document.getElementById('profile-room-list')?.remove();
        return;
    }

    const listingSubtitle = document.getElementById('btn-my-listing-subtitle');
    if (listingSubtitle) {
        listingSubtitle.textContent = rooms.length === 1
            ? "Se og administrer din værelsesannonce"
            : `Se og administrer dine ${rooms.length} værelsesannoncer`;
    }

    listingBtn.classList.remove('d-none');
    replaceElementWithClone(listingBtn).addEventListener('click', event => {
        event.preventDefault();
        showView('room_detail', new URLSearchParams({id: getRoomId(rooms[0])}));
    });

    let list = document.getElementById('profile-room-list');
    if (!list) {
        list = document.createElement('div');
        list.id = 'profile-room-list';
        list.className = 'profile-room-list';
        document.getElementById('btn-my-listing')?.insertAdjacentElement('afterend', list);
    }

    list.innerHTML = rooms.map(renderProfileRoomCard).join('');
    list.onclick = event => {
        const viewButton = event.target.closest('[data-profile-room-view]');
        if (!viewButton) return;

        event.preventDefault();
        showView('room_detail', new URLSearchParams({id: viewButton.dataset.profileRoomView}));
    };
}

async function getProfileRooms(userId) {
    await preloadMyRooms();
    const rooms = getCachedMyRooms();
    return Array.isArray(rooms)
        ? rooms
            .filter(room => String(room?.created_by || '') === String(userId))
            .filter(room => room?.deleted !== true)
            .sort((a, b) => Number(a?.created || 0) - Number(b?.created || 0))
        : [];
}

function renderProfileRoomCard(room) {
    const roomId = getRoomId(room);
    const {status, statusClass} = getProfileRoomStatus(room);
    const address = [room.street_name, room.house_number, room.postal_name].filter(Boolean).join(", ");

    return `
        <button type="button" class="profile-room-card" data-profile-room-view="${escapeAttribute(roomId)}">
            <span class="profile-room-status ${statusClass}">${status}</span>
            <strong>${escapeHtml(room.title || "Værelse uden titel")}</strong>
            <small>${escapeHtml(address || "Adresse ikke angivet")}</small>
        </button>
    `;
}

function getProfileRoomStatus(room) {
    if (room.visible === false) {
        return {status: "På pause", statusClass: "is-paused"};
    }

    if (room.available === false) {
        return {status: "Udlejet", statusClass: "is-rented"};
    }

    return {status: "Aktiv", statusClass: "is-active"};
}

function replaceElementWithClone(element) {
    const clone = element.cloneNode(true);
    element.parentNode.replaceChild(clone, element);
    return clone;
}

function getRoomId(room) {
    return String(room?._id || room?.id || "");
}

function setupProfileSettingsHandlers() {
    $('.profile-patch-operation').off('change').on('change', async function () {
        const settingName = this.id;
        const settingValue = $(this).is(':checked');

        const response = await authFetch('/roomies/user', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({[settingName]: settingValue})
        })

        if (!response.ok) {
            displayErrorMessage("Kunne ikke opdatere indstillingen.");
            $(this).prop('checked', !settingValue);
            return;
        }
    })
}

function setupConversationsShortcut() {
    const conversationsBtn = document.getElementById('btn-my-conversations');
    if (conversationsBtn) {
        const newBtn = conversationsBtn.cloneNode(true);
        conversationsBtn.parentNode.replaceChild(newBtn, conversationsBtn);

        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showView('conversations');
        });
    }
}

function setupHumanProfileHandlers() {
    const form = document.getElementById('profileHumanForm');
    if (!form || form.dataset.bound === '1') return;

    form.dataset.bound = '1';

    const photoInput = document.getElementById('profile-photo-input');
    if (photoInput) {
        photoInput.addEventListener('change', handleProfilePhotoSelected);

        // Let users open the file picker by clicking their profile picture
        [
            document.getElementById('profile-photo-preview'),
            document.getElementById('profile-photo-placeholder')
        ].forEach(element => {
            if (!element) return;
            element.style.cursor = 'pointer';
            element.addEventListener('click', () => photoInput.click());
        });
    }

    const description = document.getElementById('profile-description');
    if (description) {
        description.addEventListener('input', updateDescriptionCount);
        description.addEventListener('input', refreshProfileSubmitState);
        updateDescriptionCount();
    }

    form.querySelectorAll('input[name="occupation"]').forEach(input => {
        input.addEventListener('change', updateOccupationLabel);
    });

    // Required fields gate the submit button live, so re-check on every edit.
    document.getElementById('profile-age')?.addEventListener('input', refreshProfileSubmitState);
    document.getElementById('profile-monthly-price-max')?.addEventListener('input', refreshProfileSubmitState);
    form.querySelectorAll('input[name="gender"]').forEach(input => {
        input.addEventListener('change', refreshProfileSubmitState);
    });

    bindProfileIntentControls();
    bindProfileAreaPicker();

    // Mark the form dirty on any user edit so we can warn before leaving unsaved.
    form.addEventListener('input', markHumanProfileDirty);
    form.addEventListener('change', markHumanProfileDirty);

    form.addEventListener('submit', handleHumanProfileSubmit);
}

function bindProfileIntentControls() {
    const seekingInput = document.getElementById('profile-seeking-room');
    const rentingInput = document.getElementById('profile-renting-room');

    // The two roles are mutually exclusive — ticking one clears the other. Both
    // staying unchecked is valid (user wants to stay anonymous).
    seekingInput?.addEventListener('change', () => {
        if (seekingInput.checked && rentingInput) rentingInput.checked = false;
        updateProfileSeekerFieldsVisibility();
        refreshProfileSubmitState();
    });
    rentingInput?.addEventListener('change', () => {
        if (rentingInput.checked && seekingInput) seekingInput.checked = false;
        updateProfileSeekerFieldsVisibility();
        refreshProfileSubmitState();
    });
    updateProfileSeekerFieldsVisibility();
}

function updateProfileSeekerFieldsVisibility() {
    const seekingInput = document.getElementById('profile-seeking-room');
    const fields = document.getElementById('profile-seeker-fields');
    fields?.classList.toggle('d-none', !seekingInput?.checked);
}

function bindProfileAreaPicker() {
    const input = document.getElementById('profile-area-search');
    const suggestions = document.getElementById('profile-area-suggestions');
    if (!input || !suggestions || input.dataset.bound === '1') return;

    input.dataset.bound = '1';

    input.addEventListener('input', () => renderProfileAreaSuggestions(input.value));
    input.addEventListener('focus', () => renderProfileAreaSuggestions(input.value));
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const firstOption = suggestions.querySelector('[data-profile-area-option]');
        if (!firstOption) return;

        event.preventDefault();
        addProfileArea(firstOption.dataset.profileAreaOption);
    });

    suggestions.addEventListener('mousedown', event => {
        const option = event.target.closest('[data-profile-area-option]');
        if (!option) return;

        event.preventDefault();
        addProfileArea(option.dataset.profileAreaOption);
    });

    document.addEventListener('click', event => {
        if (event.target === input || suggestions.contains(event.target)) return;
        // Keep the default area hints visible rather than clearing the list.
        renderProfileAreaSuggestions('');
    });

    document.getElementById('profile-selected-areas')?.addEventListener('click', event => {
        const remove = event.target.closest('[data-profile-area-remove]');
        if (!remove) return;

        selectedProfileAreas = selectedProfileAreas.filter(id => id !== remove.dataset.profileAreaRemove);
        renderSelectedProfileAreas();
        renderProfileAreaSuggestions(input.value);
        refreshProfileSubmitState();
        markHumanProfileDirty();
    });
}

function renderProfileAreaSuggestions(query = '') {
    const container = document.getElementById('profile-area-suggestions');
    if (!container) return;

    const normalizedQuery = normalizeText(query);
    const suggestions = areaAutocompleteOptions
        .filter(area => !selectedProfileAreas.includes(String(area.id)))
        .filter(area => !normalizedQuery || area.searchText.includes(normalizedQuery))
        .slice(0, PROFILE_AREA_SUGGESTION_LIMIT);

    container.innerHTML = suggestions.map(area => `
        <button type="button" data-profile-area-option="${escapeAttribute(area.id)}">
            <i class="${escapeAttribute(area.icon || 'fa-solid fa-location-dot')}"></i>
            <span>${escapeHtml(area.label)}</span>
        </button>
    `).join('');
}

function renderSelectedProfileAreas() {
    const container = document.getElementById('profile-selected-areas');
    if (!container) return;

    container.innerHTML = selectedProfileAreas.map(id => `
        <span class="profile-area-pill">
            ${escapeHtml(formatAreaLabel(id))}
            <button type="button" data-profile-area-remove="${escapeAttribute(id)}" aria-label="Fjern ${escapeAttribute(formatAreaLabel(id))}">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </span>
    `).join('');
}

function addProfileArea(areaId) {
    const id = String(areaId || '');
    if (!PROFILE_AREA_LOOKUP.has(id) || selectedProfileAreas.includes(id)) return;

    selectedProfileAreas.push(id);
    const input = document.getElementById('profile-area-search');
    if (input) input.value = '';
    renderSelectedProfileAreas();
    renderProfileAreaSuggestions('');
    refreshProfileSubmitState();
    markHumanProfileDirty();
}

function handleHumanProfileSubmit(event) {
    event.preventDefault();
    submitHumanProfile();
}

// Saves the roomie-profile form. Returns true on success (and clears the dirty
// flag) or false when validation or the request fails. Exported so the leave
// guard can offer a "Gem og forlad" action.
export async function submitHumanProfile() {
    const validationError = getProfileValidationError();
    if (validationError) {
        displayErrorMessage(validationError);
        return false;
    }

    const form = document.getElementById('profileHumanForm');
    const submitButton = form?.querySelector('[type="submit"]');

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.dataset.originalText = submitButton.innerHTML;
        submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Gemmer...';
    }

    try {
        await uploadPendingProfilePhoto();
        const payload = getHumanProfilePayload();

        const response = await authFetch('/roomies/user', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({roomie_profile: payload})
        });

        if (!response.ok) {
            throw new Error('Kunne ikke gemme din roomie-profil.');
        }

        const updatedUser = await response.json();
        setCurrentUser(updatedUser);
        currentRoomieProfileSnapshot = getRoomieProfile(updatedUser);
        humanProfileDirty = false;
        displaySuccessMessage('Din roomie-profil er gemt.');
        return true;
    } catch (error) {
        console.error('Could not save human profile:', error);
        displayErrorMessage(error.message || 'Kunne ikke gemme din roomie-profil.');
        return false;
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = submitButton.dataset.originalText || 'Gem roomie-profil';
        }
    }
}

// Full roomie-profile validation. Age, gender, an "om mig" description and an
// explicit intent (søger værelse / mangler en roomie) are always required; budget
// + desired areas are additionally required when seeking.
// Returns the first error string found, or null when everything checks out.
function getProfileValidationError() {
    const age = parseInteger(document.getElementById('profile-age')?.value);
    if (!age || age <= 0) {
        document.getElementById('profile-age')?.focus();
        return 'Angiv din alder.';
    }
    if (!document.querySelector('#profileHumanForm input[name="gender"]:checked')) {
        return 'Vælg dit køn.';
    }
    if (!document.getElementById('profile-description')?.value.trim()) {
        document.getElementById('profile-description')?.focus();
        return 'Skriv lidt om dig selv som roomie.';
    }
    const seeking = document.getElementById('profile-seeking-room')?.checked;
    const renting = document.getElementById('profile-renting-room')?.checked;
    if (!seeking && !renting) {
        return 'Vælg om du søger værelse eller mangler en roomie.';
    }
    return getProfileSeekerValidationError();
}

// When the user is seeking a room, budget + at least one desired area are required
// so people with rooms can actually match them. Returns an error string or null.
function getProfileSeekerValidationError() {
    if (!document.getElementById('profile-seeking-room')?.checked) return null;

    const priceMax = parseInteger(document.getElementById('profile-monthly-price-max')?.value);
    if (!priceMax || priceMax <= 0) {
        document.getElementById('profile-monthly-price-max')?.focus();
        return 'Angiv din maks husleje pr. måned, når du søger værelse.';
    }
    if (!selectedProfileAreas.length) {
        document.getElementById('profile-area-search')?.focus();
        return 'Vælg mindst ét ønsket område, når du søger værelse.';
    }
    return null;
}

function getHumanProfilePayload() {
    const form = document.getElementById('profileHumanForm');
    const selectedGender = form.querySelector('input[name="gender"]:checked');
    const selectedInterests = [...form.querySelectorAll('input[name="interests"]:checked')].map(input => input.value);
    const selectedOccupations = [...form.querySelectorAll('input[name="occupation"]:checked')].map(input => input.value);
    const ageValue = parseInteger(document.getElementById('profile-age')?.value);
    const seekingRoom = document.getElementById('profile-seeking-room')?.checked || false;
    const rentingRoom = document.getElementById('profile-renting-room')?.checked || false;

    return {
        ...currentRoomieProfileSnapshot,
        profile_photo: profilePhotoName || null,
        age: ageValue,
        gender: selectedGender?.value || null,
        occupation: selectedOccupations,
        interests: selectedInterests,
        description: getTrimmedValue('profile-description') || null,
        seeking_room: seekingRoom,
        renting_room: rentingRoom,
        monthly_price_max: parseInteger(document.getElementById('profile-monthly-price-max')?.value),
        areas: selectedProfileAreas.length ? selectedProfileAreas.map(Number).filter(Number.isFinite) : null
    };
}

function getTrimmedValue(id) {
    return String(document.getElementById(id)?.value || '').trim();
}

function parseInteger(value) {
    const parsed = Number.parseInt(String(value || '').replace(/\./g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

// Reflects the selected occupations in the dropdown's toggle button, falling back
// to the muted placeholder when nothing is chosen.
function updateOccupationLabel() {
    const form = document.getElementById('profileHumanForm');
    const label = form?.querySelector('[data-occupation-label]');
    if (!label) return;

    const selected = [...form.querySelectorAll('input[name="occupation"]:checked')].map(input => input.value);
    label.textContent = selected.length ? selected.join(', ') : 'Vælg beskæftigelse';
    label.classList.toggle('is-placeholder', selected.length === 0);
}

function normalizeStringList(value) {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
}

async function handleProfilePhotoSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        displayErrorMessage('Vælg et billede i PNG, JPG eller WebP.');
        event.target.value = '';
        return;
    }

    if (file.size > PROFILE_MAX_PHOTO_SIZE_BYTES) {
        displayErrorMessage('Profilbilledet må højst være 12 MB.');
        event.target.value = '';
        return;
    }

    // Let the user crop/zoom so their face is in focus. When the library isn't
    // available we upload the original; an explicit cancel aborts the change.
    let finalFile = file;
    if (isAvatarCropperAvailable()) {
        const cropped = await cropAvatarFile(file);
        if (!cropped) {
            event.target.value = '';
            return;
        }
        finalFile = cropped;
    }

    const previousPhotoName = profilePhotoName;
    pendingProfilePhotoFile = finalFile;

    // Show an instant local preview while the upload runs
    const reader = new FileReader();
    reader.onload = () => {
        updateProfilePhotoPreview(String(reader.result || ''));
    };
    reader.readAsDataURL(finalFile);

    // Persist immediately so the photo is saved without needing the "Gem" button
    try {
        await uploadPendingProfilePhoto();
        displaySuccessMessage('Profilbilledet er gemt.');
    } catch (error) {
        console.error('Could not upload profile photo:', error);
        displayErrorMessage(error.message || 'Kunne ikke uploade profilbilledet.');
        pendingProfilePhotoFile = null;
        event.target.value = '';
        updateProfilePhotoPreview(buildProfilePhotoUrl(previousPhotoName));
    }
}

async function uploadPendingProfilePhoto() {
    if (!pendingProfilePhotoFile) return profilePhotoName;

    const formData = new FormData();
    formData.append('file', pendingProfilePhotoFile);

    const response = await authFetch('/roomies/user/profile-photo', {
        method: 'POST',
        body: formData
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.detail || body.message || 'Kunne ikke uploade profilbilledet.');
    }

    profilePhotoName = body.profile_photo || body.name || null;
    pendingProfilePhotoFile = null;
    updateProfilePhotoPreview(buildProfilePhotoUrl(profilePhotoName));

    if (currentUser && profilePhotoName) {
        currentUser.roomie_profile = {
            ...(currentUser.roomie_profile || {}),
            profile_photo: profilePhotoName
        };
    }

    const photoInput = document.getElementById('profile-photo-input');
    if (photoInput) photoInput.value = '';

    return profilePhotoName;
}

function updateProfilePhotoPreview(src) {
    const preview = document.getElementById('profile-photo-preview');
    const placeholder = document.getElementById('profile-photo-placeholder');
    if (!preview || !placeholder) return;

    if (src) {
        preview.src = src;
        preview.classList.remove('d-none');
        placeholder.classList.add('d-none');
    } else {
        preview.removeAttribute('src');
        preview.classList.add('d-none');
        placeholder.classList.remove('d-none');
    }
}

function buildProfilePhotoUrl(imageName) {
    if (!imageName) return null;

    const value = String(imageName);
    if (/^(https?:|data:|blob:)/i.test(value)) return value;

    return `${s3Url}/${value.replace(/^\/+/, '')}`;
}

function updateDescriptionCount() {
    const description = document.getElementById('profile-description');
    const counter = document.getElementById('profile-description-count');
    if (description && counter) {
        counter.textContent = String(description.value.length);
    }
}

// Helper function to update the inputs
function updateProfileUI(userProfile) {
    document.getElementById('fullName-profile').value = userProfile.full_name;
    document.getElementById('email-profile').value = userProfile.email;
    populateHumanProfileForm(userProfile);

    const emailToggle = document.getElementById('email_notifications');
    if (emailToggle) {
        emailToggle.checked = userProfile.email_notifications;
    }

}

function populateHumanProfileForm(userProfile = {}) {
    const roomieProfile = getRoomieProfile(userProfile);
    currentRoomieProfileSnapshot = {...roomieProfile};

    profilePhotoName = roomieProfile.profile_photo || null;
    pendingProfilePhotoFile = null;
    updateProfilePhotoPreview(buildProfilePhotoUrl(profilePhotoName));

    setInputValue('profile-age', roomieProfile.age);
    setInputValue('profile-description', roomieProfile.description);
    setInputValue('profile-monthly-price-max', roomieProfile.monthly_price_max);

    setCheckboxValue('profile-seeking-room', roomieProfile.seeking_room === true);
    setCheckboxValue('profile-renting-room', roomieProfile.renting_room === true);

    selectedProfileAreas = normalizeAreaIds(roomieProfile.areas);
    renderSelectedProfileAreas();
    renderProfileAreaSuggestions('');
    updateProfileSeekerFieldsVisibility();

    const form = document.getElementById('profileHumanForm');

    form?.querySelectorAll('input[name="gender"]').forEach(input => {
        input.checked = input.value === roomieProfile.gender;
    });

    // occupation is a list of strings; tolerate the legacy single-string form too.
    const occupations = normalizeStringList(roomieProfile.occupation);
    form?.querySelectorAll('input[name="occupation"]').forEach(input => {
        input.checked = occupations.includes(input.value);
    });
    updateOccupationLabel();

    const interests = Array.isArray(roomieProfile.interests) ? roomieProfile.interests : [];
    form?.querySelectorAll('input[name="interests"]').forEach(input => {
        input.checked = interests.includes(input.value);
    });

    updateDescriptionCount();
    refreshProfileSubmitState();

    // Freshly loaded data is the saved baseline — no unsaved edits yet.
    humanProfileDirty = false;
}

// Greys out the "Gem roomie-profil" button until every required field is valid,
// mirroring the live feedback in the onboarding popup.
function refreshProfileSubmitState() {
    const submitButton = document.querySelector('#profileHumanForm [type="submit"]');
    if (submitButton) submitButton.disabled = Boolean(getProfileValidationError());
}

function getRoomieProfile(userProfile = {}) {
    return userProfile.roomie_profile && typeof userProfile.roomie_profile === 'object'
        ? userProfile.roomie_profile
        : {};
}

function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value ?? '';
}

function getFirstName(fullName) {
    return String(fullName || '').trim().split(/\s+/)[0] || '';
}

function setCheckboxValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.checked = Boolean(value);
}

function normalizeAreaIds(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(id => String(id))
        .filter(id => PROFILE_AREA_LOOKUP.has(id));
}

function formatAreaLabel(areaId) {
    return PROFILE_AREA_LOOKUP.get(String(areaId))?.label || String(areaId);
}

function normalizeText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
}


export function populateProfileView(){
    const payloadObj = decodeJwt();
    let userId = null;

    if (payloadObj) {
        const navName = document.getElementById('navbar-name-text');
        if (navName) navName.textContent = getFirstName(payloadObj.full_name) || 'Min profil';

        document.getElementById('fullName-profile').value = payloadObj.full_name;
        document.getElementById('email-profile').value = payloadObj.email;
        populateHumanProfileForm(payloadObj);

        const emailToggle = document.getElementById('email_notifications');
        if (emailToggle) {
            emailToggle.checked = !!payloadObj.email_notifications;
        }

        userId = payloadObj.sub;
    }
    return userId
}
