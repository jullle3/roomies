import {
    currentUser,
    displayErrorMessage,
    displaySuccessMessage,
    ensureCurrentUserLoaded,
    isLoggedIn,
    showConfirmationModal
} from "../utils.js";
import {authFetch} from "../auth/auth.js";
import {s3Url} from "../config/config.js";
import {getCachedRooms, mergeRoomsIntoCaches, preloadRooms, removeRoomsFromCaches} from "../rooms/room_cache.js";
import {displayLoginModal, showView} from "../views/viewManager.js";
import {ensureRoomieProfile} from "../onboarding/roomie_onboarding.js";

const RENT_ROOM_DRAFT_KEY = "roomies_rent_room_draft";
// Tracks which user a saved draft belongs to, so one user's draft (and their backend
// room ids) never leaks into another user's session in the same browser.
const RENT_ROOM_DRAFT_OWNER_KEY = "roomies_rent_room_draft_owner";
const ADDRESS_AUTOCOMPLETE_URL = "https://api.dataforsyningen.dk/adresser/autocomplete";
const MAX_IMAGES = 8;
const MAX_IMAGE_SIZE_BYTES = 12 * 1024 * 1024;
const IMAGE_OPTIMIZATION_MAX_EDGE = 1200;
const IMAGE_OPTIMIZATION_QUALITY = 0.8;
const ROOM_FIELDS = [
    "title",
    "description",
    "available_from",
    "rental_period_months",
    "monthly_rent",
    "deposit",
    "prepaid_rent",
    "size",
    "furnished"
];

let selectedAddress = null;
let draftSaveTimeout = null;
const roomStates = new Map();

export async function setupRentRoomView() {
    const form = document.getElementById("form-rent-room");
    if (!form) return;

    await renderRentRoomOwnerPanel();

    if (form.dataset.bound) return;

    form.dataset.bound = "1";

    const draft = await getInitialRentRoomDraft();
    restoreSharedDraft(form, draft);
    setupRoomEditor(form, draft);
    setupAddressAutocomplete(form);
    setupDraftSaving(form);
    setupRentRoomTotalCalculation(form);
    setupRentRoomWizard(form);

    form.addEventListener("submit", handleRentRoomSubmit);
}

export async function refreshRentRoomFormFromOwnerRooms(options = {}) {
    const form = document.getElementById("form-rent-room");
    if (!form) return;

    await renderRentRoomOwnerPanel();

    // On view (re)entry, prefer a locally saved draft so in-progress input survives
    // logging in mid-creation. Delete flows pass nothing, forcing a fresh backend load.
    const draft = options.preferLocalDraft
        ? await getInitialRentRoomDraft()
        : await buildDraftFromUserRooms();
    if (!draft) {
        resetRentRoomFormToEmpty(form);
        return;
    }

    restoreSharedDraft(form, draft);
    populateRoomEditor(form, draft);
    updateAllRoomTotalRents(form);
    updateRentRoomSubmitLabel(form);
    saveDraft(form);
}

function resetRentRoomFormToEmpty(form) {
    clearRentRoomDraft();
    selectedAddress = null;
    form.reset();
    clearAddressDerivedFields();
    populateRoomEditor(form, null);
    updateAllRoomTotalRents(form);
    updateRentRoomSubmitLabel(form);
}

function setupRoomEditor(form, draft) {
    const roomList = document.getElementById("rent-room-list");
    const addButton = document.getElementById("rent-room-add-button");
    if (!roomList || !addButton) return;

    populateRoomEditor(form, draft);

    if (roomList.dataset.editorBound === "1") return;
    roomList.dataset.editorBound = "1";

    addButton.addEventListener("click", () => {
        const roomElement = addRoom(form);
        updateRoomHeadings();
        saveDraft(form);
        roomElement?.querySelector('[data-room-field="title"]')?.focus();
    });

    roomList.addEventListener("click", event => {
        const removeButton = event.target.closest("[data-remove-room]");
        if (!removeButton) return;

        const roomElement = removeButton.closest("[data-room-id]");
        if (!roomElement || roomStates.size === 1) {
            displayErrorMessage("Der skal være mindst ét værelse i annoncen.");
            return;
        }

        removeRoom(roomElement.dataset.roomId);
        roomElement.remove();
        updateRoomHeadings();
        updateRentRoomSubmitLabel(form);
        saveDraft(form);
    });

    updateRoomHeadings();
    updateRentRoomSubmitLabel(form);
}

function populateRoomEditor(form, draft) {
    const roomList = document.getElementById("rent-room-list");
    if (!roomList) return;

    roomStates.forEach(state => {
        state.images.forEach(image => URL.revokeObjectURL(image.previewUrl));
    });
    roomStates.clear();
    roomList.innerHTML = "";

    normalizeDraftRooms(draft).forEach(room => addRoom(form, room));
    updateRoomHeadings();
    updateRentRoomSubmitLabel(form);
}

function addRoom(form, room = {}) {
    const template = document.getElementById("rent-room-item-template");
    const roomList = document.getElementById("rent-room-list");
    if (!template || !roomList) return null;

    const id = room.id || createRoomId();
    const fragment = template.content.cloneNode(true);
    const roomElement = fragment.querySelector("[data-room-id]");
    roomElement.dataset.roomId = id;
    if (room.backend_room_id) {
        roomElement.dataset.backendRoomId = room.backend_room_id;
    }

    ROOM_FIELDS.forEach(fieldName => {
        const field = roomElement.querySelector(`[data-room-field="${fieldName}"]`);
        if (!field) return;

        const fieldId = `rent_room_${id}_${fieldName}`;
        field.id = fieldId;
        field.name = `rooms[${id}][${fieldName}]`;

        const label = roomElement.querySelector(`[data-label-for="${fieldName}"]`);
        if (label) label.htmlFor = fieldId;

        if (field.type === "checkbox") {
            field.checked = room[fieldName] === true;
        } else if (room[fieldName] != null) {
            field.value = room[fieldName];
        }
    });

    const imageInput = roomElement.querySelector("[data-room-images]");
    const uploadZone = roomElement.querySelector("[data-upload-zone]");
    const imageInputId = `rent_room_${id}_images`;
    imageInput.id = imageInputId;
    uploadZone.htmlFor = imageInputId;

    roomStates.set(id, {
        images: [],
        savedImageNames: Array.isArray(room.image_names) ? [...room.image_names] : []
    });

    setupRoomImageHandling(roomElement, form);
    setupRoomEconomyDefaults(roomElement);
    setupPrepaidRentToggle(roomElement);
    roomList.appendChild(fragment);
    const addedRoom = roomList.querySelector(`[data-room-id="${id}"]`);
    updateRoomTotalRent(addedRoom);
    renderImagePreviews(id, addedRoom?.querySelector("[data-image-previews]"));
    updateRentRoomSubmitLabel(form);
    return addedRoom;
}

