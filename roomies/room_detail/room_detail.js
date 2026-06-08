import {getCachedRooms, getRoomById, mergeRoomsIntoCaches} from "../rooms/room_cache.js";
import {displayErrorMessage, displaySuccessMessage, ensureCurrentUserLoaded, isLoggedIn, updateMetaTags} from "../utils.js";
import {authFetch} from "../auth/auth.js";
import {s3Url} from "../config/config.js";

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

    const user = isLoggedIn() ? await ensureCurrentUserLoaded() : null;
    const isOwner = Boolean(user && String(user?._id || user?.id || "") === String(room.created_by || ""));
    const viewModel = normalizeRoomDetail(room, isOwner);
    removeExistingPhotoViewer();
    container.innerHTML = renderRoomDetailHtml(viewModel);
    setupRoomPhotoViewer(container);
    setupRoomOwnerControls(container, room, isOwner);
    updateMetaTags(
        `${viewModel.title} | roomies`,
        viewModel.description || `Ledigt værelse i ${viewModel.area}. Se pris, størrelse og hverdagen i hjemmet.`,
        `${window.location.origin}/vaerelse?id=${encodeURIComponent(viewModel.id)}`
    );
}

function normalizeRoomDetail(room, isOwner = false) {
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
        availableFrom: room.available_from ?? null,
        rentalPeriod: formatRentalPeriod(readRentalPeriodMonths(room)),
        created: room.created || null,
        available: room.available !== false,
        visible: room.visible !== false,
        isOwner,
        raw: room,
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
                <a href="/ledige-vaerelser" data-view="soeg_vaerelse" class="room-detail-back">
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>Tilbage til søgning</span>
                </a>

                ${renderOwnerPanel(room)}

                <div class="room-detail-top-grid">
                    <div class="room-detail-media-column">
                        <div class="room-detail-gallery ${secondaryImages.length ? "" : "room-detail-gallery-single"}">
                            <button class="room-detail-photo-trigger room-detail-main-photo-trigger" type="button" data-room-photo-open="0" aria-label="Vis billede 1 i fuld størrelse">
                                <img class="room-detail-main-image" src="${mainImage}" alt="${escapeHtml(room.title)}" loading="eager">
                            </button>
                            ${renderStatusBadge(room)}
                            ${renderGalleryHint(room)}
                            ${secondaryImages.length ? `
                                <div class="room-detail-side-gallery">
                                    ${secondaryImages.map((image, index) => `
                                        <button class="room-detail-photo-trigger" type="button" data-room-photo-open="${index + 1}" aria-label="Vis billede ${index + 2} i fuld størrelse">
                                            <img src="${image}" alt="${escapeHtml(`${room.title} billede ${index + 2}`)}" loading="lazy">
                                        </button>
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

                        ${renderInlineContactCta(room)}

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
        ${renderPhotoViewer(room)}
    `;
}

function renderGalleryHint(room) {
    if (room.images.length <= 1) return "";

    return `
        <button class="room-detail-gallery-hint" type="button" data-room-photo-open="0" aria-label="Se alle ${room.images.length} billeder">
            <i class="fa-regular fa-images"></i>
            <span>${room.images.length} billeder</span>
        </button>
    `;
}

function renderOwnerPanel(room) {
    if (!room.isOwner) return "";

    const isHidden = room.visible === false;
    const isRented = room.available === false && room.visible !== false;
    const statusText = isHidden ? "På pause (skjult)" : (isRented ? "Udlejet" : "Aktiv");
    const statusClass = isHidden ? "is-paused" : (isRented ? "is-rented" : "is-active");
    const visibilityText = isHidden ? "Gør aktiv" : "Sæt på pause";
    const visibilityIcon = isHidden ? "fa-play" : "fa-pause";
    const availabilityText = isRented ? "Mangler roomie igen" : "Markér som udlejet";
    const availabilityIcon = isRented ? "fa-rotate-left" : "fa-handshake";

    return `
        <section class="room-owner-panel">
            <div>
                <span><i class="fa-solid fa-key"></i> Ejerens visning</span>
                <h2>Administrer dit opslag</h2>
                <p>Pause skjuler annoncen fra søgning. Udlejet viser den stadig, men slår kontakt fra.</p>
            </div>
            <div class="room-owner-actions">
                <span class="room-owner-status ${statusClass}">${statusText}</span>
                <button class="btn btn-light rounded-pill fw-bold" type="button" data-owner-edit-room>
                    <i class="fa-solid fa-pen me-2"></i>Rediger opslag
                </button>
                <button class="btn btn-outline-secondary rounded-pill fw-bold" type="button" data-owner-toggle-visibility>
                    <i class="fa-solid ${visibilityIcon} me-2"></i>${visibilityText}
                </button>
                <button class="btn btn-primary-coral rounded-pill fw-bold" type="button" data-owner-toggle-availability>
                    <i class="fa-solid ${availabilityIcon} me-2"></i>${availabilityText}
                </button>
            </div>
        </section>
    `;
}

function setupRoomOwnerControls(container, room, isOwner) {
    if (container.__roomOwnerClickHandler) {
        container.removeEventListener("click", container.__roomOwnerClickHandler);
        container.__roomOwnerClickHandler = null;
    }

    if (!isOwner) return;

    const handler = async event => {
        const editButton = event.target.closest("[data-owner-edit-room]");
        if (editButton) {
            await openRentRoomEditView();
            return;
        }

        const visibilityButton = event.target.closest("[data-owner-toggle-visibility]");
        const availabilityButton = event.target.closest("[data-owner-toggle-availability]");
        const toggleButton = visibilityButton || availabilityButton;
        if (!toggleButton) return;

        toggleButton.disabled = true;
        toggleButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Gemmer...';

        try {
            const patch = visibilityButton
                ? {visible: room.visible === false}
                : {available: room.available === false};
            const updatedRoom = await updateRoomStatus(room, patch);
            mergeRoomsIntoCaches(updatedRoom);
            displaySuccessMessage(getRoomStatusSuccessMessage(updatedRoom, patch));
            await renderRoomDetail(getRoomId(updatedRoom));
        } catch (error) {
            console.error("Kunne ikke opdatere opslag:", error);
            displayErrorMessage(error.message || "Kunne ikke opdatere opslaget lige nu.");
            toggleButton.disabled = false;
        }
    };

    container.__roomOwnerClickHandler = handler;
    container.addEventListener("click", handler);
}

async function openRentRoomEditView() {
    if (typeof window.showView === "function") {
        await window.showView("udlej_vaerelse");
        const module = await import("../udlej_vaerelse/udlej_vaerelse.js");
        await module.refreshRentRoomFormFromOwnerRooms?.();
        return;
    }

    window.location.href = "/udlej-vaerelse";
}

async function updateRoomStatus(room, patch) {
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

function getRoomStatusSuccessMessage(room, patch) {
    if (Object.prototype.hasOwnProperty.call(patch, "visible")) {
        return room.visible === false ? "Opslaget er sat på pause og skjult fra søgning." : "Opslaget er aktivt igen.";
    }

    return room.available === false ? "Opslaget er markeret som udlejet." : "Opslaget er åbent for henvendelser igen.";
}

function getRoomId(room) {
    return String(room?._id || room?.id || "");
}

function renderPhotoViewer(room) {
    return `
        <div class="modal fade room-detail-photo-modal" data-room-photo-viewer tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-fullscreen m-0">
                <div class="modal-content border-0 rounded-0 bg-transparent">
                    <button class="room-detail-photo-viewer-back room-detail-photo-viewer-back-top" type="button" data-bs-dismiss="modal" data-room-photo-close>
                        <i class="fa-solid fa-arrow-left"></i>
                        <span>Tilbage</span>
                    </button>
                    <div class="room-detail-photo-viewer-scroll" data-room-photo-scroll>
                        ${room.images.map((image, index) => `
                            <figure class="room-detail-photo-viewer-item" data-room-photo-index="${index}">
                                <div class="room-detail-photo-viewer-frame">
                                    <img src="${image}" alt="${escapeHtml(`${room.title} billede ${index + 1}`)}">
                                </div>
                            </figure>
                        `).join("")}
                        <div class="room-detail-photo-viewer-footer">
                            <button class="room-detail-photo-viewer-back room-detail-photo-viewer-back-bottom" type="button" data-bs-dismiss="modal" data-room-photo-close>
                                <i class="fa-solid fa-arrow-left"></i>
                                <span>Tilbage</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupRoomPhotoViewer(container) {
    if (container.dataset.photoViewerBound) return;
    container.dataset.photoViewerBound = "1";

    container.addEventListener("click", event => {
        const openButton = event.target.closest("[data-room-photo-open]");
        if (openButton) {
            openPhotoViewer(container, Number(openButton.dataset.roomPhotoOpen));
        }
    });
}

function openPhotoViewer(container, index) {
    const modalEl = container.querySelector("[data-room-photo-viewer]")
        || document.querySelector("[data-room-photo-viewer]");
    if (modalEl?.parentElement !== document.body) {
        document.body.appendChild(modalEl);
    }

    const galleryEl = modalEl?.querySelector("[data-room-photo-scroll]");
    if (!modalEl || !galleryEl || !window.bootstrap?.Modal) return;

    const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
    galleryEl.scrollTop = 0;

    modalEl.addEventListener("shown.bs.modal", () => {
        const target = galleryEl.querySelector(`[data-room-photo-index="${Number.isFinite(index) ? index : 0}"]`);
        if (target) target.scrollIntoView({block: "start"});
        modalEl.querySelector("[data-room-photo-close]")?.focus();
    }, {once: true});

    modal.show();
}

function removeExistingPhotoViewer() {
    document.querySelectorAll("[data-room-photo-viewer]").forEach(viewer => {
        window.bootstrap?.Modal?.getInstance(viewer)?.hide();
        viewer.remove();
    });
}

function renderInlineContactCta(room) {
    const unavailable = room.available === false || room.visible === false;
    const unavailableText = room.visible === false ? "Annoncen er sat på pause" : "Værelset er ikke ledigt";
    const buttonText = room.isOwner ? "Rediger opslag" : (unavailable ? unavailableText : "Kontakt udlejer");
    const buttonAttrs = room.isOwner ? "data-owner-edit-room" : (unavailable ? "disabled" : "");
    const buttonIcon = room.isOwner ? "fa-solid fa-pen" : "fa-regular fa-message";

    return `
        <div class="room-detail-inline-cta">
            <div>
                <strong>${room.isOwner ? "Vil du rette noget?" : "Er værelset noget for dig?"}</strong>
                <span>${room.isOwner ? "Opdater tekst, pris, billeder eller ledighed." : "Send en besked og hør mere om hjemmet."}</span>
            </div>
            <button class="btn btn-primary-coral rounded-pill px-4 py-3 fw-bold" type="button" ${buttonAttrs}>
                <i class="${buttonIcon} me-2"></i>${buttonText}
            </button>
        </div>
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
                <a href="/ledige-vaerelser" data-view="soeg_vaerelse" class="btn btn-link text-decoration-none fw-bold p-0">Se alle</a>
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
    const unavailable = room.available === false || room.visible === false;
    const unavailableText = room.visible === false ? "Annoncen er sat på pause" : "Værelset er ikke ledigt";
    const contactText = room.isOwner ? "Rediger opslag" : (unavailable ? unavailableText : "Kontakt udlejer");
    const buttonAttrs = room.isOwner ? "data-owner-edit-room" : (unavailable ? "disabled" : "");
    const buttonIcon = room.isOwner ? "fa-solid fa-pen" : "fa-regular fa-message";

    return `
        <div class="room-detail-contact-card">
            ${renderStatusBadge(room)}
            <span>Husleje</span>
            <strong>${formatNumber(room.price)} kr./md</strong>
            <div class="room-detail-price-lines">
                <p><span>Depositum</span><b>${formatMoneyOrDash(room.deposit)}</b></p>
                <p><span>Forudbetalt leje</span><b>${formatMoneyOrDash(room.prepaidRent)}</b></p>
                <p><span>Ledig fra</span><b>${formatAvailableDate(room.availableFrom)}</b></p>
                <p><span>Lejeperiode</span><b>${escapeHtml(room.rentalPeriod)}</b></p>
                <p><span>Størrelse</span><b>${room.size ? `${formatNumber(room.size)} m²` : "-"}</b></p>
            </div>
            <button class="btn btn-primary-coral rounded-pill w-100 py-3 fw-bold" type="button" ${buttonAttrs}>
                <i class="${buttonIcon} me-2"></i>${contactText}
            </button>
            <p class="room-detail-created small text-muted text-center mb-0 mt-3">${formatCreatedDate(room.created)}</p>
            <p class="small text-muted text-center mb-0 mt-3">Kontaktflow kobles på backend, når endpointet er klar.</p>
        </div>
    `;
}

function renderStatusBadge(room) {
    if (room.visible === false) {
        return `<span class="room-detail-status room-detail-status-hidden"><i class="fa-solid fa-eye-slash"></i>På pause</span>`;
    }

    if (room.available === false) {
        return `<span class="room-detail-status room-detail-status-unavailable"><i class="fa-solid fa-handshake"></i>Udlejet</span>`;
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
    const alwaysShownFeatures = [
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
            text: room.pets_allowed ? "Kæledyr er velkomne" : "Kæledyr ikke tilladt",
            active: room.pets_allowed === true
        }
    ];

    const positiveOnlyFeatures = [
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
    ].filter(feature => feature.active);

    return [...alwaysShownFeatures, ...positiveOnlyFeatures];
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
        .filter(room => room?.visible !== false)
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
    if (typeof image === "string") return buildS3ImageUrl(image);
    if (image?.name) return buildS3ImageUrl(image.name);
    return image?.url || image?.src || image?.image_url || image?.cloudflare_url || "";
}

function buildS3ImageUrl(imageName) {
    if (!imageName) return "";
    if (/^https?:\/\//i.test(imageName)) return imageName;
    return `${s3Url}/${String(imageName).replace(/^\/+/, "")}`;
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
                    <a href="/ledige-vaerelser" data-view="soeg_vaerelse" class="btn btn-primary-coral rounded-pill px-4 py-3 fw-bold">
                        Se ledige værelser
                    </a>
                </div>
            </div>
        </section>
    `;
}

function formatAvailableDate(value) {
    const date = parseDateValue(value);
    if (Number.isNaN(date.getTime())) return "Efter aftale";
    return new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "long", year: "numeric"}).format(date);
}

