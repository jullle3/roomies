import {authFetch} from "../auth/auth.js";
import {s3Url} from "../config/config.js";
import {currentUser, setCurrentUser, ensureCurrentUserLoaded, displayErrorMessage, displaySuccessMessage} from "../utils.js";
import {cropAvatarFile, isAvatarCropperAvailable} from "../components/avatar_cropper.js";
import {areaAutocompleteOptions} from "../config/hardcoded_data.js";

// Generous ceiling so large phone photos go through — the server compresses anyway.
const MAX_PHOTO_SIZE_BYTES = 12 * 1024 * 1024;
const AREA_SUGGESTION_LIMIT = 4;
const AREA_LOOKUP = new Map(areaAutocompleteOptions.map(area => [String(area.id), area]));

// Desired areas chosen in the (seeker-only) "Hvad leder du efter?" block. Reset
// every time the modal opens via resetForm.
let selectedAreas = [];

// Identity fields that signal a genuinely filled-out roomie profile. Search
// fields (budget, areas) are excluded since they belong to the SøgeAgent.
const MEANINGFUL_PROFILE_FIELDS = ["profile_photo", "age", "gender", "occupation", "interests", "description"];
const MIN_FILLED_PROFILE_FIELDS = 3;

// One modal, three happy paths. JS swaps heading/subtext/CTA per context so the
// markup (built once in index.html) stays DRY.
const ONBOARDING_CONTEXTS = {
    contact: {
        heading: "Sæt ansigt på beskeden 👋",
        subtext: "Udlejere svarer langt oftere, når de kan se hvem de skriver med. Det tager under et minut.",
        cta: "Gem profil & Send besked 🚀",
        defaults: {seeking_room: true, renting_room: false}
    },
    publish: {
        heading: "Gør din annonce personlig 🏡",
        subtext: "Boligsøgende vil gerne vide, hvem de skal bo med. En udfyldt profil får flere henvendelser.",
        cta: "Gem profil & Udgiv annonce 🎉",
        defaults: {seeking_room: false, renting_room: true}
    },
    agent: {
        heading: "Gør din profil klar 🕵️‍♀️",
        subtext: "Når et værelse matcher, kan du skrive med det samme – og en udfyldt profil giver dig hurtigere svar.",
        cta: "Gem profil & Opret SøgeAgent 🔔",
        defaults: {seeking_room: true, renting_room: false}
    }
};

export function hasFilledRoomieProfile(user) {
    const profile = user?.roomie_profile;
    if (!profile || typeof profile !== "object") return false;

    const filledCount = MEANINGFUL_PROFILE_FIELDS.filter(field => {
        const value = profile[field];
        return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== "";
    }).length;

    // Profiles predating the seeking/renting step have their identity fields filled
    // but no intent chosen. Require an explicit intent so those existing users get
    // the modal once to fill the new directory fields; completing it always sets one.
    const hasIntent = profile.seeking_room === true || profile.renting_room === true;

    return filledCount >= MIN_FILLED_PROFILE_FIELDS && hasIntent;
}

// Resolves true if the caller may proceed (profile already complete, or the user
// completed it via the modal) and false if the user dismissed the modal.
export async function ensureRoomieProfile(contextKey) {
    const user = await ensureCurrentUserLoaded();
    if (hasFilledRoomieProfile(user)) return true;
    return openRoomieOnboarding(contextKey, user);
}

