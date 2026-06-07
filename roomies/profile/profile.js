import {authFetch} from "../auth/auth.js";
import {areaAutocompleteOptions} from "../config/hardcoded_data.js";
import {s3Url} from "../config/config.js";
import {displayErrorMessage, displaySuccessMessage, decodeJwt, currentUser, getHousingById, setCurrentUser} from "../utils.js";
import {showView} from "../views/viewManager.js";
import {invalidateSearchAgentCache} from "../roomie_agent/roomie_agent.js";

const PROFILE_MAX_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;
const PROFILE_INTEREST_LIMIT = 5;
const PROFILE_MAX_AREA_SUGGESTIONS = 4;
const PROFILE_AREA_LOOKUP = new Map(areaAutocompleteOptions.map(area => [String(area.id), area]));
const AGENTS_API_BASE = "/roomies/agents";
let profilePhotoName = null;
let pendingProfilePhotoFile = null;
let selectedProfileAreas = [];

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

        // 2b. Find user's own listing from the global housing cache (loaded on startup)
        try {
            const listing = await getHousingById(userId, 'created_by');
            if (listing && listing._id) {
                const listingBtn = document.getElementById('btn-my-listing');
                const listingSubtitle = document.getElementById('btn-my-listing-subtitle');
                if (listingBtn) {
                    if (listingSubtitle && listing.address) {
                        listingSubtitle.textContent = listing.address;
                    }
                    listingBtn.classList.remove('d-none');

                    const newListingBtn = listingBtn.cloneNode(true);
                    listingBtn.parentNode.replaceChild(newListingBtn, listingBtn);

                    newListingBtn.addEventListener('click', (e) => {
                        e.preventDefault();
//                        showView('detail', new URLSearchParams({ id: listing._id }));
                        showView('create');
                        window.scrollTo(0, 0);
                    });
                }
            }
        } catch (err) {
            console.warn("Could not find user listing in housing cache.", err);
        }
    }
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
    }

    const description = document.getElementById('profile-description');
    if (description) {
        description.addEventListener('input', updateDescriptionCount);
        updateDescriptionCount();
    }

    form.querySelectorAll('input[name="interests"]').forEach(input => {
        input.addEventListener('change', () => enforceInterestLimit(input));
    });

    const areaSearch = document.getElementById('profile-area-search');
    if (areaSearch) {
        areaSearch.addEventListener('input', () => renderProfileAreaSuggestions(areaSearch.value));
        areaSearch.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();

            const firstOption = document.querySelector('[data-profile-area-option]');
            if (firstOption) addSelectedProfileArea(firstOption.dataset.profileAreaOption);
        });
    }

    form.addEventListener('click', event => {
        const createAgentButton = event.target.closest('#profile-create-agent');
        if (createAgentButton) {
            event.preventDefault();
            handleCreateAgentFromProfile(createAgentButton);
            return;
        }

        const areaOption = event.target.closest('[data-profile-area-option]');
        if (areaOption) {
            event.preventDefault();
            addSelectedProfileArea(areaOption.dataset.profileAreaOption);
            return;
        }

        const removeArea = event.target.closest('[data-profile-area-remove]');
        if (removeArea) {
            event.preventDefault();
            selectedProfileAreas = selectedProfileAreas.filter(id => id !== removeArea.dataset.profileAreaRemove);
            renderProfileSelectedAreas();
            updateProfileAreaInputValue();
        }
    });

    form.addEventListener('submit', handleHumanProfileSubmit);
}

async function handleCreateAgentFromProfile(button) {
    const profilePayload = getHumanProfilePayload();

    if (profilePayload.monthly_price_max == null || profilePayload.monthly_price_max <= 0) {
        displayErrorMessage("Indtast dit maks budget, før du opretter en SøgeAgent.");
        document.getElementById('profile-budget')?.focus();
        return;
    }

    const payload = {
        name: "Min roomie-profil",
        criteria: {
            monthly_price_max: profilePayload.monthly_price_max,
            areas: profilePayload.areas,
            text: "Fra min roomie-profil"
        }
    };

    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Opretter...';

    try {
        const response = await authFetch(AGENTS_API_BASE, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(await getProfileAgentErrorMessage(response));
        }

        invalidateSearchAgentCache();
        displaySuccessMessage("Din SøgeAgenter oprettet ud fra din profil.");
    } catch (error) {
        console.error('Could not create SøgeAgentfrom profile:', error);
        displayErrorMessage(error.message || "Kunne ikke oprette din SøgeAgentlige nu.");
    } finally {
        button.disabled = false;
        button.innerHTML = button.dataset.originalText || 'Opret SøgeAgentfra min profil';
    }
}

async function handleHumanProfileSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');

    submitButton.disabled = true;
    submitButton.dataset.originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Gemmer...';

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
        displaySuccessMessage('Din roomie-profil er gemt.');
    } catch (error) {
        console.error('Could not save human profile:', error);
        displayErrorMessage(error.message || 'Kunne ikke gemme din roomie-profil.');
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = submitButton.dataset.originalText || 'Gem roomie-profil';
    }
}