function setupRentRoomWizard(form) {
    if (form.dataset.wizardBound === "1") return;
    form.dataset.wizardBound = "1";
    form.dataset.currentStep = "0";

    form.addEventListener("click", event => {
        const nextButton = event.target.closest("[data-rent-room-next]");
        if (nextButton) {
            event.preventDefault();
            goToRentRoomStep(form, getCurrentRentRoomStep(form) + 1);
            return;
        }

        const prevButton = event.target.closest("[data-rent-room-prev]");
        if (prevButton) {
            event.preventDefault();
            goToRentRoomStep(form, getCurrentRentRoomStep(form) - 1, {skipValidation: true});
        }
    });

    showRentRoomStep(form, 0);
}

function goToRentRoomStep(form, step, options = {}) {
    const currentStep = getCurrentRentRoomStep(form);
    if (!options.skipValidation && step > currentStep && !validateRentRoomStep(form, currentStep)) {
        return;
    }

    showRentRoomStep(form, step);
}

function showRentRoomStep(form, step) {
    const sections = [...form.querySelectorAll("[data-rent-room-step]")];
    const maxStep = sections.length - 1;
    const nextStep = Math.max(0, Math.min(step, maxStep));

    form.dataset.currentStep = String(nextStep);

    sections.forEach(section => {
        section.classList.toggle("d-none", Number(section.dataset.rentRoomStep) !== nextStep);
    });

    form.querySelectorAll("[data-rent-room-step-indicator]").forEach(indicator => {
        const indicatorStep = Number(indicator.dataset.rentRoomStepIndicator);
        indicator.classList.toggle("is-active", indicatorStep === nextStep);
        indicator.classList.toggle("is-complete", indicatorStep < nextStep);
    });
}

function getCurrentRentRoomStep(form) {
    return Number(form.dataset.currentStep || 0);
}

function validateRentRoomStep(form, step) {
    const section = form.querySelector(`[data-rent-room-step="${step}"]`);
    if (!section) return true;

    section.classList.add("was-validated");

    const invalidField = [...section.querySelectorAll("input, select, textarea")]
        .find(field => !field.checkValidity());

    if (invalidField) {
        invalidField.focus();
        displayErrorMessage("Tjek de markerede felter, før du fortsætter.");
        return false;
    }

    if (step === 0 && !hasSelectedOfficialAddress()) {
        document.getElementById("rent_room_address")?.focus();
        displayErrorMessage("Vælg adressen fra listen, så vi kan placere værelserne korrekt.");
        return false;
    }

    return true;
}

function setupRoomEconomyDefaults(roomElement) {
    const monthlyRentInput = getRoomField(roomElement, "monthly_rent");
    const depositInput = getRoomField(roomElement, "deposit");
    if (!monthlyRentInput || !depositInput) return;

    depositInput.dataset.autoFilled = depositInput.value ? "0" : "1";
    depositInput.addEventListener("input", () => {
        depositInput.dataset.autoFilled = "0";
    });

    monthlyRentInput.addEventListener("input", () => {
        const rent = Number(monthlyRentInput.value);
        updateRoomTotalRent(roomElement);
        if (!Number.isFinite(rent) || rent <= 0) return;

        if (!depositInput.value || depositInput.dataset.autoFilled === "1") {
            depositInput.value = String(Math.round(rent * 3));
            depositInput.dataset.autoFilled = "1";
        }
    });
}

function setupRentRoomTotalCalculation(form) {
    const acontoInput = form.querySelector('[name="aconto_monthly"]');
    if (!acontoInput) return;

    acontoInput.addEventListener("input", () => updateAllRoomTotalRents(form));
    updateAllRoomTotalRents(form);
}

function updateAllRoomTotalRents(form) {
    form.querySelectorAll("#rent-room-list [data-room-id]").forEach(updateRoomTotalRent);
}

function updateRoomTotalRent(roomElement) {
    if (!roomElement) return;

    const totalInput = roomElement.querySelector("[data-room-total-rent]");
    const monthlyRent = parsePositiveNumber(getRoomField(roomElement, "monthly_rent")?.value);
    const aconto = parsePositiveNumber(document.getElementById("rent_room_aconto_monthly")?.value);
    if (!totalInput) return;

    totalInput.value = `${formatDanishNumber(monthlyRent + aconto)} kr.`;
}

function parsePositiveNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatDanishNumber(value) {
    return Math.round(value).toLocaleString("da-DK");
}

function setupPrepaidRentToggle(roomElement) {
    const toggle = roomElement.querySelector("[data-prepaid-rent-toggle]");
    const panel = roomElement.querySelector("[data-prepaid-rent-panel]");
    const input = getRoomField(roomElement, "prepaid_rent");
    if (!toggle || !panel || !input) return;

    const sync = expanded => {
        panel.classList.toggle("d-none", !expanded);
        toggle.classList.toggle("d-none", expanded);
        if (!expanded) input.value = "";
    };

    sync(Boolean(input.value));

    toggle.addEventListener("click", () => {
        const rent = Number(getRoomField(roomElement, "monthly_rent")?.value);
        if (!input.value && Number.isFinite(rent) && rent > 0) {
            input.value = String(Math.round(rent));
        }
        sync(true);
        input.focus();
    });

    roomElement.querySelector("[data-prepaid-rent-remove]")?.addEventListener("click", () => {
        sync(false);
    });
}

function removeRoom(roomId) {
    const state = roomStates.get(roomId);
    state?.images.forEach(image => URL.revokeObjectURL(image.previewUrl));
    roomStates.delete(roomId);
}

function updateRoomHeadings() {
    const rooms = [...document.querySelectorAll("#rent-room-list [data-room-id]")];
    rooms.forEach((room, index) => {
        const heading = room.querySelector("[data-room-heading]");
        if (heading) heading.textContent = `Værelse ${index + 1}`;

        const removeButton = room.querySelector("[data-remove-room]");
        if (removeButton) removeButton.classList.toggle("d-none", rooms.length === 1);
    });
}

function updateRentRoomSubmitLabel(form) {
    const submitButton = form.querySelector('[type="submit"]');
    if (!submitButton || submitButton.disabled) return;

    const rooms = [...form.querySelectorAll("#rent-room-list [data-room-id]")];
    const existingCount = rooms.filter(room => room.dataset.backendRoomId).length;
    const label = existingCount === 0
        ? "Opret opslag"
        : existingCount === rooms.length
            ? "Opdater opslag"
            : "Gem opslag";

    submitButton.innerHTML = `<i class="fa-solid fa-check me-2"></i>${label}`;
}

function setupDraftSaving(form) {
    const scheduleDraftSave = () => {
        clearTimeout(draftSaveTimeout);
        draftSaveTimeout = setTimeout(() => saveDraft(form), 300);
    };

    form.addEventListener("input", scheduleDraftSave);
    form.addEventListener("change", scheduleDraftSave);
}