function openRoomieOnboarding(contextKey, user) {
    const context = ONBOARDING_CONTEXTS[contextKey] || ONBOARDING_CONTEXTS.contact;
    const modalElement = document.getElementById("roomieOnboardingModal");

    // Fail open: never block the user's action just because the modal is missing.
    if (!modalElement || !window.bootstrap) return Promise.resolve(true);

    const els = collectElements(modalElement);
    const modal = window.bootstrap.Modal.getOrCreateInstance(modalElement);

    let profilePhotoName = getExistingPhoto(user);
    let settled = false;
    let success = false;
    let currentStep = 0;

    applyContext(els, context);
    resetForm(els, user, context);
    setPhotoState(els, profilePhotoName);
    goToStep(els, 0);

    return new Promise(resolve => {
        const cleanup = () => {
            els.photoTrigger.removeEventListener("click", openPicker);
            els.photoInput.removeEventListener("change", onPhotoChange);
            els.nextButtons.forEach(button => button.removeEventListener("click", onNext));
            els.backButtons.forEach(button => button.removeEventListener("click", onBack));
            els.form.removeEventListener("submit", onSubmit);
            els.description.removeEventListener("input", onDescInput);
            els.occupationInputs.forEach(input => input.removeEventListener("change", onOccupationChange));
            els.age?.removeEventListener("input", onIdentityInput);
            els.genderInputs.forEach(input => input.removeEventListener("change", onIdentityInput));
            els.monthlyPriceMax?.removeEventListener("input", onIdentityInput);
            els.seekingRoom?.removeEventListener("change", onSeekingToggle);
            els.rentingRoom?.removeEventListener("change", onRentingToggle);
            els.areaSearch?.removeEventListener("input", onAreaInput);
            els.areaSearch?.removeEventListener("focus", onAreaInput);
            els.areaSearch?.removeEventListener("keydown", onAreaKeydown);
            els.areaSuggestions?.removeEventListener("mousedown", onAreaSuggestionsMousedown);
            els.selectedAreas?.removeEventListener("click", onSelectedAreasClick);
            document.removeEventListener("click", onAreaDocumentClick);
            modalElement.removeEventListener("hidden.bs.modal", onHidden);
        };

        const finish = result => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };

        const onHidden = () => finish(success);

        const openPicker = () => els.photoInput.click();

        const showPhotoError = message => {
            els.photoError.textContent = message || "";
            els.photoError.classList.toggle("d-none", !message);
        };

        let photoBusy = false;

        // Greys out each step's "Næste"/submit button until that step's required
        // fields are valid, so the user gets immediate, non-blocking feedback.
        const refreshButtons = () => {
            const stepButton = step => els.nextButtons.find(
                button => Number(button.closest("[data-ob-step]")?.dataset.obStep) === step
            );
            const step0Button = stepButton(0);
            const step1Button = stepButton(1);
            if (step0Button) step0Button.disabled = photoBusy || Boolean(!profilePhotoName || getIdentityValidationError(els));
            if (step1Button) step1Button.disabled = Boolean(getSeekerValidationError(els));
            if (els.submit) els.submit.disabled = Boolean(getDescriptionValidationError(els));
        };

        const setPhotoBusy = isBusy => {
            photoBusy = isBusy;
            els.photoTrigger.classList.toggle("is-busy", isBusy);
            refreshButtons();
        };

        const onPhotoChange = async event => {
            const file = event.target.files?.[0];
            if (!file) return;

            if (!file.type.startsWith("image/")) {
                showPhotoError("Vælg et billede i PNG, JPG eller WebP.");
                els.photoInput.value = "";
                return;
            }
            if (file.size > MAX_PHOTO_SIZE_BYTES) {
                showPhotoError("Profilbilledet må højst være 12 MB.");
                els.photoInput.value = "";
                return;
            }

            showPhotoError("");

            // Let the user crop/zoom so their face is in focus. When the library
            // isn't available we upload the original; an explicit cancel aborts.
            let finalFile = file;
            if (isAvatarCropperAvailable()) {
                const cropped = await cropAvatarFile(file);
                if (!cropped) {
                    els.photoInput.value = "";
                    return;
                }
                finalFile = cropped;
            }

            const reader = new FileReader();
            reader.onload = () => showPhotoPreview(els, String(reader.result || ""));
            reader.readAsDataURL(finalFile);

            setPhotoBusy(true);
            try {
                profilePhotoName = await uploadProfilePhoto(finalFile);
                setPhotoState(els, profilePhotoName);
            } catch (error) {
                console.error("Kunne ikke uploade profilbillede:", error);
                showPhotoError(error.message || "Kunne ikke uploade profilbilledet.");
                profilePhotoName = getExistingPhoto(currentUser);
                setPhotoState(els, profilePhotoName);
            } finally {
                els.photoInput.value = "";
                setPhotoBusy(false);
            }
        };

        const lastStep = els.steps.length - 1;

        const onNext = () => {
            // Validate the step the user is leaving so problems surface immediately
            // instead of on the final step, where they'd have to navigate back.
            if (currentStep === 0) {
                // The photo lives on step 0, so gate leaving it on the photo first.
                if (!profilePhotoName) {
                    showPhotoError("Tilføj et profilbillede for at fortsætte.");
                    return;
                }
                const identityError = getIdentityValidationError(els);
                if (identityError) {
                    displayErrorMessage(identityError);
                    return;
                }
            }
            // Seeker fields live on step 1.
            if (currentStep === 1) {
                const seekerError = getSeekerValidationError(els);
                if (seekerError) {
                    displayErrorMessage(seekerError);
                    return;
                }
            }
            currentStep = Math.min(currentStep + 1, lastStep);
            goToStep(els, currentStep);
        };

        const onBack = () => {
            currentStep = Math.max(currentStep - 1, 0);
            goToStep(els, currentStep);
        };

        const onDescInput = () => {
            updateDescriptionCount(els);
            refreshButtons();
        };

        const onOccupationChange = () => updateOccupationLabel(els);

        // Age + gender (step 0) and budget (step 1) all gate their step's button.
        const onIdentityInput = () => refreshButtons();

        // The two roles are mutually exclusive — ticking one clears the other.
        // Both unchecked is valid (user wants to stay anonymous). The "Hvad leder
        // du efter?" block only matters to room seekers, so reveal it when they
        // tick "Jeg søger værelse" and hide it otherwise.
        const onSeekingToggle = () => {
            if (els.seekingRoom?.checked && els.rentingRoom) els.rentingRoom.checked = false;
            updateSeekerFieldsVisibility(els);
            refreshButtons();
        };
        const onRentingToggle = () => {
            if (els.rentingRoom?.checked && els.seekingRoom) els.seekingRoom.checked = false;
            updateSeekerFieldsVisibility(els);
            refreshButtons();
        };

        const onAreaInput = () => renderAreaSuggestions(els, els.areaSearch.value);
        const onAreaKeydown = event => {
            if (event.key !== "Enter") return;
            const firstOption = els.areaSuggestions.querySelector("[data-ob-area-option]");
            if (!firstOption) return;
            event.preventDefault();
            addArea(els, firstOption.dataset.obAreaOption);
            refreshButtons();
        };
        const onAreaSuggestionsMousedown = event => {
            const option = event.target.closest("[data-ob-area-option]");
            if (!option) return;
            event.preventDefault();
            addArea(els, option.dataset.obAreaOption);
            refreshButtons();
        };
        const onSelectedAreasClick = event => {
            const remove = event.target.closest("[data-ob-area-remove]");
            if (!remove) return;
            selectedAreas = selectedAreas.filter(id => id !== remove.dataset.obAreaRemove);
            renderSelectedAreas(els);
            renderAreaSuggestions(els, els.areaSearch.value);
            refreshButtons();
        };
        const onAreaDocumentClick = event => {
            if (!els.areaSuggestions || event.target === els.areaSearch || els.areaSuggestions.contains(event.target)) return;
            // Keep the default area hints visible rather than clearing the list.
            renderAreaSuggestions(els, "");
        };

        const onSubmit = async event => {
            event.preventDefault();
            // Re-validate every step's requirements and jump back to the first one
            // that fails, so nothing slips through even if a user edits via Back.
            if (!profilePhotoName) {
                currentStep = 0;
                goToStep(els, 0);
                showPhotoError("Tilføj et profilbillede for at fortsætte.");
                return;
            }

            const identityError = getIdentityValidationError(els);
            if (identityError) {
                currentStep = 0;
                goToStep(els, 0);
                displayErrorMessage(identityError);
                return;
            }

            const seekerError = getSeekerValidationError(els);
            if (seekerError) {
                // Seeker fields live on step 1 — jump back so the user sees them.
                currentStep = 1;
                goToStep(els, 1);
                displayErrorMessage(seekerError);
                return;
            }

            const descriptionError = getDescriptionValidationError(els);
            if (descriptionError) {
                displayErrorMessage(descriptionError);
                els.description?.focus();
                return;
            }

            setSubmitBusy(els, true);
            try {
                await saveRoomieProfile(els, profilePhotoName);
                success = true;
                displaySuccessMessage("Din roomie-profil er gemt. 🎉");
                modal.hide();
            } catch (error) {
                console.error("Kunne ikke gemme roomie-profil:", error);
                displayErrorMessage(error.message || "Kunne ikke gemme din profil lige nu.");
                setSubmitBusy(els, false, context);
            }
        };

        els.photoTrigger.addEventListener("click", openPicker);
        els.photoInput.addEventListener("change", onPhotoChange);
        els.nextButtons.forEach(button => button.addEventListener("click", onNext));
        els.backButtons.forEach(button => button.addEventListener("click", onBack));
        els.form.addEventListener("submit", onSubmit);
        els.description.addEventListener("input", onDescInput);
        els.occupationInputs.forEach(input => input.addEventListener("change", onOccupationChange));
        els.age?.addEventListener("input", onIdentityInput);
        els.genderInputs.forEach(input => input.addEventListener("change", onIdentityInput));
        els.monthlyPriceMax?.addEventListener("input", onIdentityInput);
        els.seekingRoom?.addEventListener("change", onSeekingToggle);
        els.rentingRoom?.addEventListener("change", onRentingToggle);
        els.areaSearch?.addEventListener("input", onAreaInput);
        els.areaSearch?.addEventListener("focus", onAreaInput);
        els.areaSearch?.addEventListener("keydown", onAreaKeydown);
        els.areaSuggestions?.addEventListener("mousedown", onAreaSuggestionsMousedown);
        els.selectedAreas?.addEventListener("click", onSelectedAreasClick);
        document.addEventListener("click", onAreaDocumentClick);
        modalElement.addEventListener("hidden.bs.modal", onHidden);

        refreshButtons();
        modal.show();
    });
}

