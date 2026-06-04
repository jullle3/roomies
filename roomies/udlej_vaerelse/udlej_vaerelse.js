import {
    displayErrorMessage,
    displaySuccessMessage,
    isLoggedIn
} from "../utils.js";
import {displayLoginModal} from "../views/viewManager.js";

const RENT_ROOM_DRAFT_KEY = "roomies_rent_room_draft";
const ADDRESS_AUTOCOMPLETE_URL = "https://api.dataforsyningen.dk/adresser/autocomplete";
const MAX_IMAGES = 8;
const MAX_IMAGE_SIZE_BYTES = 12 * 1024 * 1024;
const MAX_VIBES = 4;
const ROOM_FIELDS = [
    "title",
    "description",
    "available_from",
    "duration",
    "monthly_rent",
    "deposit",
    "prepaid_rent",
    "size",
    "furnished"
];

let selectedAddress = null;
let draftSaveTimeout = null;
const roomStates = new Map();

export function setupRentRoomView() {
    const form = document.getElementById("form-rent-room");
    if (!form || form.dataset.bound) return;

    form.dataset.bound = "1";

    const draft = readDraft();
    restoreSharedDraft(form, draft);
    setupRoomEditor(form, draft);
    setupAddressAutocomplete(form);
    setupDraftSaving(form);
    setupVibeLimit();

    form.addEventListener("submit", handleRentRoomSubmit);
}

function setupRoomEditor(form, draft) {
    const roomList = document.getElementById("rent-room-list");
    const addButton = document.getElementById("rent-room-add-button");
    if (!roomList || !addButton) return;

    const rooms = normalizeDraftRooms(draft);
    rooms.forEach(room => addRoom(form, room));

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
        saveDraft(form);
    });

    updateRoomHeadings();
}

function addRoom(form, room = {}) {
    const template = document.getElementById("rent-room-item-template");
    const roomList = document.getElementById("rent-room-list");
    if (!template || !roomList) return null;

    const id = room.id || createRoomId();
    const fragment = template.content.cloneNode(true);
    const roomElement = fragment.querySelector("[data-room-id]");
    roomElement.dataset.roomId = id;

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
    roomList.appendChild(fragment);
    return roomList.querySelector(`[data-room-id="${id}"]`);
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
    if (!addressInput || !postalInput) return;

    const dropdown = ensureAddressDropdown(addressInput);
    let debounceTimer = null;
    let activeRequest = null;

    addressInput.required = true;
    postalInput.required = true;
    postalInput.readOnly = true;

    addressInput.addEventListener("input", () => {
        selectedAddress = null;
        postalInput.value = "";
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
        street_name: address.vejnavn || "",
        house_number: address.husnr || "",
        floor: address.etage || null,
        door: address.dør || null,
        postal_number: address.postnr || null,
        postal_name: address.postnrnavn || null,
        municipality_code: address.kommunekode || null,
        municipality_name: address.kommunenavn || null,
        coordinates: Array.isArray(address.adgangspunkt?.koordinater)
            ? address.adgangspunkt.koordinater
            : null
    };

    addressInput.value = selectedAddress.street_name;
    postalInput.value = getSelectedPostalLabel();
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
        addImages(roomId, [...input.files], previewContainer);
        input.value = "";
        saveDraft(form);
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
        addImages(roomId, [...event.dataTransfer.files], previewContainer);
        saveDraft(form);
    });

    previewContainer.addEventListener("click", event => {
        const button = event.target.closest("[data-remove-rent-room-image]");
        if (!button) return;

        const index = Number(button.dataset.removeRentRoomImage);
        const state = roomStates.get(roomId);
        if (!Number.isInteger(index) || !state?.images[index]) return;

        URL.revokeObjectURL(state.images[index].previewUrl);
        state.images.splice(index, 1);
        renderImagePreviews(roomId, previewContainer);
        saveDraft(form);
    });
}

function addImages(roomId, files, previewContainer) {
    const state = roomStates.get(roomId);
    if (!state) return;

    const validImages = files.filter(file => file.type.startsWith("image/"));
    if (validImages.length !== files.length) {
        displayErrorMessage("Du kan kun vælge billeder i JPG-, PNG- eller WebP-format.");
    }

    const availableSlots = MAX_IMAGES - state.images.length;
    validImages.slice(0, availableSlots).forEach(file => {
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            displayErrorMessage(`${file.name} er for stort. Vælg et billede under 12 MB.`);
            return;
        }

        state.images.push({
            file,
            previewUrl: URL.createObjectURL(file)
        });
    });

    if (validImages.length > availableSlots) {
        displayErrorMessage(`Du kan højst vælge ${MAX_IMAGES} billeder pr. værelse.`);
    }

    renderImagePreviews(roomId, previewContainer);
}

function renderImagePreviews(roomId, container) {
    const state = roomStates.get(roomId);
    if (!state) return;

    container.innerHTML = state.images.map((image, index) => `
        <div class="col-6 col-md-3">
            <div class="position-relative ratio ratio-1x1 rounded-4 overflow-hidden bg-light">
                <img src="${image.previewUrl}" alt="Valgt billede ${index + 1}" class="w-100 h-100 object-fit-cover">
                <button type="button"
                        class="btn btn-dark rounded-circle position-absolute top-0 end-0 m-2 d-inline-flex align-items-center justify-content-center"
                        style="width: 34px; height: 34px;"
                        data-remove-rent-room-image="${index}"
                        aria-label="Fjern billede ${index + 1}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `).join("");
}