function formatCreatedDate(value) {
    if (!value) return "Oprettelsesdato ikke angivet";
    const date = parseDateValue(value);
    if (Number.isNaN(date.getTime())) return "Oprettelsesdato ikke angivet";
    return `Oprettet ${new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "long", year: "numeric"}).format(date)}`;
}

function parseDateValue(value) {
    if (!value) return new Date(NaN);

    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && String(value).trim() !== "") {
        return new Date(numericValue < 10000000000 ? numericValue * 1000 : numericValue);
    }

    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T00:00:00`);
    }

    return new Date(value);
}

function formatRentalPeriod(value) {
    if (value == null || value === "") return "Ubegrænset";

    const months = Number(value);
    if (Number.isFinite(months)) {
        if (months > 0) return formatMonthPeriod(months);
        return "Efter aftale";
    }

    return String(value);
}

function formatMonthPeriod(value) {
    const totalMonths = Math.round(value);
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;

    if (years > 0 && months > 0) {
        return `${formatYearCount(years)} og ${formatMonthCount(months)}`;
    }

    if (years > 0) return formatYearCount(years);
    return formatMonthCount(totalMonths);
}

function formatYearCount(value) {
    return value === 1 ? "1 år" : `${formatNumber(value)} år`;
}

function formatMonthCount(value) {
    return value === 1 ? "1 måned" : `${formatNumber(value)} måneder`;
}

function readRentalPeriodMonths(room) {
    return room.rental_period_months ?? room.rentalPeriodMonths ?? null;
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