function collectElements(modalElement) {
    return {
        heading: modalElement.querySelector("[data-ob-heading]"),
        subtext: modalElement.querySelector("[data-ob-subtext]"),
        form: modalElement.querySelector("#roomieOnboardingForm"),
        steps: [...modalElement.querySelectorAll("[data-ob-step]")],
        dots: [...modalElement.querySelectorAll("[data-ob-dot]")],
        photoTrigger: modalElement.querySelector("[data-ob-photo-trigger]"),
        photoInput: modalElement.querySelector("[data-ob-photo-input]"),
        photoPreview: modalElement.querySelector("[data-ob-photo-preview]"),
        photoPlaceholder: modalElement.querySelector("[data-ob-photo-placeholder]"),
        photoError: modalElement.querySelector("[data-ob-photo-error]"),
        nextButtons: [...modalElement.querySelectorAll("[data-ob-next]")],
        backButtons: [...modalElement.querySelectorAll("[data-ob-back]")],
        submit: modalElement.querySelector("[data-ob-submit]"),
        age: modalElement.querySelector("[data-ob-age]"),
        occupationLabel: modalElement.querySelector("[data-ob-occupation-label]"),
        description: modalElement.querySelector("[data-ob-description]"),
        descCount: modalElement.querySelector("[data-ob-desc-count]"),
        seekingRoom: modalElement.querySelector("[data-ob-seeking-room]"),
        rentingRoom: modalElement.querySelector("[data-ob-renting-room]"),
        seekerFields: modalElement.querySelector("[data-ob-seeker-fields]"),
        monthlyPriceMax: modalElement.querySelector("[data-ob-monthly-price-max]"),
        areaSearch: modalElement.querySelector("[data-ob-area-search]"),
        areaSuggestions: modalElement.querySelector("[data-ob-area-suggestions]"),
        selectedAreas: modalElement.querySelector("[data-ob-selected-areas]"),
        genderInputs: [...modalElement.querySelectorAll("input[name='ob-gender']")],
        interestInputs: [...modalElement.querySelectorAll("input[name='ob-interests']")],
        occupationInputs: [...modalElement.querySelectorAll("input[name='ob-occupation']")]
    };
}

