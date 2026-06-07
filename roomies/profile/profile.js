import {authFetch} from "../auth/auth.js";
import {areaAutocompleteOptions} from "../config/hardcoded_data.js";
import {displayErrorMessage, displaySuccessMessage, decodeJwt, currentUser, getHousingById} from "../utils.js";
import {showView} from "../views/viewManager.js";

const PROFILE_MAX_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;
const PROFILE_INTEREST_LIMIT = 5;
const PROFILE_MAX_AREA_SUGGESTIONS = 4;
const PROFILE_AREA_LOOKUP = new Map(areaAutocompleteOptions.map(area => [String(area.id), area]));
let profilePhotoDataUrl = null;
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

async function handleHumanProfileSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const payload = getHumanProfilePayload();

    submitButton.disabled = true;
    submitButton.dataset.originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Gemmer...';

    try {
        const response = await authFetch('/roomies/user', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('Kunne ikke gemme din roomie-profil.');
        }

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
        profile_photo: profilePhotoDataUrl || null,
        age: ageValue,
        gender: selectedGender?.value || null,
        occupation: getTrimmedValue('profile-occupation') || null,
        interests: selectedInterests,
        description: getTrimmedValue('profile-description') || null,
        monthly_budget_max: budgetValue,
        move_in_date: getTrimmedValue('profile-move-in-date') || null,
        preferred_areas: selectedProfileAreas.length ? selectedProfileAreas.map(Number).filter(Number.isFinite) : null
    };
}

function getTrimmedValue(id) {
    return String(document.getElementById(id)?.value || '').trim();
}

function parseInteger(value) {
    const parsed = Number.parseInt(String(value || '').replace(/\./g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
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

    const reader = new FileReader();
    reader.onload = () => {
        profilePhotoDataUrl = String(reader.result || '');
        updateProfilePhotoPreview(profilePhotoDataUrl);
    };
    reader.readAsDataURL(file);
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
    profilePhotoDataUrl = userProfile.profile_photo || userProfile.photo || userProfile.avatar || userProfile.user_avatar || null;
    updateProfilePhotoPreview(profilePhotoDataUrl);

    setInputValue('profile-age', userProfile.age);
    setInputValue('profile-occupation', userProfile.occupation);
    setInputValue('profile-description', userProfile.description || userProfile.profile_description);
    setInputValue('profile-budget', userProfile.monthly_budget_max);
    setInputValue('profile-move-in-date', userProfile.move_in_date);
    selectedProfileAreas = normalizeProfileAreaIds(userProfile.preferred_areas || userProfile.desired_areas || userProfile.areas);
    renderProfileSelectedAreas();
    renderProfileAreaSuggestions("");

    document.querySelectorAll('input[name="gender"]').forEach(input => {
        input.checked = input.value === userProfile.gender;
    });

    const interests = Array.isArray(userProfile.interests) ? userProfile.interests : [];
    document.querySelectorAll('input[name="interests"]').forEach(input => {
        input.checked = interests.includes(input.value);
    });

    updateDescriptionCount();
}

function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value ?? '';
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