function setupAddressAutocomplete(form) {
    const addressInput = document.getElementById("rent_room_address");
    const postalInput = document.getElementById("rent_room_postal");
    const floorInput = document.getElementById("rent_room_floor");
    if (!addressInput || !postalInput || !floorInput) return;

    const dropdown = ensureAddressDropdown(addressInput);
    let debounceTimer = null;
    let activeRequest = null;

    addressInput.required = true;
    postalInput.required = true;
    postalInput.readOnly = true;

    addressInput.addEventListener("input", () => {
        selectedAddress = null;
        clearAddressDerivedFields();
        clearTimeout(debounceTimer);
        activeRequest?.abort();

        const query = addressInput.value.trim();
        if (query.length < 3) {
            hideAddressDropdown(dropdown);
            return;
        }

        debounceTimer = setTimeout(async () => {
            activeRequest = new AbortController();

            try {
                const url = `${ADDRESS_AUTOCOMPLETE_URL}?q=${encodeURIComponent(query)}&per_side=6`;
                const response = await fetch(url, {signal: activeRequest.signal});
                if (!response.ok) {
                    throw new Error(`Dataforsyningen svarede med status ${response.status}`);
                }

                renderAddressSuggestions(
                    dropdown,
                    await response.json(),
                    item => {
                        selectAddress(item, addressInput, postalInput, dropdown);
                        saveDraft(form);
                    }
                );
            } catch (error) {
                if (error.name === "AbortError") return;
                console.error("Kunne ikke hente adresseforslag:", error);
                hideAddressDropdown(dropdown);
            }
        }, 300);
    });

    addressInput.addEventListener("focus", () => {
        if (dropdown.children.length > 0) dropdown.style.display = "block";
    });

    document.addEventListener("click", event => {
        if (event.target !== addressInput && !dropdown.contains(event.target)) {
            hideAddressDropdown(dropdown);
        }
    });
}

function ensureAddressDropdown(addressInput) {
    let dropdown = document.getElementById("rent-room-address-dropdown");
    if (dropdown) return dropdown;

    addressInput.parentElement.classList.add("position-relative");

    dropdown = document.createElement("div");
    dropdown.id = "rent-room-address-dropdown";
    dropdown.className = "list-group position-absolute w-100 shadow-sm mt-1";
    dropdown.style.zIndex = "1000";
    dropdown.style.display = "none";
    addressInput.insertAdjacentElement("afterend", dropdown);
    return dropdown;
}

function renderAddressSuggestions(dropdown, suggestions, onSelect) {
    dropdown.innerHTML = "";

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        hideAddressDropdown(dropdown);
        return;
    }

    suggestions.forEach(item => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "list-group-item list-group-item-action";
        button.textContent = item.tekst;
        button.addEventListener("click", () => onSelect(item));
        dropdown.appendChild(button);
    });

    dropdown.style.display = "block";
}

function selectAddress(item, addressInput, postalInput, dropdown) {
    const address = item?.adresse;
    if (!address) return;

    selectedAddress = {
        dataforsyningen_id: address.id || null,
        full_address: item.tekst || buildFullAddress(address),
        street_name: address.vejnavn || "",
        house_number: address.husnr || "",
        floor: getAddressFloor(address, item.tekst),
        door: getAddressDoor(address, item.tekst),
        postal_number: address.postnr || null,
        postal_name: address.postnrnavn || null,
        municipality_code: address.kommunekode || null,
        municipality_name: address.kommunenavn || null,
        coordinates: Array.isArray(address.adgangspunkt?.koordinater)
            ? address.adgangspunkt.koordinater
            : null
    };

    addressInput.value = getSelectedStreetAddressLabel();
    fillAddressDerivedFields();
    hideAddressDropdown(dropdown);
}

function hideAddressDropdown(dropdown) {
    dropdown.style.display = "none";
}

function setupRoomImageHandling(roomElement, form) {
    const roomId = roomElement.dataset.roomId;
    const input = roomElement.querySelector("[data-room-images]");
    const uploadZone = roomElement.querySelector("[data-upload-zone]");
    const previewContainer = roomElement.querySelector("[data-image-previews]");
    if (!input || !uploadZone || !previewContainer) return;

    input.addEventListener("change", () => {
        addImages(roomId, [...input.files], previewContainer, form);
        input.value = "";
    });

    ["dragenter", "dragover"].forEach(eventName => {
        uploadZone.addEventListener(eventName, event => {
            event.preventDefault();
            uploadZone.classList.add("border-primary");
        });
    });

    ["dragleave", "drop"].forEach(eventName => {
        uploadZone.addEventListener(eventName, event => {
            event.preventDefault();
            uploadZone.classList.remove("border-primary");
        });
    });

    uploadZone.addEventListener("drop", event => {
        addImages(roomId, [...event.dataTransfer.files], previewContainer, form);
    });

    previewContainer.addEventListener("click", event => {
        const button = event.target.closest("[data-remove-rent-room-saved-image]");
        if (!button) return;

        const index = Number(button.dataset.removeRentRoomSavedImage);
        const state = roomStates.get(roomId);
        if (!Number.isInteger(index) || !state?.savedImageNames[index]) return;

        state.savedImageNames.splice(index, 1);
        renderImagePreviews(roomId, previewContainer);
        saveDraft(form);
    });
}

async function addImages(roomId, files, previewContainer, form) {
    const state = roomStates.get(roomId);
    if (!state) return;

    if (!isLoggedIn()) {
        saveDraft(form);
        displayLoginModal("udlej_vaerelse", new URLSearchParams());
        return;
    }

    const validImages = files.filter(file => file.type.startsWith("image/"));
    if (validImages.length !== files.length) {
        displayErrorMessage("Du kan kun vælge billeder i JPG-, PNG- eller WebP-format.");
    }

    const availableSlots = MAX_IMAGES - state.images.length - state.savedImageNames.length;
    const filesToUpload = validImages.slice(0, Math.max(0, availableSlots));
    if (validImages.length > availableSlots) {
        displayErrorMessage(`Du kan højst vælge ${MAX_IMAGES} billeder pr. værelse.`);
    }

    for (const file of filesToUpload) {
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            displayErrorMessage(`${file.name} er for stort. Vælg et billede under 12 MB.`);
            continue;
        }

        const uploadingImage = {
            file,
            previewUrl: URL.createObjectURL(file),
            isUploading: true
        };

        state.images.push(uploadingImage);
        renderImagePreviews(roomId, previewContainer);

        try {
            const optimizedFile = await optimizeImageForUpload(file);
            const uploadedImage = await uploadRoomImage(optimizedFile);
            state.savedImageNames.push(uploadedImage.name);
            state.images = state.images.filter(image => image !== uploadingImage);
            URL.revokeObjectURL(uploadingImage.previewUrl);
            renderImagePreviews(roomId, previewContainer);
            saveDraft(form);
        } catch (error) {
            console.error("Kunne ikke uploade værelsesbillede:", error);
            displayErrorMessage(`Kunne ikke uploade ${file.name}`);
            state.images = state.images.filter(image => image !== uploadingImage);
            URL.revokeObjectURL(uploadingImage.previewUrl);
            renderImagePreviews(roomId, previewContainer);
        }
    }
}

async function uploadRoomImage(file) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await authFetch("/roomies/images/upload", {
        method: "POST",
        body: formData
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.detail || body.message || "Upload fejlede");
    }

    if (!body.name) {
        throw new Error("Upload mangler filnavn");
    }

    return body;
}

