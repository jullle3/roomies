import {getRoomById} from "../rooms/room_cache.js";
import {updateMetaTags} from "../utils.js";

export async function renderRoomDetail(roomId) {
    const container = document.getElementById("room-detail-content");
    if (!container) return;

    container.innerHTML = renderLoadingState();

    const room = await getRoomById(roomId);
    if (!room) {
        container.innerHTML = renderMissingState();
        updateMetaTags(
            "Værelse ikke fundet | roomies",
            "Værelset kunne ikke findes eller er ikke længere aktivt.",
            `${window.location.origin}/vaerelse`
        );
        return;
    }

    const viewModel = normalizeRoomDetail(room);
    container.innerHTML = renderRoomDetailHtml(viewModel);
    updateMetaTags(
        `${viewModel.title} | roomies`,
        viewModel.description || `Ledigt værelse i ${viewModel.area}. Se pris, størrelse og hverdagen i hjemmet.`,
        `${window.location.origin}/vaerelse?id=${encodeURIComponent(viewModel.id)}`
    );
}

function normalizeRoomDetail(room) {
    const postal = [room.postal_number, room.postal_name || room.city].filter(Boolean).join(" ");
    const address = room.address || [
        room.street_name,
        room.house_number,
        room.floor,
        room.floor_side
    ].filter(Boolean).join(" ");

    return {
        id: room._id || room.id,
        title: room.title || "Ledigt værelse",
        description: room.description || "",
        address: address || "Adresse ikke angivet",
        postal: postal || "",
        area: room.postal_name || room.city || postal || "Område ikke angivet",
        price: Number(room.monthly_price ?? room.price ?? 0),
        deposit: Number(room.deposit ?? 0),
        prepaidRent: Number(room.prepaid_rent ?? 0),
        size: Number(room.square_meters ?? 0),
        availableFrom: room.available_from || "",
        rentalPeriod: room.rental_period || "Efter aftale",
        rooms: Number(room.current_roomies ?? room.rooms ?? 0),
        images: getRoomImages(room),
        facts: getRoomFacts(room),
        vibes: getRoomVibes(room)
    };
}

function renderRoomDetailHtml(room) {
    const mainImage = room.images[0];
    const secondaryImages = room.images.slice(1, 4);

    return `
        <section class="room-detail-hero">
            <div class="container">
                <a href="/soeg-vaerelse" data-view="soeg_vaerelse" class="room-detail-back">
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>Tilbage til søgning</span>
                </a>

                <div class="room-detail-gallery">
                    <img class="room-detail-main-image" src="${mainImage}" alt="${escapeHtml(room.title)}" loading="eager">
                    <div class="room-detail-side-gallery">
                        ${secondaryImages.map((image, index) => `
                            <img src="${image}" alt="${escapeHtml(`${room.title} billede ${index + 2}`)}" loading="lazy">
                        `).join("")}
                    </div>
                </div>
            </div>
        </section>

        <section class="room-detail-body">
            <div class="container">
                <div class="row g-4 g-xl-5 align-items-start">
                    <div class="col-lg-8">
                        <div class="room-detail-heading">
                            <span class="room-detail-eyebrow"><i class="fa-solid fa-house-user"></i> Ledigt værelse</span>
                            <h1>${escapeHtml(room.title)}</h1>
                            <p><i class="fa-solid fa-location-dot"></i>${escapeHtml([room.address, room.postal].filter(Boolean).join(", "))}</p>
                        </div>

                        <div class="room-detail-fact-grid">
                            ${room.facts.map(fact => `
                                <div class="room-detail-fact">
                                    <i class="${fact.icon}"></i>
                                    <span>${escapeHtml(fact.label)}</span>
                                    <strong>${escapeHtml(fact.value)}</strong>
                                </div>
                            `).join("")}
                        </div>

                        <div class="room-detail-section">
                            <h2>Om værelset</h2>
                            <p>${escapeHtml(room.description || "Udlejer har endnu ikke skrevet en længere beskrivelse.")}</p>
                        </div>

                        <div class="room-detail-section">
                            <h2>Hverdagen i hjemmet</h2>
                            <div class="d-flex flex-wrap gap-2">
                                ${room.vibes.map(vibe => `<span class="vibe-tag">${escapeHtml(vibe)}</span>`).join("")}
                            </div>
                        </div>
                    </div>

                    <aside class="col-lg-4">
                        <div class="room-detail-contact-card">
                            <span>Husleje</span>
                            <strong>${formatNumber(room.price)} kr./md</strong>
                            <div class="room-detail-price-lines">
                                <p><span>Depositum</span><b>${formatMoneyOrDash(room.deposit)}</b></p>
                                <p><span>Forudbetalt leje</span><b>${formatMoneyOrDash(room.prepaidRent)}</b></p>
                                <p><span>Ledig fra</span><b>${formatAvailableDate(room.availableFrom)}</b></p>
                            </div>
                            <button class="btn btn-primary-coral rounded-pill w-100 py-3 fw-bold" type="button">
                                <i class="fa-regular fa-message me-2"></i>Kontakt udlejer
                            </button>
                            <p class="small text-muted text-center mb-0 mt-3">Kontaktflow kobles på backend, når endpointet er klar.</p>
                        </div>
                    </aside>
                </div>
            </div>
        </section>
    `;
}

