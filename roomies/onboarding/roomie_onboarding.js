import {authFetch} from "../auth/auth.js";
import {s3Url} from "../config/config.js";
import {currentUser, setCurrentUser, ensureCurrentUserLoaded, displayErrorMessage, displaySuccessMessage} from "../utils.js";

const MAX_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;
const INTEREST_LIMIT = 5;

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
        cta: "Gem profil & Send besked 🚀"
    },
    publish: {
        heading: "Gør din annonce personlig 🏡",
        subtext: "Boligsøgende vil gerne vide, hvem de skal bo med. En udfyldt vært giver flere henvendelser.",
        cta: "Gem profil & Udgiv annonce 🎉"
    },
    agent: {
        heading: "Gør din profil klar 🕵️‍♀️",
        subtext: "Når et værelse matcher, kan du skrive med det samme – og en udfyldt profil giver dig hurtigere svar.",
        cta: "Gem profil & Opret SøgeAgent 🔔"
    }
};

export function hasFilledRoomieProfile(user) {
    const profile = user?.roomie_profile;
    if (!profile || typeof profile !== "object") return false;

    const filledCount = MEANINGFUL_PROFILE_FIELDS.filter(field => {
        const value = profile[field];
        return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== "";
    }).length;

    return filledCount >= MIN_FILLED_PROFILE_FIELDS;
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

    applyContext(els, context);
    resetForm(els, user);
    setPhotoState(els, profilePhotoName);
    goToStep(els, 0);

    return new Promise(resolve => {
        const cleanup = () => {
            els.photoTrigger.removeEventListener("click", openPicker);
            els.photoInput.removeEventListener("change", onPhotoChange);
            els.next.removeEventListener("click", onNext);
            els.back.removeEventListener("click", onBack);
            els.form.removeEventListener("submit", onSubmit);
            els.description.removeEventListener("input", onDescInput);
            els.interestInputs.forEach(input => input.removeEventListener("change", onInterestChange));
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

        const setPhotoBusy = isBusy => {
            els.next.disabled = isBusy || !profilePhotoName;
            els.photoTrigger.classList.toggle("is-busy", isBusy);
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
                showPhotoError("Profilbilledet må højst være 3 MB.");
                els.photoInput.value = "";
                return;
            }

            showPhotoError("");
            const reader = new FileReader();
            reader.onload = () => showPhotoPreview(els, String(reader.result || ""));
            reader.readAsDataURL(file);

            setPhotoBusy(true);
            try {
                profilePhotoName = await uploadProfilePhoto(file);
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

        const onNext = () => {
            if (!profilePhotoName) {
                showPhotoError("Tilføj et profilbillede for at fortsætte.");
                return;
            }
            goToStep(els, 1);
        };

        const onBack = () => goToStep(els, 0);

        const onDescInput = () => updateDescriptionCount(els);

        const onInterestChange = event => {
            const selected = els.interestInputs.filter(input => input.checked);
            if (selected.length > INTEREST_LIMIT) {
                event.target.checked = false;
                displayErrorMessage(`Vælg højst ${INTEREST_LIMIT} roomie-vibes.`);
            }
        };

        const onSubmit = async event => {
            event.preventDefault();
            if (!profilePhotoName) {
                goToStep(els, 0);
                showPhotoError("Tilføj et profilbillede for at fortsætte.");
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
        els.next.addEventListener("click", onNext);
        els.back.addEventListener("click", onBack);
        els.form.addEventListener("submit", onSubmit);
        els.description.addEventListener("input", onDescInput);
        els.interestInputs.forEach(input => input.addEventListener("change", onInterestChange));
        modalElement.addEventListener("hidden.bs.modal", onHidden);

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
        next: modalElement.querySelector("[data-ob-next]"),
        back: modalElement.querySelector("[data-ob-back]"),
        submit: modalElement.querySelector("[data-ob-submit]"),
        age: modalElement.querySelector("[data-ob-age]"),
        occupation: modalElement.querySelector("[data-ob-occupation]"),
        description: modalElement.querySelector("[data-ob-description]"),
        descCount: modalElement.querySelector("[data-ob-desc-count]"),
        genderInputs: [...modalElement.querySelectorAll("input[name='ob-gender']")],
        interestInputs: [...modalElement.querySelectorAll("input[name='ob-interests']")]
    };
}

function applyContext(els, context) {
    if (els.heading) els.heading.textContent = context.heading;
    if (els.subtext) els.subtext.textContent = context.subtext;
    if (els.submit) els.submit.textContent = context.cta;
}

function resetForm(els, user) {
    const profile = user?.roomie_profile && typeof user.roomie_profile === "object" ? user.roomie_profile : {};

    if (els.age) els.age.value = profile.age ?? "";
    if (els.occupation) els.occupation.value = profile.occupation ?? "";
    if (els.description) els.description.value = profile.description ?? "";

    els.genderInputs.forEach(input => {
        input.checked = input.value === profile.gender;
    });

    const interests = Array.isArray(profile.interests) ? profile.interests : [];
    els.interestInputs.forEach(input => {
        input.checked = interests.includes(input.value);
    });

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

function setPhotoState(els, photoName) {
    showPhotoPreview(els, buildPhotoUrl(photoName));
    els.next.disabled = !photoName;
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
    // Spread the freshest profile so fields outside this modal (budget, areas,
    // move-in date) are preserved rather than overwritten with null.
    const existing = currentUser?.roomie_profile && typeof currentUser.roomie_profile === "object" ? currentUser.roomie_profile : {};

    const payload = {
        ...existing,
        profile_photo: profilePhotoName || null,
        age: parseInteger(els.age?.value),
        gender: selectedGender?.value || null,
        occupation: String(els.occupation?.value || "").trim() || null,
        interests,
        description: String(els.description?.value || "").trim() || null
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
