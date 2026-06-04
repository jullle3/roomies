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

let selectedAddress = null;
let selectedImages = [];
let draftSaveTimeout = null;

export function setupRentRoomView() {
    const form = document.getElementById("form-rent-room");
    if (!form || form.dataset.bound) return;

    form.dataset.bound = "1";

    restoreDraft(form);
    setupAddressAutocomplete(form);
    setupDraftSaving(form);
    setupImageHandling();
    setupVibeLimit();

    form.addEventListener("submit", handleRentRoomSubmit);
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

    // The full official address stays in the draft, while the public field only
    // displays the street name as promised by the privacy copy in the form.
    addressInput.value = selectedAddress.street_name;
    postalInput.value = getSelectedPostalLabel();
    hideAddressDropdown(dropdown);
}

function hideAddressDropdown(dropdown) {
    dropdown.style.display = "none";
}

function setupImageHandling() {
    const input = document.getElementById("rent_room_images");
    const uploadZone = document.querySelector(".rent-room-upload-zone");
    if (!input || !uploadZone) return;

    const previewContainer = ensureImagePreviewContainer(input);

    input.addEventListener("change", () => {
        addImages([...input.files], previewContainer);
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
        addImages([...event.dataTransfer.files], previewContainer);
    });

    previewContainer.addEventListener("click", event => {
        const button = event.target.closest("[data-remove-rent-room-image]");
        if (!button) return;

        const index = Number(button.dataset.removeRentRoomImage);
        if (!Number.isInteger(index) || !selectedImages[index]) return;

        URL.revokeObjectURL(selectedImages[index].previewUrl);
        selectedImages.splice(index, 1);
        renderImagePreviews(previewContainer);
    });
}

function addImages(files, previewContainer) {
    const validImages = files.filter(file => file.type.startsWith("image/"));
    if (validImages.length !== files.length) {
        displayErrorMessage("Du kan kun vælge billeder i JPG-, PNG- eller WebP-format.");
    }

    const availableSlots = MAX_IMAGES - selectedImages.length;
    validImages.slice(0, availableSlots).forEach(file => {
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            displayErrorMessage(`${file.name} er for stort. Vælg et billede under 12 MB.`);
            return;
        }

        selectedImages.push({
            file,
            previewUrl: URL.createObjectURL(file)
        });
    });

    if (validImages.length > availableSlots) {
        displayErrorMessage(`Du kan højst vælge ${MAX_IMAGES} billeder.`);
    }

    renderImagePreviews(previewContainer);
}

function ensureImagePreviewContainer(input) {
    let container = document.getElementById("rent-room-image-previews");
    if (container) return container;

    container = document.createElement("div");
    container.id = "rent-room-image-previews";
    container.className = "row g-3 mt-2";
    input.insertAdjacentElement("afterend", container);
    return container;
}

function renderImagePreviews(container) {
    container.innerHTML = selectedImages.map((image, index) => `
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
        displayErrorMessage("Vælg adressen fra listen, så vi kan placere værelset korrekt.");
        return;
    }

    saveDraft(form);

    if (!isLoggedIn()) {
        displayLoginModal("udlej_vaerelse", new URLSearchParams());
        return;
    }

    displaySuccessMessage("Din værelse-annonce er gemt som kladde. Vi kobler den på oprettelsesflowet, når backend er klar.", 7000);
}

function saveDraft(form) {
    try {
        localStorage.setItem(RENT_ROOM_DRAFT_KEY, JSON.stringify(buildRentRoomDraft(form)));
    } catch (error) {
        console.warn("Kunne ikke gemme værelseskladde:", error);
    }
}

function restoreDraft(form) {
    const rawDraft = localStorage.getItem(RENT_ROOM_DRAFT_KEY);
    if (!rawDraft) return;

    try {
        const draft = JSON.parse(rawDraft);
        selectedAddress = draft.address_data || null;

        Object.entries(draft).forEach(([name, value]) => {
            if (["address_data", "vibes", "image_names", "saved_at", "listing_type"].includes(name)) return;

            const field = form.elements.namedItem(name);
            if (!field) return;

            if (field.type === "checkbox") {
                field.checked = value === true;
            } else if (value != null) {
                field.value = value;
            }
        });

        const vibes = Array.isArray(draft.vibes) ? draft.vibes : [];
        form.querySelectorAll('input[name="vibes"]').forEach(input => {
            input.checked = vibes.includes(input.value);
        });
    } catch (error) {
        console.warn("Kunne ikke gendanne værelseskladde:", error);
        localStorage.removeItem(RENT_ROOM_DRAFT_KEY);
    }
}

function buildRentRoomDraft(form) {
    const formData = new FormData(form);

    return {
        listing_type: "room_rental",
        title: getString(formData, "title"),
        description: getString(formData, "description"),
        available_from: getString(formData, "available_from") || null,
        duration: getString(formData, "duration") || null,
        address: getString(formData, "address"),
        postal: getString(formData, "postal"),
        address_data: selectedAddress,
        monthly_rent: getNumber(formData, "monthly_rent"),
        deposit: getNumber(formData, "deposit"),
        prepaid_rent: getNumber(formData, "prepaid_rent"),
        utilities_included: formData.has("utilities_included"),
        size: getNumber(formData, "size"),
        roommates: getNumber(formData, "roommates"),
        shared_spaces: getString(formData, "shared_spaces"),
        furnished: formData.has("furnished"),
        registration_allowed: formData.has("registration_allowed"),
        vibes: formData.getAll("vibes").map(String),
        image_names: selectedImages.map(image => image.file.name),
        saved_at: new Date().toISOString()
    };
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

function getString(formData, name) {
    return String(formData.get(name) || "").trim();
}

function getNumber(formData, name) {
    const rawValue = formData.get(name);
    if (rawValue == null || rawValue === "") return null;

    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
}