function applyContext(els, context) {
    if (els.heading) els.heading.textContent = context.heading;
    if (els.subtext) els.subtext.textContent = context.subtext;
    if (els.submit) els.submit.textContent = context.cta;
}

function resetForm(els, user, context = {}) {
    const profile = user?.roomie_profile && typeof user.roomie_profile === "object" ? user.roomie_profile : {};

    if (els.age) els.age.value = profile.age ?? "";
    if (els.description) els.description.value = profile.description ?? "";

    els.genderInputs.forEach(input => {
        input.checked = input.value === profile.gender;
    });

    const interests = Array.isArray(profile.interests) ? profile.interests : [];
    els.interestInputs.forEach(input => {
        input.checked = interests.includes(input.value);
    });

    // occupation is a list of strings; tolerate the legacy single-string form too.
    const occupations = Array.isArray(profile.occupation) ? profile.occupation : (profile.occupation ? [profile.occupation] : []);
    els.occupationInputs.forEach(input => {
        input.checked = occupations.includes(input.value);
    });
    updateOccupationLabel(els);

    if (els.seekingRoom) {
        els.seekingRoom.checked = typeof profile.seeking_room === "boolean"
            ? profile.seeking_room
            : context.defaults?.seeking_room === true;
    }
    if (els.rentingRoom) {
        els.rentingRoom.checked = typeof profile.renting_room === "boolean"
            ? profile.renting_room
            : context.defaults?.renting_room === true;
    }

    if (els.monthlyPriceMax) els.monthlyPriceMax.value = profile.monthly_price_max ?? "";
    selectedAreas = normalizeAreaIds(profile.areas);
    if (els.areaSearch) els.areaSearch.value = "";
    renderSelectedAreas(els);
    renderAreaSuggestions(els, "");
    updateSeekerFieldsVisibility(els);

    updateDescriptionCount(els);
}