function getRoomFacts(room) {
    return [
        {icon: "fa-solid fa-ruler-combined", label: "Størrelse", value: room.size ? `${room.size} m²` : "Ikke angivet"},
        {icon: "fa-regular fa-calendar", label: "Ledig fra", value: formatAvailableDate(room.availableFrom)},
        {icon: "fa-solid fa-clock", label: "Lejeperiode", value: room.rentalPeriod},
        {icon: "fa-regular fa-user", label: "Roomies", value: room.rooms ? `${room.rooms}` : "Ikke angivet"}
    ];
}

function getRoomVibes(room) {
    const vibes = [];
    if (room.furnished) vibes.push("Møbleret");
    if (room.cpr_registration_allowed) vibes.push("CPR muligt");
    if (room.pets_allowed) vibes.push("Kæledyr tilladt");
    if (room.cleaning_plan) vibes.push("Rengøringsplan");
    if (room.communal_dinners) vibes.push("Fællesspisning");
    if (room.privacy_focused) vibes.push("Ro og privatliv");
    return vibes.length ? vibes : ["Roomie-venligt hjem"];
}

function getRoomImages(room) {
    const images = Array.isArray(room.images)
        ? room.images.map(getImageUrl).filter(Boolean)
        : [];

    return images.length ? images : ["/pics/udlej-vaerelse-example-room.png"];
}

function getImageUrl(image) {
    if (typeof image === "string") return image;
    return image?.url || image?.src || image?.image_url || image?.cloudflare_url || "";
}

function renderLoadingState() {
    return `
        <section class="room-detail-body">
            <div class="container">
                <div class="room-detail-state">
                    <i class="fa-solid fa-circle-notch fa-spin"></i>
                    <p>Indlæser værelse...</p>
                </div>
            </div>
        </section>
    `;
}

function renderMissingState() {
    return `
        <section class="room-detail-body">
            <div class="container">
                <div class="room-detail-state">
                    <i class="fa-regular fa-face-frown"></i>
                    <h1>Værelset blev ikke fundet</h1>
                    <p>Det kan være fjernet eller udlejet.</p>
                    <a href="/soeg-vaerelse" data-view="soeg_vaerelse" class="btn btn-primary-coral rounded-pill px-4 py-3 fw-bold">
                        Se ledige værelser
                    </a>
                </div>
            </div>
        </section>
    `;
}

function formatAvailableDate(value) {
    if (!value) return "Efter aftale";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "Efter aftale";
    return new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "long", year: "numeric"}).format(date);
}

function formatMoneyOrDash(value) {
    return value ? `${formatNumber(value)} kr.` : "-";
}

function formatNumber(value) {
    return new Intl.NumberFormat("da-DK").format(Number(value || 0));
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
}