function optimizeImageForUpload(file) {
    if (!file?.type?.startsWith("image/")) {
        return Promise.resolve(file);
    }

    if (file.type === "image/svg+xml") {
        return Promise.resolve(file);
    }

    return new Promise(resolve => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);

        const finish = optimizedFile => {
            URL.revokeObjectURL(objectUrl);
            resolve(optimizedFile || file);
        };

        image.onload = () => {
            try {
                const {width, height} = getOptimizedImageDimensions(image.width, image.height);
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;

                const context = canvas.getContext("2d");
                if (!context) {
                    finish(file);
                    return;
                }

                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = "high";
                context.drawImage(image, 0, 0, width, height);

                canvas.toBlob(blob => {
                    canvas.width = 0;
                    canvas.height = 0;

                    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) {
                        finish(file);
                        return;
                    }

                    finish(new File([blob], getOptimizedImageFileName(file), {
                        type: blob.type || "image/webp",
                        lastModified: Date.now()
                    }));
                }, "image/webp", IMAGE_OPTIMIZATION_QUALITY);
            } catch (error) {
                console.warn("Kunne ikke optimere billede i browseren. Bruger originalfil.", error);
                finish(file);
            }
        };

        image.onerror = () => finish(file);
        image.src = objectUrl;
    });
}

function getOptimizedImageDimensions(width, height) {
    if (!width || !height) {
        return {width, height};
    }

    if (width <= IMAGE_OPTIMIZATION_MAX_EDGE && height <= IMAGE_OPTIMIZATION_MAX_EDGE) {
        return {width, height};
    }

    if (width >= height) {
        return {
            width: IMAGE_OPTIMIZATION_MAX_EDGE,
            height: Math.max(1, Math.round((height / width) * IMAGE_OPTIMIZATION_MAX_EDGE))
        };
    }

    return {
        width: Math.max(1, Math.round((width / height) * IMAGE_OPTIMIZATION_MAX_EDGE)),
        height: IMAGE_OPTIMIZATION_MAX_EDGE
    };
}

function getOptimizedImageFileName(file) {
    const baseName = String(file.name || "billede").replace(/\.[^/.]+$/, "");
    return `${baseName}.webp`;
}

function renderImagePreviews(roomId, container) {
    const state = roomStates.get(roomId);
    if (!state || !container) return;

    const savedImages = state.savedImageNames.map((imageName, index) => `
        <div class="col-6 col-md-3">
            <div class="position-relative ratio ratio-1x1 rounded-4 overflow-hidden bg-light">
                <img src="${buildUploadedRoomImageUrl(imageName)}" alt="Uploadet billede ${index + 1}" class="w-100 h-100 object-fit-cover">
                <button type="button"
                        class="btn btn-dark rounded-circle position-absolute top-0 end-0 m-2 d-inline-flex align-items-center justify-content-center"
                        style="width: 34px; height: 34px;"
                        data-remove-rent-room-saved-image="${index}"
                        aria-label="Fjern billede ${index + 1}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `).join("");

    const uploadingImages = state.images.map((image, index) => `
        <div class="col-6 col-md-3">
            <div class="position-relative ratio ratio-1x1 rounded-4 overflow-hidden bg-light rent-room-uploading-image">
                <img src="${image.previewUrl}" alt="Uploader billede ${index + 1}" class="w-100 h-100 object-fit-cover">
                <div class="position-absolute top-50 start-50 translate-middle">
                    <div class="spinner-border text-primary-coral" role="status" aria-label="Uploader billede"></div>
                </div>
            </div>
        </div>
    `).join("");

    container.innerHTML = savedImages + uploadingImages;
}

function buildUploadedRoomImageUrl(imageName) {
    if (!imageName) return "";
    const value = String(imageName);
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    return `${s3Url}/${value.replace(/^\/+/, "")}`;
}

async function handleRentRoomSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    form.classList.add("was-validated");

    for (const step of [0, 1, 2]) {
        showRentRoomStep(form, step);
        if (!validateRentRoomStep(form, step)) {
            return;
        }
    }

    const draft = buildRentRoomDraft(form);
    saveDraft(form);

    if (!isLoggedIn()) {
        displayLoginModal("udlej_vaerelse", new URLSearchParams());
        return;
    }

    if (hasPendingRoomImageUploads()) {
        showRentRoomStep(form, 2);
        displayErrorMessage("Vent lige til billederne er uploadet, før du udgiver annoncen.");
        return;
    }

    // Nudge users with an empty profile to complete it before publishing. If they
    // dismiss the modal we abort (the draft is already saved, so nothing is lost).
    if (!(await ensureRoomieProfile("publish"))) return;

    const profilePhoto = getUserProfilePhoto();
    const listings = buildIndependentListingPayloads(draft, profilePhoto);

    const submitButton = form.querySelector('[type="submit"]');
    setRentRoomSubmitBusy(submitButton, true);

    try {
        const createdRooms = await createRoomListings(listings);
        mergeCreatedRoomsIntoCache(createdRooms);
        clearRentRoomDraft();
        const updatedCount = listings.filter(listing => listing.backend_room_id).length;
        const createdCount = listings.length - updatedCount;

        const message = updatedCount > 0 && createdCount === 0
            ? (createdRooms.length === 1 ? "Din annonce er opdateret." : `Dine ${createdRooms.length} annoncer er opdateret.`)
            : (createdRooms.length === 1 ? "Din annonce er gemt." : `Dine ${createdRooms.length} annoncer er gemt.`);

        displaySuccessMessage(message, 7000);
        if (createdCount > 0) {
            showListingSuccessModal(getRoomId(createdRooms[0]), createdRooms.length);
        }
    } catch (error) {
        console.error("Kunne ikke oprette værelse-annonce:", error);
        displayErrorMessage(error.message || "Kunne ikke oprette annoncen lige nu.");
    } finally {
        setRentRoomSubmitBusy(submitButton, false, form);
    }
}

function showListingSuccessModal(roomId, createdCount = 1, wasUpdate = false) {
    if (!roomId) return;

    const modalElement = document.getElementById("listingSuccessModal");
    const copyButton = document.getElementById("btn-copy-listing-link");
    const goButton = document.getElementById("btn-go-to-listing");
    const intro = document.getElementById("listingSuccessModalIntro");
    if (!modalElement || !copyButton || !goButton) return;

    const roomParams = new URLSearchParams({id: roomId});
    const liveUrl = `${window.location.origin}/vaerelse?${roomParams.toString()}`;
    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);

    if (intro) {
        const verb = wasUpdate ? "opdateret" : "oprettet";
        intro.innerHTML = createdCount === 1
            ? `Dit værelse er nu ${verb} og <span class="fw-bold text-success">synligt for boligsøgende</span>.`
            : `Dine ${createdCount} værelser er nu ${verb} og <span class="fw-bold text-success">synlige for boligsøgende</span>.`;
    }

    copyButton.classList.remove("btn-success");
    copyButton.classList.add("btn-primary-coral");
    copyButton.innerHTML = '<i class="fa-solid fa-link me-2"></i>Kopier link til annonce';
    copyButton.onclick = async () => {
        try {
            await navigator.clipboard.writeText(liveUrl);
            copyButton.innerHTML = '<i class="fa-solid fa-check me-2"></i>Link kopieret!';
            copyButton.classList.remove("btn-primary-coral");
            copyButton.classList.add("btn-success");
        } catch (error) {
            console.error("Kunne ikke kopiere link:", error);
            displayErrorMessage("Kunne ikke kopiere linket automatisk.");
        }
    };

    goButton.onclick = () => {
        modal.hide();
        showView("room_detail", roomParams);
    };

    modal.show();
}