function goToStep(els, stepIndex) {
    els.steps.forEach(step => {
        step.classList.toggle("is-active", Number(step.dataset.obStep) === stepIndex);
    });
    els.dots.forEach(dot => {
        dot.classList.toggle("is-active", Number(dot.dataset.obDot) <= stepIndex);
    });
}

function updateDescriptionCount(els) {
    if (els.descCount && els.description) {
        els.descCount.textContent = String(els.description.value.length);
    }
}

// Reflects the selected occupations in the dropdown toggle, or shows the muted
// placeholder when nothing is chosen.
function updateOccupationLabel(els) {
    if (!els.occupationLabel) return;
    const selected = els.occupationInputs.filter(input => input.checked).map(input => input.value);
    els.occupationLabel.textContent = selected.length ? selected.join(", ") : "Vælg beskæftigelse";
    els.occupationLabel.classList.toggle("is-placeholder", selected.length === 0);
}

// Seeker-only block: budget + desired areas. Hidden unless the user is seeking.
function updateSeekerFieldsVisibility(els) {
    els.seekerFields?.classList.toggle("d-none", !els.seekingRoom?.checked);
}

// Step 0 identity essentials: age + gender are required so listers know who
// they're talking to. Returns an error string or null.
function getIdentityValidationError(els) {
    const age = parseInteger(els.age?.value);
    if (!age || age <= 0) {
        return "Angiv din alder.";
    }
    if (!els.genderInputs.some(input => input.checked)) {
        return "Vælg dit køn.";
    }
    return null;
}

// Step 2: a short "om mig" makes the profile feel real. Returns an error or null.
function getDescriptionValidationError(els) {
    if (!els.description?.value.trim()) {
        return "Skriv lidt om dig selv som roomie.";
    }
    return null;
}

// When seeking a room, budget + at least one desired area are required so people
// with rooms can match them. Returns an error string or null.
function getSeekerValidationError(els) {
    if (!els.seekingRoom?.checked) return null;

    const priceMax = parseInteger(els.monthlyPriceMax?.value);
    if (!priceMax || priceMax <= 0) {
        return "Angiv din maks husleje pr. måned, når du søger værelse.";
    }
    if (!selectedAreas.length) {
        return "Vælg mindst ét ønsket område, når du søger værelse.";
    }
    return null;
}

function renderAreaSuggestions(els, query = "") {
    const container = els.areaSuggestions;
    if (!container) return;

    const normalizedQuery = normalizeText(query);
    const suggestions = areaAutocompleteOptions
        .filter(area => !selectedAreas.includes(String(area.id)))
        .filter(area => !normalizedQuery || area.searchText.includes(normalizedQuery))
        .slice(0, AREA_SUGGESTION_LIMIT);

    container.innerHTML = suggestions.map(area => `
        <button type="button" data-ob-area-option="${escapeAttribute(area.id)}">
            <i class="${escapeAttribute(area.icon || 'fa-solid fa-location-dot')}"></i>
            <span>${escapeHtml(area.label)}</span>
        </button>
    `).join("");
}

