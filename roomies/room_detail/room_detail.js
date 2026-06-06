import {getCachedRooms, getRoomById} from "../rooms/room_cache.js";
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
    const streetAddress = [
        room.street_name,
        room.house_number
    ].filter(Boolean).join(" ");
    const address = streetAddress || room.address || "";

    return {
        id: room._id || room.id,
        title: room.title || "Ledigt værelse",
        description: room.description || "",
        address: address || "Adresse ikke angivet",
        postal: postal || "",
        postalNumber: room.postal_number || null,
        area: room.postal_name || room.city || postal || "Område ikke angivet",
        fullAddress: [address || "Adresse ikke angivet", postal].filter(Boolean).join(", "),
        price: Number(room.monthly_price ?? room.price ?? 0),
        deposit: Number(room.deposit ?? 0),
        prepaidRent: Number(room.prepaid_rent ?? 0),
        size: Number(room.square_meters ?? 0),
        availableFrom: room.available_from || "",
        rentalPeriod: room.rental_period || "Efter aftale",
        created: room.created || null,
        available: room.available !== false,
        images: getRoomImages(room),
        householdFeatures: getHouseholdFeatures(room),
        similarRooms: getSimilarRooms(room)
    };
}

function renderRoomDetailHtml(room) {
    const mainImage = room.images[0];
    const secondaryImages = room.images.slice(1, 4);

    return `
        <section class="room-detail-page">
            <div class="container">
                <a href="/soeg-vaerelse" data-view="soeg_vaerelse" class="room-detail-back">
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>Tilbage til søgning</span>
                </a>

                <div class="room-detail-top-grid">
                    <div class="room-detail-media-column">
                        <div class="room-detail-gallery ${secondaryImages.length ? "" : "room-detail-gallery-single"}">
                            <img class="room-detail-main-image" src="${mainImage}" alt="${escapeHtml(room.title)}" loading="eager">
                            ${renderStatusBadge(room)}
                            ${secondaryImages.length ? `
                                <div class="room-detail-side-gallery">
                                    ${secondaryImages.map((image, index) => `
                                        <img src="${image}" alt="${escapeHtml(`${room.title} billede ${index + 2}`)}" loading="lazy">
                                    `).join("")}
                                </div>
                            ` : ""}
                        </div>

                        <div class="room-detail-heading">
                            <span class="room-detail-eyebrow"><i class="fa-solid fa-house-user"></i> Ledigt værelse</span>
                            <h1>${escapeHtml(room.title)}</h1>
                            <p><i class="fa-solid fa-location-dot"></i>${escapeHtml(room.fullAddress)}</p>
                        </div>

                        <div class="room-detail-mobile-card">
                            ${renderContactCard(room)}
                        </div>

                        <div class="room-detail-section">
                            <h2>Om værelset</h2>
                            <p>${escapeHtml(room.description || "Udlejer har endnu ikke skrevet en længere beskrivelse.")}</p>
                        </div>

                        <div class="room-detail-section">
                            <h2>Hverdagen i hjemmet</h2>
                            <div class="room-detail-feature-grid">
                                ${room.householdFeatures.map(renderHouseholdFeature).join("")}
                            </div>
                        </div>

                        ${renderSimilarRoomsSection(room.similarRooms)}
                    </div>
                    <div class="room-detail-sidebar-column">
                        <div class="room-detail-desktop-card">
                            ${renderContactCard(room)}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderSimilarRoomsSection(rooms) {
    if (!rooms.length) return "";

    return `
        <section class="room-detail-section room-detail-similar-section">
            <div class="d-flex align-items-end justify-content-between gap-3 mb-3">
                <div>
                    <h2 class="mb-1">Lignende værelser</h2>
                    <p class="text-muted mb-0">Andre muligheder, der kunne passe til dig.</p>
                </div>
                <a href="/soeg-vaerelse" data-view="soeg_vaerelse" class="btn btn-link text-decoration-none fw-bold p-0">Se alle</a>
            </div>
            <div class="room-detail-similar-grid">
                ${rooms.map(renderSimilarRoomCard).join("")}
            </div>
        </section>
    `;
}

function renderSimilarRoomCard(room) {
    const detailUrl = `/vaerelse?id=${encodeURIComponent(room.id)}`;
    return `
        <a href="${detailUrl}" class="room-detail-similar-card">
            <img src="${room.image}" alt="${escapeHtml(room.title)}" loading="lazy">
            <div>
                <h3>${escapeHtml(room.title)}</h3>
                <p><i class="fa-solid fa-location-dot"></i>${escapeHtml(room.postal || room.area)}</p>
                <strong>${formatNumber(room.price)} kr./md</strong>
                <span>${room.size ? `${formatNumber(room.size)} m²` : "Størrelse ikke angivet"}</span>
            </div>
        </a>
    `;
}

function renderContactCard(room) {
    const unavailable = room.available === false;
    const contactText = unavailable ? "Værelset er ikke ledigt" : "Kontakt udlejer";

    return `
        <div class="room-detail-contact-card">
            ${renderStatusBadge(room)}
            <span>Husleje</span>
            <strong>${formatNumber(room.price)} kr./md</strong>
            <div class="room-detail-price-lines">
                <p><span>Depositum</span><b>${formatMoneyOrDash(room.deposit)}</b></p>
                <p><span>Forudbetalt leje</span><b>${formatMoneyOrDash(room.prepaidRent)}</b></p>
                <p><span>Ledig fra</span><b>${formatAvailableDate(room.availableFrom)}</b></p>
                <p><span>Lejeperiode</span><b>${escapeHtml(room.rentalPeriod || "Efter aftale")}</b></p>
                <p><span>Størrelse</span><b>${room.size ? `${formatNumber(room.size)} m²` : "-"}</b></p>
            </div>
            <button class="btn btn-primary-coral rounded-pill w-100 py-3 fw-bold" type="button" ${unavailable ? "disabled" : ""}>
                <i class="fa-regular fa-message me-2"></i>${contactText}
            </button>
            <p class="room-detail-created small text-muted text-center mb-0 mt-3">${formatCreatedDate(room.created)}</p>
            <p class="small text-muted text-center mb-0 mt-3">Kontaktflow kobles på backend, når endpointet er klar.</p>
        </div>
    `;
}

function renderStatusBadge(room) {
    if (room.available === false) {
        return `<span class="room-detail-status room-detail-status-unavailable"><i class="fa-solid fa-circle-xmark"></i>Ikke ledigt</span>`;
    }
    return "";
}

function renderHouseholdFeature(feature) {
    const stateClass = feature.active ? "is-active" : "is-muted";
    return `
        <div class="room-detail-feature ${stateClass}">
            <i class="${feature.icon}"></i>
            <div>
                <strong>${escapeHtml(feature.label)}</strong>
                <span>${escapeHtml(feature.text)}</span>
            </div>
        </div>
    `;
}

function getHouseholdFeatures(room) {
    return [
        {
            icon: "fa-solid fa-couch",
            label: "Møbleret",
            text: room.furnished ? "Værelset er møbleret" : "Ikke møbleret",
            active: room.furnished === true
        },
        {
            icon: "fa-solid fa-address-card",
            label: "CPR",
            text: room.cpr_registration_allowed ? "CPR-registrering muligt" : "CPR ikke angivet som muligt",
            active: room.cpr_registration_allowed === true
        },
        {
            icon: "fa-solid fa-paw",
            label: "Kæledyr",
            text: room.pets_allowed ? "Kæledyr er velkomne" : "Kæledyr ikke angivet som muligt",
            active: room.pets_allowed === true
        },
        {
            icon: "fa-solid fa-broom",
            label: "Rengøring",
            text: room.cleaning_plan ? "Der er en rengøringsplan" : "Rengøring aftales løbende",
            active: room.cleaning_plan === true
        },
        {
            icon: "fa-solid fa-utensils",
            label: "Fællesspisning",
            text: room.communal_dinners ? "Der spises sammen i hjemmet" : "Fællesspisning er ikke fast",
            active: room.communal_dinners === true
        },
        {
            icon: "fa-solid fa-door-closed",
            label: "Privatliv",
            text: "En lukket dør respekteres fuldt ud",
            active: room.privacy_focused === true
        }
    ];
}

function getRoomImages(room) {
    const images = Array.isArray(room.images)
        ? room.images.map(getImageUrl).filter(Boolean)
        : [];

    return images.length ? images : ["/pics/udlej-vaerelse-example-room.png"];
}

function getSimilarRooms(currentRoom) {
    const rooms = getCachedRooms();
    if (!Array.isArray(rooms)) return [];

    const currentId = String(currentRoom._id || currentRoom.id || "");
    const candidates = rooms
        .filter(room => String(room?._id || room?.id || "") !== currentId)
        .filter(room => room?.available !== false)
        .map(normalizeSimilarRoom)
        .filter(room => room.id);

    const samePostalRooms = candidates.filter(room =>
        currentRoom.postal_number && String(room.postalNumber) === String(currentRoom.postal_number)
    );
    const fallbackRooms = candidates.filter(room =>
        !currentRoom.postal_number || String(room.postalNumber) !== String(currentRoom.postal_number)
    );

    return [...samePostalRooms, ...fallbackRooms].slice(0, 3);
}

function normalizeSimilarRoom(room) {
    const postal = [room.postal_number, room.postal_name || room.city].filter(Boolean).join(" ");
    return {
        id: room._id || room.id,
        title: room.title || "Ledigt værelse",
        postal,
        postalNumber: room.postal_number || null,
        area: room.postal_name || room.city || postal || "Område ikke angivet",
        price: Number(room.monthly_price ?? room.price ?? 0),
        size: Number(room.square_meters ?? 0),
        image: getRoomImages(room)[0]
    };
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

function formatCreatedDate(value) {
    if (!value) return "Oprettelsesdato ikke angivet";
    const timestamp = typeof value === "number" ? value * 1000 : value;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Oprettelsesdato ikke angivet";
    return `Oprettet ${new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "long", year: "numeric"}).format(date)}`;
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