function setupVibeLimit() {
    const vibeInputs = [...document.querySelectorAll('#form-rent-room input[name="vibes"]')];

    vibeInputs.forEach(input => {
        input.addEventListener("change", () => {
            const selected = vibeInputs.filter(candidate => candidate.checked);
            if (selected.length <= MAX_VIBES) return;

            input.checked = false;
            displayErrorMessage(`Vælg højst ${MAX_VIBES} roomie-vibes.`);
        });
    });
}

function handleRentRoomSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    form.classList.add("was-validated");

    if (!form.reportValidity()) {
        form.querySelector(":invalid")?.focus();
        displayErrorMessage("Tjek de markerede felter, før du fortsætter.");
        return;
    }

    if (!hasSelectedOfficialAddress()) {
        document.getElementById("rent_room_address")?.focus();
        displayErrorMessage("Vælg adressen fra listen, så vi kan placere værelserne korrekt.");
        return;
    }

    const draft = buildRentRoomDraft(form);
    const listings = buildIndependentListingPayloads(draft);
    saveDraft(form);

    if (!isLoggedIn()) {
        displayLoginModal("udlej_vaerelse", new URLSearchParams());
        return;
    }

    const message = listings.length === 1
        ? "Din værelse-annonce er gemt som kladde. Vi kobler den på oprettelsesflowet, når backend er klar."
        : `Dine ${listings.length} værelse-annoncer er gemt som kladde. Vi kobler dem på oprettelsesflowet, når backend er klar.`;

    displaySuccessMessage(message, 7000);
}

function saveDraft(form) {
    try {
        localStorage.setItem(RENT_ROOM_DRAFT_KEY, JSON.stringify(buildRentRoomDraft(form)));
    } catch (error) {
        console.warn("Kunne ikke gemme værelseskladde:", error);
    }
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

function restoreSharedDraft(form, draft) {
    if (!draft) return;

    selectedAddress = draft.address_data || null;
    const sharedFields = [
        "address",
        "postal",
        "roommates",
        "shared_spaces",
        "utilities_included",
        "registration_allowed"
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

    const vibes = Array.isArray(draft.vibes) ? draft.vibes : [];
    form.querySelectorAll('input[name="vibes"]').forEach(input => {
        input.checked = vibes.includes(input.value);
    });
}

function normalizeDraftRooms(draft) {
    if (Array.isArray(draft?.rooms) && draft.rooms.length > 0) {
        return draft.rooms;
    }

    if (draft && ROOM_FIELDS.some(field => draft[field] != null)) {
        return [{
            id: createRoomId(),
            title: draft.title || "",
            description: draft.description || "",
            available_from: draft.available_from || null,
            duration: draft.duration || null,
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
        address_data: selectedAddress,
        roommates: getNumber(formData, "roommates"),
        shared_spaces: getString(formData, "shared_spaces"),
        utilities_included: formData.has("utilities_included"),
        registration_allowed: formData.has("registration_allowed"),
        vibes: formData.getAll("vibes").map(String),
        rooms: [...document.querySelectorAll("#rent-room-list [data-room-id]")].map(buildRoomDraft),
        saved_at: new Date().toISOString()
    };
}

function buildRoomDraft(roomElement) {
    const roomId = roomElement.dataset.roomId;
    const state = roomStates.get(roomId);

    return {
        id: roomId,
        title: getRoomString(roomElement, "title"),
        description: getRoomString(roomElement, "description"),
        available_from: getRoomString(roomElement, "available_from") || null,
        duration: getRoomString(roomElement, "duration") || null,
        monthly_rent: getRoomNumber(roomElement, "monthly_rent"),
        deposit: getRoomNumber(roomElement, "deposit"),
        prepaid_rent: getRoomNumber(roomElement, "prepaid_rent"),
        size: getRoomNumber(roomElement, "size"),
        furnished: getRoomCheckbox(roomElement, "furnished"),
        image_names: [
            ...(state?.savedImageNames || []),
            ...(state?.images || []).map(image => image.file.name)
        ]
    };
}

function buildIndependentListingPayloads(draft) {
    const sharedData = {
        address: draft.address,
        postal: draft.postal,
        address_data: draft.address_data,
        roommates: draft.roommates,
        shared_spaces: draft.shared_spaces,
        utilities_included: draft.utilities_included,
        registration_allowed: draft.registration_allowed,
        vibes: draft.vibes
    };

    return draft.rooms.map(room => {
        const {id, ...roomListingData} = room;

        return {
            listing_type: "room_rental",
            ...sharedData,
            ...roomListingData
        };
    });
}

function hasSelectedOfficialAddress() {
    const addressInput = document.getElementById("rent_room_address");
    const postalInput = document.getElementById("rent_room_postal");

    return !!selectedAddress?.dataforsyningen_id
        && addressInput?.value.trim() === selectedAddress.street_name
        && postalInput?.value.trim() === getSelectedPostalLabel();
}

function getSelectedPostalLabel() {
    return [selectedAddress?.postal_number, selectedAddress?.postal_name].filter(Boolean).join(" ");
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

function createRoomId() {
    return globalThis.crypto?.randomUUID?.() || `room-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