function renderSelectedAreas(els) {
    const container = els.selectedAreas;
    if (!container) return;

    container.innerHTML = selectedAreas.map(id => `
        <span class="profile-area-pill">
            ${escapeHtml(formatAreaLabel(id))}
            <button type="button" data-ob-area-remove="${escapeAttribute(id)}" aria-label="Fjern ${escapeAttribute(formatAreaLabel(id))}">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </span>
    `).join("");
}

function addArea(els, areaId) {
    const id = String(areaId || "");
    if (!AREA_LOOKUP.has(id) || selectedAreas.includes(id)) return;

    selectedAreas.push(id);
    if (els.areaSearch) els.areaSearch.value = "";
    renderSelectedAreas(els);
    renderAreaSuggestions(els, "");
}

function normalizeAreaIds(value) {
    if (!Array.isArray(value)) return [];
    return value.map(id => String(id)).filter(id => AREA_LOOKUP.has(id));
}

function formatAreaLabel(areaId) {
    return AREA_LOOKUP.get(String(areaId))?.label || String(areaId);
}

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
}

function setPhotoState(els, photoName) {
    showPhotoPreview(els, buildPhotoUrl(photoName));
    els.nextButtons.forEach(button => { button.disabled = !photoName; });
}

function showPhotoPreview(els, src) {
    if (!els.photoPreview || !els.photoPlaceholder) return;
    if (src) {
        els.photoPreview.src = src;
        els.photoPreview.classList.remove("d-none");
        els.photoPlaceholder.classList.add("d-none");
    } else {
        els.photoPreview.removeAttribute("src");
        els.photoPreview.classList.add("d-none");
        els.photoPlaceholder.classList.remove("d-none");
    }
}

function setSubmitBusy(els, isBusy, context = null) {
    if (!els.submit) return;
    els.submit.disabled = isBusy;
    if (isBusy) {
        els.submit.dataset.originalText = els.submit.textContent;
        els.submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Gemmer...';
    } else {
        els.submit.textContent = context?.cta || els.submit.dataset.originalText || "Gem profil";
    }
}

async function saveRoomieProfile(els, profilePhotoName) {
    const selectedGender = els.genderInputs.find(input => input.checked);
    const interests = els.interestInputs.filter(input => input.checked).map(input => input.value);
    const occupation = els.occupationInputs.filter(input => input.checked).map(input => input.value);
    // Spread the freshest profile so fields outside this modal (budget, areas,
    // move-in date) are preserved rather than overwritten with null.
    const existing = currentUser?.roomie_profile && typeof currentUser.roomie_profile === "object" ? currentUser.roomie_profile : {};

    const payload = {
        ...existing,
        profile_photo: profilePhotoName || null,
        age: parseInteger(els.age?.value),
        gender: selectedGender?.value || null,
        occupation,
        interests,
        description: String(els.description?.value || "").trim() || null,
        seeking_room: els.seekingRoom?.checked || false,
        renting_room: els.rentingRoom?.checked || false,
        monthly_price_max: parseInteger(els.monthlyPriceMax?.value),
        areas: selectedAreas.length ? selectedAreas.map(Number).filter(Number.isFinite) : null
    };

    const response = await authFetch("/roomies/user", {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({roomie_profile: payload})
    });

    if (!response.ok) {
        throw new Error("Kunne ikke gemme din roomie-profil.");
    }

    setCurrentUser(await response.json());
}

async function uploadProfilePhoto(file) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await authFetch("/roomies/user/profile-photo", {
        method: "POST",
        body: formData
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.detail || body.message || "Kunne ikke uploade profilbilledet.");
    }

    const profilePhoto = body.profile_photo || body.name || null;
    if (profilePhoto && currentUser) {
        currentUser.roomie_profile = {
            ...(currentUser.roomie_profile || {}),
            profile_photo: profilePhoto
        };
    }
    return profilePhoto;
}

function getExistingPhoto(user) {
    const photo = user?.roomie_profile?.profile_photo;
    return typeof photo === "string" && photo.trim() ? photo.trim() : null;
}

function buildPhotoUrl(imageName) {
    if (!imageName) return null;
    const value = String(imageName);
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    return `${s3Url}/${value.replace(/^\/+/, "")}`;
}

function parseInteger(value) {
    const parsed = Number.parseInt(String(value || "").replace(/\./g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
}