function getHumanProfilePayload() {
    const selectedGender = document.querySelector('input[name="gender"]:checked');
    const selectedInterests = [...document.querySelectorAll('input[name="interests"]:checked')].map(input => input.value);
    const ageValue = parseInteger(document.getElementById('profile-age')?.value);
    const budgetValue = parseInteger(document.getElementById('profile-budget')?.value);

    return {
        profile_photo: profilePhotoName || null,
        age: ageValue,
        gender: selectedGender?.value || null,
        occupation: getTrimmedValue('profile-occupation') || null,
        interests: selectedInterests,
        description: getTrimmedValue('profile-description') || null,
        monthly_price_max: budgetValue,
        move_in_date: dateInputValueToEpochSeconds(getTrimmedValue('profile-move-in-date')),
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

function dateInputValueToEpochSeconds(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Math.floor(date.getTime() / 1000);
}

function enforceInterestLimit(changedInput) {
    const selected = [...document.querySelectorAll('input[name="interests"]:checked')];
    if (selected.length <= PROFILE_INTEREST_LIMIT) return;

    changedInput.checked = false;
    displayErrorMessage(`Vælg højst ${PROFILE_INTEREST_LIMIT} roomie-vibes.`);
}

function handleProfilePhotoSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        displayErrorMessage('Vælg et billede i PNG, JPG eller WebP.');
        event.target.value = '';
        return;
    }

    if (file.size > PROFILE_MAX_PHOTO_SIZE_BYTES) {
        displayErrorMessage('Profilbilledet må højst være 3 MB.');
        event.target.value = '';
        return;
    }

    pendingProfilePhotoFile = file;

    const reader = new FileReader();
    reader.onload = () => {
        updateProfilePhotoPreview(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
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

    profilePhotoName = roomieProfile.profile_photo || null;
    pendingProfilePhotoFile = null;
    updateProfilePhotoPreview(buildProfilePhotoUrl(profilePhotoName));

    setInputValue('profile-age', roomieProfile.age);
    setInputValue('profile-occupation', roomieProfile.occupation);
    setInputValue('profile-description', roomieProfile.description);
    setInputValue('profile-budget', roomieProfile.monthly_price_max);
    setInputValue('profile-move-in-date', epochSecondsToDateInputValue(roomieProfile.move_in_date));
    selectedProfileAreas = normalizeProfileAreaIds(roomieProfile.areas);
    renderProfileSelectedAreas();
    renderProfileAreaSuggestions("");

    document.querySelectorAll('input[name="gender"]').forEach(input => {
        input.checked = input.value === roomieProfile.gender;
    });

    const interests = Array.isArray(roomieProfile.interests) ? roomieProfile.interests : [];
    document.querySelectorAll('input[name="interests"]').forEach(input => {
        input.checked = interests.includes(input.value);
    });

    updateDescriptionCount();
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

function epochSecondsToDateInputValue(value) {
    if (value == null || value === '') return '';

    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }

    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return '';

    const date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    if (Number.isNaN(date.getTime())) return '';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function renderProfileAreaSuggestions(query) {
    const container = document.getElementById('profile-area-suggestions');
    if (!container) return;

    const normalizedQuery = normalizeText(query);
    const suggestions = areaAutocompleteOptions
        .filter(area => !selectedProfileAreas.includes(String(area.id)))
        .filter(area => !normalizedQuery || area.searchText.includes(normalizedQuery))
        .slice(0, PROFILE_MAX_AREA_SUGGESTIONS);

    container.innerHTML = suggestions.map(area => `
        <button type="button" data-profile-area-option="${escapeAttribute(area.id)}">
            <i class="${area.icon}"></i>
            <span>${escapeHtml(area.label)}</span>
            <small>${escapeHtml(area.description)}</small>
        </button>
    `).join("");
}

function renderProfileSelectedAreas() {
    const container = document.getElementById('profile-selected-areas');
    if (!container) return;

    if (selectedProfileAreas.length === 0) {
        container.innerHTML = '<span class="roomie-agent-area-empty">Alle områder er valgt, hvis du ikke tilføjer noget.</span>';
        return;
    }

    container.innerHTML = selectedProfileAreas.map(id => `
        <span class="roomie-agent-area-pill">
            ${escapeHtml(formatProfileAreaLabel(id))}
            <button type="button" data-profile-area-remove="${escapeAttribute(id)}" aria-label="Fjern ${escapeAttribute(formatProfileAreaLabel(id))}">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </span>
    `).join("");
}

function addSelectedProfileArea(areaId) {
    const id = String(areaId);
    if (!PROFILE_AREA_LOOKUP.has(id) || selectedProfileAreas.includes(id)) return;

    selectedProfileAreas.push(id);
    renderProfileSelectedAreas();
    renderProfileAreaSuggestions(document.getElementById('profile-area-search')?.value || "");
    updateProfileAreaInputValue();
}

function updateProfileAreaInputValue() {
    const input = document.getElementById('profile-area-search');
    if (input) input.value = "";
    renderProfileAreaSuggestions("");
}

function normalizeProfileAreaIds(areas) {
    if (!Array.isArray(areas)) return [];
    return areas.map(area => String(area)).filter(area => PROFILE_AREA_LOOKUP.has(area));
}

function formatProfileAreaLabel(areaId) {
    return PROFILE_AREA_LOOKUP.get(String(areaId))?.label || String(areaId);
}

function normalizeText(value) {
    return String(value || "").trim().toLocaleLowerCase("da-DK");
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
}

async function getProfileAgentErrorMessage(response) {
    try {
        const body = await response.json();
        if (body?.detail === "You can only have 5 agents") {
            return "Du kan højest have 5 SøgeAgenter.";
        }
        if (typeof body?.detail === "string") {
            return body.detail;
        }
        return `Serveren svarede med status ${response.status}.`;
    } catch {
        return `Serveren svarede med status ${response.status}.`;
    }
}


export function populateProfileView(){
    const payloadObj = decodeJwt();
    let userId = null;

    if (payloadObj) {
        const navName = document.getElementById('navbar-name-text');
        if (navName) navName.textContent = payloadObj.full_name;

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