function getRoomId(room) {
    return String(room?._id || room?.id || "");
}

function setRentRoomSubmitBusy(button, isBusy, form = null) {
    if (!button) return;

    if (isBusy) {
        button.dataset.originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Opretter...';
        return;
    }

    button.disabled = false;
    if (form) {
        updateRentRoomSubmitLabel(form);
    } else {
        button.innerHTML = button.dataset.originalText || '<i class="fa-solid fa-check me-2"></i>Opret opslag';
    }
}

async function createRoomListings(listings) {
    const createdRooms = [];

    for (const listing of listings) {
        const {backend_room_id: backendRoomId, ...payload} = listing;
        const url = backendRoomId
            ? `/roomies/rooms/${encodeURIComponent(backendRoomId)}`
            : "/roomies/rooms";

        const response = await authFetch(url, {
            method: backendRoomId ? "PUT" : "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body.detail || body.message || `Serveren svarede med status ${response.status}.`);
        }

        createdRooms.push(body);
    }

    return createdRooms;
}

function mergeCreatedRoomsIntoCache(createdRooms) {
    mergeRoomsIntoCaches(createdRooms);
}

function hasPendingRoomImageUploads() {
    return [...roomStates.values()].some(state => state.images.length > 0);
}

function getUserProfilePhoto(user = currentUser) {
    const profilePhoto = user?.roomie_profile?.profile_photo;
    return typeof profilePhoto === "string" && profilePhoto.trim() ? profilePhoto.trim() : null;
}

function saveDraft(form) {
    try {
        localStorage.setItem(RENT_ROOM_DRAFT_KEY, JSON.stringify(buildRentRoomDraft(form)));
        localStorage.setItem(RENT_ROOM_DRAFT_OWNER_KEY, isLoggedIn() ? getCurrentUserId() : "");
    } catch (error) {
        console.warn("Kunne ikke gemme værelseskladde:", error);
    }
}

function clearRentRoomDraft() {
    localStorage.removeItem(RENT_ROOM_DRAFT_KEY);
    localStorage.removeItem(RENT_ROOM_DRAFT_OWNER_KEY);
}

function readDraft() {
    const rawDraft = localStorage.getItem(RENT_ROOM_DRAFT_KEY);
    if (!rawDraft) return null;

    try {
        return JSON.parse(rawDraft);
    } catch (error) {
        console.warn("Kunne ikke gendanne værelseskladde:", error);
        localStorage.removeItem(RENT_ROOM_DRAFT_KEY);
        return null;
    }
}

async function getInitialRentRoomDraft() {
    const localDraft = readDraft();
    if (localDraft) {
        // A draft saved by a different user must not carry over (it would leak their
        // listing text and, worse, their backend room ids — turning "Opret" into a
        // failing "Opdater" against a room this user doesn't own).
        if (await draftBelongsToDifferentUser()) {
            clearRentRoomDraft();
            return buildDraftFromUserRooms();
        }

        return sanitizeDraftBackendRoomIds(await attachExistingRoomIdsToDraft(localDraft));
    }

    return buildDraftFromUserRooms();
}

async function draftBelongsToDifferentUser() {
    const draftOwnerId = localStorage.getItem(RENT_ROOM_DRAFT_OWNER_KEY) || "";
    // Anonymous drafts (started before logging in) intentionally carry over to whoever
    // logs in next — that's the "fill the form, then sign up" flow.
    if (!draftOwnerId || !isLoggedIn()) return false;

    const user = await ensureCurrentUserLoaded();
    return draftOwnerId !== getCurrentUserId(user);
}

// Defensive backstop (also covers legacy drafts saved before owner tracking): never keep
// a backend_room_id the current user does not actually own, so we never PUT another
// user's room. An unowned id is dropped, making that room a fresh "Opret" instead.
async function sanitizeDraftBackendRoomIds(draft) {
    if (!draft || !Array.isArray(draft.rooms) || !draft.rooms.some(room => room.backend_room_id)) {
        return draft;
    }

    const ownedRoomIds = new Set((await getCurrentUserOwnedRoomsFromCache()).map(getRoomId));
    return {
        ...draft,
        rooms: draft.rooms.map(room => (
            room.backend_room_id && !ownedRoomIds.has(room.backend_room_id)
                ? {...room, backend_room_id: null}
                : room
        ))
    };
}

async function attachExistingRoomIdsToDraft(draft) {
    if (!draft || !Array.isArray(draft.rooms) || draft.rooms.every(room => room.backend_room_id)) {
        return draft;
    }

    const userRooms = await getCurrentUserRoomsFromCache();
    if (userRooms.length === 0) return draft;

    return {
        ...draft,
        rooms: draft.rooms.map((room, index) => ({
            ...room,
            backend_room_id: room.backend_room_id || getRoomId(userRooms[index]) || null
        }))
    };
}

async function buildDraftFromUserRooms() {
    if (!isLoggedIn()) return null;

    try {
        const userRooms = await getCurrentUserRoomsFromCache();

        if (userRooms.length === 0) return null;

        return buildDraftFromRooms(userRooms);
    } catch (error) {
        console.warn("Kunne ikke udfylde udlej-værelse formularen fra eksisterende værelser:", error);
        return null;
    }
}

async function getCurrentUserRoomsFromCache() {
    return getCurrentUserOwnedRoomsFromCache();
}

async function getCurrentUserOwnedRoomsFromCache() {
    if (!isLoggedIn()) return [];

    const user = await ensureCurrentUserLoaded();
    const userId = getCurrentUserId(user);
    if (!userId) return [];

    // Derive the user's rooms by filtering the shared all-rooms cache on created_by.
    // This is always correct per-user (no stale per-user cache to leak across logins).
    // Await preloadRooms() in case the startup fetch is still in flight.
    await preloadRooms();
    const rooms = getCachedRooms();
    return Array.isArray(rooms)
        ? rooms
            .filter(room => String(room?.created_by || "") === userId)
            .filter(room => room?.deleted !== true)
            .sort((a, b) => Number(a?.created || 0) - Number(b?.created || 0))
        : [];
}

async function renderRentRoomOwnerPanel() {
    const panel = document.getElementById("rent-room-owner-panel");
    if (!panel) return;

    const rooms = await getCurrentUserOwnedRoomsFromCache();
    if (!rooms.length) {
        panel.classList.add("d-none");
        panel.innerHTML = "";
        return;
    }

    panel.classList.remove("d-none");
    panel.innerHTML = `
        <div class="rent-room-owner-panel-head">
            <span><i class="fa-solid fa-key"></i> Dine værelser</span>
            <h3>Administrer dine værelser</h3>
            <p>Pause skjuler annoncen fra søgning. Udlejet viser den stadig, men slår kontakt fra.</p>
        </div>
        <div class="rent-room-owner-grid">
            ${rooms.map(renderRentRoomOwnerCard).join("")}
        </div>
    `;

    panel.onclick = async event => {
        const viewButton = event.target.closest("[data-rent-room-owner-view]");
        if (viewButton) {
            event.preventDefault();
            showView("room_detail", new URLSearchParams({id: viewButton.dataset.rentRoomOwnerView}));
            return;
        }

        const editButton = event.target.closest("[data-rent-room-owner-edit]");
        if (editButton) {
            event.preventDefault();
            document.getElementById("form-rent-room")?.scrollIntoView({behavior: "smooth", block: "start"});
            return;
        }

        const deleteButton = event.target.closest("[data-rent-room-delete]");
        if (deleteButton) {
            event.preventDefault();
            const roomId = deleteButton.dataset.rentRoomDelete;
            const room = rooms.find(candidate => getRoomId(candidate) === roomId);
            if (room) {
                openRentRoomDeleteConfirmation(room);
            }
            return;
        }

        const visibilityButton = event.target.closest("[data-rent-room-visibility-toggle]");
        const availabilityButton = event.target.closest("[data-rent-room-availability-toggle]");
        const toggleButton = visibilityButton || availabilityButton;
        if (!toggleButton) return;

        event.preventDefault();
        const roomId = visibilityButton?.dataset.rentRoomVisibilityToggle || availabilityButton?.dataset.rentRoomAvailabilityToggle;
        const room = rooms.find(candidate => getRoomId(candidate) === roomId);
        if (!room) return;

        toggleButton.disabled = true;
        toggleButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Gemmer...';

        try {
            const patch = visibilityButton
                ? {visible: room.visible === false}
                : {available: room.available === false};
            const updatedRoom = await updateRentRoomStatus(room, patch);
            mergeCreatedRoomsIntoCache([updatedRoom]);
            displaySuccessMessage(getRentRoomStatusSuccessMessage(updatedRoom, patch));
            await renderRentRoomOwnerPanel();
        } catch (error) {
            console.error("Kunne ikke opdatere opslag:", error);
            displayErrorMessage(error.message || "Kunne ikke opdatere opslaget lige nu.");
            toggleButton.disabled = false;
        }
    };
}

function renderRentRoomOwnerCard(room) {
    const roomId = getRoomId(room);
    const isHidden = room.visible === false;
    const isRented = room.available === false && room.visible !== false;
    const status = isHidden ? "På pause (skjult)" : (isRented ? "Udlejet" : "Aktiv");
    const statusClass = isHidden ? "is-paused" : (isRented ? "is-rented" : "is-active");
    const visibilityToggleLabel = isHidden ? "Gør aktiv" : "Sæt på pause";
    const visibilityToggleIcon = isHidden ? "fa-play" : "fa-pause";
    const availabilityToggleLabel = isRented ? "Mangler roomie igen" : "Markér som udlejet";
    const availabilityToggleIcon = isRented ? "fa-rotate-left" : "fa-handshake";
    const address = [
        [room.street_name, room.house_number].filter(Boolean).join(" "),
        [room.postal_number, room.postal_name].filter(Boolean).join(" ")
    ].filter(Boolean).join(", ");

    return `
        <article class="rent-room-owner-card">
            <span class="rent-room-owner-status ${statusClass}">${status}</span>
            <h4>${escapeHtml(room.title || "Værelse uden titel")}</h4>
            <p>${escapeHtml(address || "Adresse ikke angivet")}</p>
            <div class="rent-room-owner-card-actions">
                <button class="btn btn-light rounded-pill fw-bold" type="button" data-rent-room-owner-view="${escapeAttribute(roomId)}">
                    <i class="fa-regular fa-eye me-2"></i>Se annonce
                </button>
                <button class="btn btn-light rounded-pill fw-bold" type="button" data-rent-room-owner-edit>
                    <i class="fa-solid fa-pen me-2"></i>Rediger
                </button>
                <button class="btn btn-outline-secondary rounded-pill fw-bold" type="button" data-rent-room-visibility-toggle="${escapeAttribute(roomId)}">
                    <i class="fa-solid ${visibilityToggleIcon} me-2"></i>${visibilityToggleLabel}
                </button>
                <button class="btn btn-primary-coral rounded-pill fw-bold" type="button" data-rent-room-availability-toggle="${escapeAttribute(roomId)}">
                    <i class="fa-solid ${availabilityToggleIcon} me-2"></i>${availabilityToggleLabel}
                </button>
                <button class="btn btn-light rounded-pill fw-bold text-danger" type="button" data-rent-room-delete="${escapeAttribute(roomId)}">
                    <i class="fa-solid fa-trash-can me-2"></i>Slet
                </button>
            </div>
        </article>
    `;
}

async function updateRentRoomStatus(room, patch) {
    const roomId = getRoomId(room);
    const response = await authFetch(`/roomies/rooms/${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(patch)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.detail || body.message || `Serveren svarede med status ${response.status}.`);
    }

    return body;
}

function getRentRoomStatusSuccessMessage(room, patch) {
    if (Object.prototype.hasOwnProperty.call(patch, "visible")) {
        return room.visible === false ? "Opslaget er sat på pause og skjult fra søgning." : "Opslaget er aktivt igen.";
    }

    return room.available === false ? "Opslaget er markeret som udlejet." : "Opslaget er åbent for henvendelser igen.";
}

function openRentRoomDeleteConfirmation(room) {
    showConfirmationModal(
        "Slet annonce?",
        getRentRoomDeleteModalHtml(room),
        () => {
            deleteRentRoom(room)
                .then(async () => {
                    displaySuccessMessage("Annoncen er slettet.");
                    await renderRentRoomOwnerPanel();
                    await refreshRentRoomFormFromOwnerRooms();
                })
                .catch(error => {
                    console.error("Kunne ikke slette opslag:", error);
                    displayErrorMessage(error.message || "Kunne ikke slette annoncen lige nu.");
                });
        },
        "btn-danger"
    );

    const confirmButton = document.getElementById("confirmActionButton");
    if (confirmButton) {
        confirmButton.innerHTML = '<i class="fa-solid fa-trash-can me-2"></i>Slet permanent';
    }

    document.getElementById("delete-rent-room-pause-btn")?.addEventListener("click", async () => {
        try {
            const updatedRoom = await updateRentRoomStatus(room, {visible: false});
            mergeRoomsIntoCaches(updatedRoom);
            hideGenericConfirmationModal();
            displaySuccessMessage("Opslaget er sat på pause og skjult fra søgning.");
            await renderRentRoomOwnerPanel();
            await refreshRentRoomFormFromOwnerRooms();
        } catch (error) {
            console.error("Kunne ikke pause opslag:", error);
            displayErrorMessage(error.message || "Kunne ikke pause opslaget lige nu.");
        }
    });

    document.getElementById("delete-rent-room-rented-btn")?.addEventListener("click", async () => {
        try {
            const updatedRoom = await updateRentRoomStatus(room, {available: false});
            mergeRoomsIntoCaches(updatedRoom);
            hideGenericConfirmationModal();
            displaySuccessMessage("Opslaget er markeret som udlejet.");
            await renderRentRoomOwnerPanel();
            await refreshRentRoomFormFromOwnerRooms();
        } catch (error) {
            console.error("Kunne ikke markere opslag som udlejet:", error);
            displayErrorMessage(error.message || "Kunne ikke opdatere opslaget lige nu.");
        }
    });
}

function getRentRoomDeleteModalHtml(room) {
    const isHidden = room.visible === false;
    const isRented = room.available === false;

    return `
        <p class="mb-0">Er du sikker på, at du vil slette denne annonce? Det kan ikke fortrydes, og billeder samt beskrivelser fjernes fra dine opslag.</p>
        <p class="small text-muted mt-2 mb-0">Tip: Hvis værelset er udlejet, anbefaler vi at bruge "Markér som udlejet" i stedet.</p>
        <div class="d-grid gap-2 mt-4 text-start">
            <button type="button" class="btn rounded-pill py-3 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2 delete-room-soft-action" id="delete-rent-room-pause-btn" ${isHidden ? "disabled" : ""}>
                <i class="fa-solid fa-pause"></i><span>${isHidden ? "Allerede sat på pause" : "Sæt på pause i stedet"}</span>
            </button>
            <button type="button" class="btn rounded-pill py-3 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2 delete-room-rented-action" id="delete-rent-room-rented-btn" ${isRented ? "disabled" : ""}>
                <i class="fa-solid fa-handshake"></i><span>${isRented ? "Allerede markeret som udlejet" : "Markér som udlejet i stedet"}</span>
            </button>
        </div>
        <p class="small text-muted mt-4 mb-0">Slet kun annoncen, hvis den skal fjernes permanent.</p>
    `;
}

async function deleteRentRoom(room) {
    const roomId = getRoomId(room);
    const response = await authFetch(`/roomies/rooms/${encodeURIComponent(roomId)}`, {method: "DELETE"});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.detail || body.message || `Serveren svarede med status ${response.status}.`);
    }

    removeRoomsFromCaches(roomId);
    return body;
}

function hideGenericConfirmationModal() {
    const modalElement = document.getElementById("genericConfirmationModal");
    const modal = modalElement ? window.bootstrap?.Modal?.getInstance(modalElement) : null;
    if (modal) {
        modal.hide();
        return;
    }

    $("#genericConfirmationModal").modal("hide");
}

function normalizeBackendImageNames(images) {
    if (!Array.isArray(images)) return [];
    return images
        .map(image => {
            if (typeof image === "string") return image;
            if (image && typeof image === "object") return image.name || image.thumbnail_name || "";
            return "";
        })
        .filter(Boolean);
}

function getCurrentUserId(user = currentUser) {
    return String(user?._id || user?.id || "");
}

function buildDraftFromRooms(rooms) {
    const firstRoom = rooms[0] || {};
    const addressData = buildDraftAddressData(firstRoom);

    return {
        listing_type: "room_rental_collection",
        address: [firstRoom.street_name, firstRoom.house_number].filter(Boolean).join(" "),
        postal: [firstRoom.postal_number, firstRoom.postal_name].filter(Boolean).join(" "),
        floor: firstRoom.floor || "",
        address_data: addressData,
        aconto_monthly: firstRoom.acconto_monthly_price ?? null,
        pets_allowed: firstRoom.pets_allowed === true,
        washing_machine: firstRoom.washing_machine === true,
        dishwasher: firstRoom.dishwasher === true,
        preferred_gender: firstRoom.preferred_gender || null,
        preferred_age_min: firstRoom.preferred_age_min ?? null,
        preferred_age_max: firstRoom.preferred_age_max ?? null,
        rooms: rooms.map(buildRoomDraftFromBackendRoom),
        saved_at: new Date().toISOString()
    };
}

function buildDraftAddressData(room) {
    return {
        dataforsyningen_id: room.datafordeler_id || null,
        full_address: room.address || "",
        street_name: room.street_name || "",
        house_number: room.house_number || "",
        floor: room.floor || null,
        door: room.floor_side || null,
        postal_number: room.postal_number || null,
        postal_name: room.postal_name || null,
        municipality_code: null,
        municipality_name: room.city || null,
        coordinates: Array.isArray(room.location?.coordinates) ? room.location.coordinates : null
    };
}

function buildRoomDraftFromBackendRoom(room) {
    return {
        id: createRoomId(),
        backend_room_id: getRoomId(room),
        title: room.title || "",
        description: room.description || "",
        available_from: epochToDateInput(room.available_from),
        rental_period_months: room.rental_period_months ?? null,
        monthly_rent: room.monthly_price ?? null,
        deposit: room.deposit ?? null,
        prepaid_rent: room.prepaid_rent ?? null,
        size: room.square_meters ?? null,
        furnished: room.furnished === true,
        image_names: normalizeBackendImageNames(room.images)
    };
}

function epochToDateInput(epoch) {
    const number = Number(epoch);
    if (!Number.isFinite(number) || number <= 0) return "";

    const date = new Date(number * 1000);
    if (Number.isNaN(date.getTime())) return "";

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function restoreSharedDraft(form, draft) {
    if (!draft) return;

    selectedAddress = draft.address_data || null;
    const sharedFields = [
        "address",
        "postal",
        "floor",
        "aconto_monthly",
        "pets_allowed",
        "washing_machine",
        "dishwasher",
        "privacy",
        "preferred_gender",
        "preferred_age_min",
        "preferred_age_max"
    ];

    sharedFields.forEach(name => {
        const field = form.elements.namedItem(name);
        if (!field || draft[name] == null) return;

        if (field.type === "checkbox") {
            field.checked = draft[name] === true;
        } else {
            field.value = draft[name];
        }
    });

    if (selectedAddress?.dataforsyningen_id) {
        const addressInput = document.getElementById("rent_room_address");
        if (addressInput) addressInput.value = getSelectedStreetAddressLabel();
        fillAddressDerivedFields();
    }
}

function normalizeDraftRooms(draft) {
    if (Array.isArray(draft?.rooms) && draft.rooms.length > 0) {
        return draft.rooms;
    }

    if (draft && ROOM_FIELDS.some(field => draft[field] != null)) {
        return [{
            id: createRoomId(),
            backend_room_id: draft.backend_room_id || null,
            title: draft.title || "",
            description: draft.description || "",
            available_from: draft.available_from || null,
            rental_period_months: draft.rental_period_months ?? null,
            monthly_rent: draft.monthly_rent ?? null,
            deposit: draft.deposit ?? null,
            prepaid_rent: draft.prepaid_rent ?? null,
            size: draft.size ?? null,
            furnished: draft.furnished === true,
            image_names: Array.isArray(draft.image_names) ? draft.image_names : []
        }];
    }

    return [{id: createRoomId()}];
}

function buildRentRoomDraft(form) {
    const formData = new FormData(form);

    return {
        listing_type: "room_rental_collection",
        address: getString(formData, "address"),
        postal: getString(formData, "postal"),
        floor: getString(formData, "floor"),
        address_data: selectedAddress,
        aconto_monthly: getNumber(formData, "aconto_monthly"),
        pets_allowed: formData.has("pets_allowed"),
        washing_machine: formData.has("washing_machine"),
        dishwasher: formData.has("dishwasher"),
        privacy: formData.has("privacy"),
        privacy_focused: formData.has("privacy"),
        preferred_gender: getString(formData, "preferred_gender") || null,
        preferred_age_min: getNumber(formData, "preferred_age_min"),
        preferred_age_max: getNumber(formData, "preferred_age_max"),
        rooms: [...document.querySelectorAll("#rent-room-list [data-room-id]")].map(buildRoomDraft),
        saved_at: new Date().toISOString()
    };
}

function buildRoomDraft(roomElement) {
    const roomId = roomElement.dataset.roomId;
    const state = roomStates.get(roomId);

    return {
        id: roomId,
        backend_room_id: roomElement.dataset.backendRoomId || null,
        title: getRoomString(roomElement, "title"),
        description: getRoomString(roomElement, "description"),
        available_from: getRoomString(roomElement, "available_from") || null,
        rental_period_months: getRoomNumber(roomElement, "rental_period_months"),
        monthly_rent: getRoomNumber(roomElement, "monthly_rent"),
        deposit: getRoomNumber(roomElement, "deposit"),
        prepaid_rent: getRoomNumber(roomElement, "prepaid_rent"),
        size: getRoomNumber(roomElement, "size"),
        furnished: getRoomCheckbox(roomElement, "furnished"),
        image_names: [...(state?.savedImageNames || [])]
    };
}

function buildIndependentListingPayloads(draft, profilePhoto = null) {
    const addressData = draft.address_data || {};
    const sharedData = {
        datafordeler_id: addressData.dataforsyningen_id || null,
        location: buildRoomLocation(addressData),
        postal_number: toNullableNumber(addressData.postal_number),
        postal_name: addressData.postal_name || null,
        street_name: addressData.street_name || null,
        house_number: addressData.house_number || null,
        city: addressData.municipality_name || addressData.postal_name || null,
        address: addressData.full_address || draft.address || null,
        floor: addressData.floor || draft.floor || null,
        floor_side: addressData.door || null,
        profile_photo: profilePhoto,
        acconto_monthly_price: draft.aconto_monthly,
        pets_allowed: draft.pets_allowed,
        washing_machine: draft.washing_machine,
        dishwasher: draft.dishwasher,
        preferred_gender: draft.preferred_gender,
        preferred_age_min: draft.preferred_age_min,
        preferred_age_max: draft.preferred_age_max,
        available: true,
        marketing_package: "free"
    };

    return draft.rooms.map(room => {
        return {
            backend_room_id: room.backend_room_id || null,
            title: room.title,
            description: room.description,
            monthly_price: room.monthly_rent,
            available_from: dateInputToEpoch(room.available_from),
            rental_period_months: room.rental_period_months,
            deposit: room.deposit,
            prepaid_rent: room.prepaid_rent,
            square_meters: room.size,
            images: room.image_names,
            furnished: room.furnished,
            ...sharedData,
        };
    });
}

function buildRoomLocation(addressData = {}) {
    const coordinates = Array.isArray(addressData.coordinates) ? addressData.coordinates : null;
    if (!coordinates) return null;

    return {
        type: "Point",
        coordinates
    };
}

function toNullableNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function hasSelectedOfficialAddress() {
    const addressInput = document.getElementById("rent_room_address");
    const postalInput = document.getElementById("rent_room_postal");

    return !!selectedAddress?.dataforsyningen_id
        && addressInput?.value.trim() === getSelectedStreetAddressLabel()
        && postalInput?.value.trim() === getSelectedPostalLabel();
}

function getSelectedStreetAddressLabel() {
    return [selectedAddress?.street_name, selectedAddress?.house_number].filter(Boolean).join(" ");
}

function getSelectedPostalLabel() {
    return [selectedAddress?.postal_number, selectedAddress?.postal_name].filter(Boolean).join(" ");
}

function fillAddressDerivedFields() {
    const postalInput = document.getElementById("rent_room_postal");
    const floorInput = document.getElementById("rent_room_floor");

    if (postalInput) postalInput.value = getSelectedPostalLabel();
    if (floorInput) floorInput.value = selectedAddress?.floor || "";
}

function clearAddressDerivedFields() {
    ["rent_room_postal", "rent_room_floor"].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.value = "";
    });
}

function buildFullAddress(address) {
    const streetAndNumber = [address.vejnavn, address.husnr].filter(Boolean).join(" ");
    const floorAndDoor = [getAddressFloor(address), getAddressDoor(address)].filter(Boolean).join(". ");
    const postal = [address.postnr, address.postnrnavn].filter(Boolean).join(" ");

    return [streetAndNumber, floorAndDoor, postal].filter(Boolean).join(", ");
}

function getAddressFloor(address, suggestionText = "") {
    return address.etage || parseUnitFromSuggestion(suggestionText).floor || null;
}

function getAddressDoor(address, suggestionText = "") {
    return address["dør"] || parseUnitFromSuggestion(suggestionText).door || null;
}

function parseUnitFromSuggestion(text) {
    const parts = String(text || "").split(",").map(part => part.trim()).filter(Boolean);
    if (parts.length < 3) return {floor: null, door: null};

    const unitPart = parts[1];
    const match = unitPart.match(/^([a-zæøå0-9]+)\.?\s+(.+)$/i);
    if (!match) return {floor: null, door: null};

    return {
        floor: match[1],
        door: match[2]
    };
}

function getRoomField(roomElement, name) {
    return roomElement.querySelector(`[data-room-field="${name}"]`);
}

function getRoomString(roomElement, name) {
    return String(getRoomField(roomElement, name)?.value || "").trim();
}

function getRoomNumber(roomElement, name) {
    const rawValue = getRoomField(roomElement, name)?.value;
    if (rawValue == null || rawValue === "") return null;

    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
}

function getRoomCheckbox(roomElement, name) {
    return getRoomField(roomElement, name)?.checked === true;
}

function getString(formData, name) {
    return String(formData.get(name) || "").trim();
}

function getNumber(formData, name) {
    const rawValue = formData.get(name);
    if (rawValue == null || rawValue === "") return null;

    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
}

function dateInputToEpoch(value) {
    if (!value) return null;

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;

    return Math.floor(date.getTime() / 1000);
}

function createRoomId() {
    return globalThis.crypto?.randomUUID?.() || `room-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
}
