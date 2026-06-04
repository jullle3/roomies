import {displaySuccessMessage} from "../utils.js";

const RENT_ROOM_DRAFT_KEY = "roomies_rent_room_draft";

export function setupRentRoomView() {
    const form = document.getElementById("form-rent-room");
    if (!form) return;

    form.addEventListener("submit", handleRentRoomSubmit);
}

function handleRentRoomSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const draft = buildRentRoomDraft(form);
    localStorage.setItem(RENT_ROOM_DRAFT_KEY, JSON.stringify(draft));

    displaySuccessMessage("Din værelse-annonce er gemt som kladde. Vi kobler den på oprettelsesflowet, når backend er klar.", 7000);
}

function buildRentRoomDraft(form) {
    const formData = new FormData(form);
    const imageInput = document.getElementById("rent_room_images");

    return {
        listing_type: "room_rental",
        title: formData.get("title") || "",
        description: formData.get("description") || "",
        available_from: formData.get("available_from") || "",
        duration: formData.get("duration") || "",
        address: formData.get("address") || "",
        postal: formData.get("postal") || "",
        monthly_rent: formData.get("monthly_rent") || "",
        deposit: formData.get("deposit") || "",
        prepaid_rent: formData.get("prepaid_rent") || "",
        utilities_included: formData.has("utilities_included"),
        size: formData.get("size") || "",
        roommates: formData.get("roommates") || "",
        shared_spaces: formData.get("shared_spaces") || "",
        furnished: formData.has("furnished"),
        registration_allowed: formData.has("registration_allowed"),
        vibes: formData.getAll("vibes"),
        image_names: imageInput?.files ? Array.from(imageInput.files).map(file => file.name) : [],
        saved_at: new Date().toISOString()
    };
}
