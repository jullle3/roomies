import {getCachedRooms, getRoomById, mergeRoomsIntoCaches, removeRoomsFromCaches} from "../rooms/room_cache.js";
import {
    displayErrorMessage,
    displaySuccessMessage,
    ensureCurrentUserLoaded,
    isLoggedIn,
    showConfirmationModal,
    updateMetaTags
} from "../utils.js";
import {authFetch} from "../auth/auth.js";
import {s3Url} from "../config/config.js";
import {getPreviousView} from "../views/viewManager.js";
import {ensureRoomieProfile} from "../onboarding/roomie_onboarding.js";
import {openRoomieProfileModal} from "../profile/roomie_profile.js";

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
    setupRoomContactControls(container);
    setupRoomBackControl(container);
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
        aconto: Number(room.acconto_monthly_price ?? 0),
        // Backend computes total_monthly_price (husleje + aconto). Fall back to
        // summing locally for rooms not yet re-saved or scraped without the field.
        totalMonthlyPrice: Number(room.total_monthly_price ?? (Number(room.monthly_price ?? room.price ?? 0) + Number(room.acconto_monthly_price ?? 0))),
        deposit: Number(room.deposit ?? 0),
        prepaidRent: Number(room.prepaid_rent ?? 0),
        size: Number(room.square_meters ?? 0),
        availableFrom: room.available_from ?? null,
        rentalPeriod: formatRentalPeriod(readRentalPeriodMonths(room)),
        created: room.created || null,
        available: room.available !== false,
        visible: room.visible !== false,
        isOwner,
        ownerId: room.created_by || "",
        host: room.host_name || "",
        avatar: room.profile_photo ? buildS3ImageUrl(room.profile_photo) : "",
        raw: room,
        images: getRoomImages(room),
        householdFeatures: getHouseholdFeatures(room),
        preferences: getRoomiePreferences(room),
        similarRooms: getSimilarRooms(room)
    };
}

function renderRoomDetailHtml(room) {
    const mainImage = room.images[0];

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
                        <div class="room-detail-gallery">
                            <button class="room-detail-photo-trigger room-detail-main-photo-trigger" type="button" data-room-photo-open="0" aria-label="Vis billede 1 i fuld størrelse">
                                <img class="room-detail-main-image" src="${mainImage}" alt="${escapeHtml(room.title)}" loading="eager">
                            </button>
                            ${renderStatusBadge(room)}
                            ${renderGalleryHint(room)}
                        </div>

                        <div class="room-detail-heading">
                            <h1>${escapeHtml(room.title)}</h1>
                            <p><i class="fa-solid fa-location-dot"></i>${escapeHtml(room.fullAddress)}</p>
                        </div>

                        <div class="room-detail-mobile-card">
                            ${renderContactCard(room)}
                        </div>

                        <div class="room-detail-section">
                            <h2>Om værelset</h2>
                            <p class="room-detail-description">${escapeHtml(room.description || "Udlejer har endnu ikke skrevet en længere beskrivelse.")}</p>
                        </div>

                        ${room.householdFeatures.length ? `
                        <div class="room-detail-section">
                            <h2>Hverdagen i hjemmet</h2>
                            <div class="room-detail-feature-grid">
                                ${room.householdFeatures.map(renderHouseholdFeature).join("")}
                            </div>
                        </div>` : ""}

                        ${renderRoomiePreferencesSection(room)}

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
                <button class="btn btn-light rounded-pill fw-bold text-danger" type="button" data-owner-delete-room>
                    <i class="fa-solid fa-trash-can me-2"></i>Slet
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

        const deleteButton = event.target.closest("[data-owner-delete-room]");
        if (deleteButton) {
            openDeleteRoomConfirmation(room, {
                onDeleted: () => {
                    if (typeof window.showView === "function") {
                        window.showView("soeg_vaerelse");
                    } else {
                        window.location.href = "/ledige-vaerelser";
                    }
                }
            });
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

function setupRoomBackControl(container) {
    if (container.dataset.backBound) return;
    container.dataset.backBound = "1";

    container.addEventListener("click", event => {
        const backLink = event.target.closest(".room-detail-back");
        if (!backLink) return;

        // Arrived here from the search view → step back in history so its scroll
        // position and loaded "Vis mere" batches are restored, instead of the SPA
        // link handler navigating fresh to the top of the list.
        if (getPreviousView() === "soeg_vaerelse" && window.history.length > 1) {
            event.preventDefault();
            event.stopPropagation();
            window.history.back();
        }
    });
}

function setupRoomContactControls(container) {
    if (container.dataset.contactBound) return;
    container.dataset.contactBound = "1";

    container.addEventListener("click", async event => {
        const hostButton = event.target.closest("[data-open-host-profile]");
        if (hostButton) {
            event.preventDefault();
            openRoomieProfileModal(hostButton.dataset.ownerId);
            return;
        }

        const shareButton = event.target.closest("[data-share-room]");
        if (shareButton) {
            event.preventDefault();
            shareRoom(shareButton.dataset.shareId, shareButton.dataset.shareTitle);
            return;
        }

        const contactButton = event.target.closest("[data-contact-owner]");
        if (!contactButton) return;

        event.preventDefault();
        const {ownerId, roomId} = contactButton.dataset;

        // Logged-out users get routed through the login flow by the conversations
        // view; only nudge a logged-in user to complete their profile first.
        if (isLoggedIn() && !(await ensureRoomieProfile("contact"))) return;

        openConversationsView(ownerId, roomId);
    });
}

function openConversationsView(ownerId, roomId) {
    const params = new URLSearchParams();
    if (ownerId) params.set("modtager", ownerId);
    if (roomId) params.set("room", roomId);

    if (typeof window.showView === "function") {
        window.showView("conversations", params);
        return;
    }

    const query = params.toString();
    window.location.href = query ? `/beskeder?${query}` : "/beskeder";
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

function openDeleteRoomConfirmation(room, {onDeleted = null} = {}) {
    const roomId = getRoomId(room);
    if (!roomId) return;

    showConfirmationModal(
        "Slet annonce?",
        getDeleteRoomModalHtml(room),
        () => {
            deleteRoom(room)
                .then(() => {
                    displaySuccessMessage("Annoncen er slettet.");
                    onDeleted?.();
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

    document.getElementById("delete-room-pause-btn")?.addEventListener("click", async () => {
        try {
            const updatedRoom = await updateRoomStatus(room, {visible: false});
            mergeRoomsIntoCaches(updatedRoom);
            hideGenericConfirmationModal();
            displaySuccessMessage("Opslaget er sat på pause og skjult fra søgning.");
            await renderRoomDetail(getRoomId(updatedRoom));
        } catch (error) {
            console.error("Kunne ikke pause opslag:", error);
            displayErrorMessage(error.message || "Kunne ikke pause opslaget lige nu.");
        }
    });

    document.getElementById("delete-room-rented-btn")?.addEventListener("click", async () => {
        try {
            const updatedRoom = await updateRoomStatus(room, {available: false});
            mergeRoomsIntoCaches(updatedRoom);
            hideGenericConfirmationModal();
            displaySuccessMessage("Opslaget er markeret som udlejet.");
            await renderRoomDetail(getRoomId(updatedRoom));
        } catch (error) {
            console.error("Kunne ikke markere opslag som udlejet:", error);
            displayErrorMessage(error.message || "Kunne ikke opdatere opslaget lige nu.");
        }
    });
}

function getDeleteRoomModalHtml(room) {
    const isHidden = room.visible === false;
    const isRented = room.available === false;

    return `
        <p class="mb-0">Er du sikker på, at du vil slette denne annonce? Det kan ikke fortrydes, og billeder samt beskrivelser fjernes fra dine opslag.</p>
        <p class="small text-muted mt-2 mb-0">Tip: Hvis værelset er udlejet, anbefaler vi at bruge "Markér som udlejet" i stedet.</p>
        <div class="d-grid gap-2 mt-4 text-start">
            <button type="button" class="btn rounded-pill py-3 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2 delete-room-soft-action" id="delete-room-pause-btn" ${isHidden ? "disabled" : ""}>
                <i class="fa-solid fa-pause"></i><span>${isHidden ? "Allerede sat på pause" : "Sæt på pause i stedet"}</span>
            </button>
            <button type="button" class="btn rounded-pill py-3 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2 delete-room-rented-action" id="delete-room-rented-btn" ${isRented ? "disabled" : ""}>
                <i class="fa-solid fa-handshake"></i><span>${isRented ? "Allerede markeret som udlejet" : "Markér som udlejet i stedet"}</span>
            </button>
        </div>
        <p class="small text-muted mt-4 mb-0">Slet kun annoncen, hvis den skal fjernes permanent.</p>
    `;
}

async function deleteRoom(room) {
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

function getFirstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "";
}

// Inner HTML for the room's primary action button across all three states.
// Contact state shows "Kontakt {firstName}" with the owner's avatar inside the button.
function renderRoomActionButtonInner(room) {
    if (room.isOwner) {
        return '<i class="fa-solid fa-pen me-2"></i>Rediger opslag';
    }

    const unavailable = room.available === false || room.visible === false;
    if (unavailable) {
        const text = room.visible === false ? "Annoncen er sat på pause" : "Værelset er ikke ledigt";
        return `<i class="fa-regular fa-message me-2"></i>${text}`;
    }

    const firstName = getFirstName(room.host);
    const label = firstName ? `Kontakt ${escapeHtml(firstName)}` : "Kontakt udlejer";
    if (room.avatar) {
        return `${label}<img class="room-detail-contact-avatar ms-2" src="${room.avatar}" alt="" loading="lazy">`;
    }
    return `<i class="fa-regular fa-message me-2"></i>${label}`;
}

// Highly shareable secondary action. Lets a roomie pass the listing on, which is
// our cheapest growth channel — every share is a potential new visitor.
function renderShareRoomButton(room) {
    return `
        <button class="room-detail-share-btn rounded-pill w-100 fw-bold d-inline-flex align-items-center justify-content-center gap-2" type="button"
                data-share-room data-share-id="${escapeHtml(room.id)}" data-share-title="${escapeHtml(room.title)}">
            <i class="fa-solid fa-share-nodes"></i><span>Del værelse</span>
        </button>
    `;
}

// Native share sheet on supporting devices (mostly mobile), clipboard copy as the
// desktop fallback. A user-cancelled share sheet is silent, not an error.
async function shareRoom(roomId, title) {
    if (!roomId) return;

    const url = `${window.location.origin}/vaerelse?id=${encodeURIComponent(roomId)}`;
    const shareTitle = title || "Ledigt værelse på RoomieDanmark";

    if (navigator.share) {
        try {
            // Include the URL in `text` too: many share targets (and the sheet's
            // own "Copy" action) keep only `text` and drop the `url` field, which
            // otherwise loses the link to the room.
            await navigator.share({title: shareTitle, text: `${shareTitle} 🏠\n${url}`, url});
            return;
        } catch (error) {
            if (error?.name === "AbortError") return;
            // Any other share failure falls through to the copy fallback.
        }
    }

    try {
        await navigator.clipboard.writeText(url);
        displaySuccessMessage("Link kopieret – del det med dine venner 🔗");
    } catch (error) {
        displayErrorMessage("Kunne ikke dele lige nu. Kopiér linket fra adresselinjen.");
    }
}

function renderInlineContactCta(room) {
    const buttonAttrs = room.isOwner ? "data-owner-edit-room" : (room.available === false || room.visible === false ? "disabled" : `data-contact-owner data-owner-id="${escapeHtml(room.ownerId)}" data-room-id="${escapeHtml(room.id)}"`);

    return `
        <div class="room-detail-inline-cta-wrap">
            <div class="room-detail-inline-cta">
                <div>
                    <strong>${room.isOwner ? "Vil du rette noget?" : "Er værelset noget for dig?"}</strong>
                    <span>${room.isOwner ? "Opdater tekst, pris, billeder eller ledighed." : "Send en besked og hør mere om hjemmet."}</span>
                </div>
                <button class="btn btn-primary-coral rounded-pill px-4 py-3 fw-bold d-inline-flex align-items-center justify-content-center" type="button" ${buttonAttrs}>
                    ${renderRoomActionButtonInner(room)}
                </button>
            </div>
            ${renderShareRoomButton(room)}
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
                <a href="/ledige-vaerelser" data-view="soeg_vaerelse" class="room-detail-see-all">Se alle <i class="fa-solid fa-arrow-right"></i></a>
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

// Tappable "Udlejes af {navn}" strip that opens the host's read-only roomie profile.
// Only for visitors (the owner already has the owner panel), and only when we know
// who the owner is. An owner with no filled-out profile resolves to the modal's
// friendly empty state, so no synchronous profile lookup is needed here.
function renderHostStrip(room) {
    if (room.isOwner || !room.ownerId) return "";

    // Show only the first name — not everyone wants their full name public here.
    const name = getFirstName(room.host) || "Udlejer";
    const avatar = room.avatar
        ? `<img src="${room.avatar}" alt="" loading="lazy">`
        : `<span class="room-detail-host-avatar-fallback"><i class="fa-solid fa-user"></i></span>`;

    return `
        <button type="button" class="room-detail-host" data-open-host-profile data-owner-id="${escapeHtml(room.ownerId)}" aria-label="Se ${escapeHtml(name)}s profil">
            <span class="room-detail-host-avatar">${avatar}</span>
            <span class="room-detail-host-text">
                <span class="room-detail-host-label">Udlejes af</span>
                <strong class="room-detail-host-name">${escapeHtml(name)}</strong>
            </span>
            <span class="room-detail-host-cue">Se profil<i class="fa-solid fa-chevron-right"></i></span>
        </button>
    `;
}

function renderContactCard(room) {
    const buttonAttrs = room.isOwner ? "data-owner-edit-room" : (room.available === false || room.visible === false ? "disabled" : `data-contact-owner data-owner-id="${escapeHtml(room.ownerId)}" data-room-id="${escapeHtml(room.id)}"`);

    return `
        <div class="room-detail-contact-card">
            ${renderHostStrip(room)}
            ${renderStatusBadge(room)}
            ${renderTotalPriceBlock(room)}
            <div class="room-detail-price-lines">
                ${renderMoveInPriceLine(room)}
                <p><span>Ledig fra</span><b>${formatAvailableDate(room.availableFrom)}</b></p>
                <p><span>Lejeperiode</span><b>${escapeHtml(room.rentalPeriod)}</b></p>
                <p><span>Størrelse</span><b>${room.size ? `${formatNumber(room.size)} m²` : "-"}</b></p>
            </div>
            <button class="btn btn-primary-coral rounded-pill w-100 py-3 fw-bold d-inline-flex align-items-center justify-content-center" type="button" ${buttonAttrs}>
                ${renderRoomActionButtonInner(room)}
            </button>
            ${renderShareRoomButton(room)}
            <p class="room-detail-created small text-muted text-center mb-0 mt-3">${formatCreatedDate(room.created)}</p>
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
    // Tristate fields: show the positive (highlighted) when true, the negative
    // (muted) when the host explicitly said false, and omit the row entirely when
    // unknown (null/unset) so scraped/blank listings never claim a false "no".
    const tristateFeatures = [
        {
            icon: "fa-solid fa-couch",
            label: "Møbleret",
            value: room.furnished,
            text: room.furnished ? "Værelset er møbleret" : "Ikke møbleret"
        },
        {
            icon: "fa-solid fa-address-card",
            label: "CPR",
            value: room.cpr_registration_allowed,
            text: room.cpr_registration_allowed ? "CPR-registrering muligt" : "CPR ikke muligt"
        },
        {
            icon: "fa-solid fa-paw",
            label: "Kæledyr",
            value: room.pets_allowed,
            text: room.pets_allowed ? "Kæledyr er velkomne" : "Kæledyr ikke tilladt"
        }
    ]
        .filter(feature => feature.value === true || feature.value === false)
        .map(feature => ({...feature, active: feature.value === true}));

    const positiveOnlyFeatures = [
        {
            icon: "fa-solid fa-soap",
            label: "Vaskemaskine",
            text: "Der er vaskemaskine i hjemmet",
            active: room.washing_machine === true
        },
        {
            icon: "fa-solid fa-sink",
            label: "Opvaskemaskine",
            text: "Der er opvaskemaskine i hjemmet",
            active: room.dishwasher === true
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
    ].filter(feature => feature.active);

    return [...tristateFeatures, ...positiveOnlyFeatures];
}

// "Hvem leder vi efter" — the host's roomie preferences, rendered with the same
// feature cards as the household facts. Section is hidden entirely when no
// preference is set (common for scraped listings); within it, an unset
// dimension reads as the friendly "open" default rather than disappearing.
function renderRoomiePreferencesSection(room) {
    const prefs = room.preferences;
    if (!prefs || !prefs.hasAny) return "";

    return `
        <div class="room-detail-section">
            <h2>Hvem leder vi efter 🕵️</h2>
            <div class="room-detail-feature-grid">
                <div class="room-detail-feature ${prefs.genderSpecified ? "is-active" : "is-muted"}">
                    <i class="${prefs.gender.icon}"></i>
                    <div>
                        <strong>Køn</strong>
                        <span>${escapeHtml(prefs.gender.text)}</span>
                    </div>
                </div>
                <div class="room-detail-feature ${prefs.ageSpecified ? "is-active" : "is-muted"}">
                    <i class="${prefs.age.icon}"></i>
                    <div>
                        <strong>Alder</strong>
                        <span>${escapeHtml(prefs.age.text)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function getRoomiePreferences(room) {
    const gender = normalizeGenderPreference(room.preferred_gender);
    const ageMin = Number(room.preferred_age_min) || 0;
    const ageMax = Number(room.preferred_age_max) || 0;

    const genderText = gender === "female" ? "Søger kvindelig roomie 👩"
        : gender === "male" ? "Søger mandlig roomie 👨"
            : "Alle køn er velkomne";
    const genderIcon = gender === "female" ? "fa-solid fa-venus"
        : gender === "male" ? "fa-solid fa-mars"
            : "fa-solid fa-venus-mars";

    let ageText = "Alder er underordnet";
    if (ageMin && ageMax) ageText = `Mellem ${ageMin} og ${ageMax} år`;
    else if (ageMin) ageText = `Fra ${ageMin} år`;
    else if (ageMax) ageText = `Op til ${ageMax} år`;

    return {
        hasAny: Boolean(gender || ageMin || ageMax),
        genderSpecified: Boolean(gender),
        ageSpecified: Boolean(ageMin || ageMax),
        gender: {text: genderText, icon: genderIcon},
        age: {text: ageText, icon: "fa-solid fa-cake-candles"}
    };
}

// preferred_gender is a free string; the live form sends female/male/"" but
// seeded/scraped data may use Danish words, so normalize both to a known key.
function normalizeGenderPreference(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["female", "kvinde", "woman", "f", "k"].includes(normalized)) return "female";
    if (["male", "mand", "man", "m"].includes(normalized)) return "male";
    return "";
}

function getRoomImages(room) {
    const images = Array.isArray(room.images)
        ? room.images.map(getImageUrl).filter(Boolean)
        : [];

    return images.length ? images : ["/pics/room_default1.webp"];
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
    // Already available (date today or in the past) reads as "Ledig fra: Nu".
    if (isTodayOrPast(date)) return "Nu";
    return new Intl.DateTimeFormat("da-DK", {day: "numeric", month: "long", year: "numeric"}).format(date);
}

// True when the given date falls on or before today (compared by calendar day).
function isTodayOrPast(date) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfDate = new Date(date);
    startOfDate.setHours(0, 0, 0, 0);
    return startOfDate <= startOfToday;
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

// Headline monthly price. When there is a separate consumption charge (aconto),
// the total is expandable so users can see husleje + forbrug. Without an aconto
// the total equals the rent, so there is nothing to break down — show it plain.
function renderTotalPriceBlock(room) {
    const total = Number(room.totalMonthlyPrice) || 0;
    const rent = Number(room.price) || 0;
    const aconto = Number(room.aconto) || 0;

    if (aconto <= 0 || rent <= 0) {
        return `
            <span>Husleje</span>
            <strong>${formatNumber(total)} kr./md</strong>
        `;
    }

    return `
        <details class="room-detail-total">
            <summary>
                <span>Husleje inkl. forbrug</span>
                <strong>${formatNumber(total)} kr./md<i class="fa-solid fa-chevron-down"></i></strong>
            </summary>
            <div class="room-detail-total-breakdown">
                <p><span>Husleje</span><b>${formatNumber(rent)} kr.</b></p>
                <p><span>Forbrug (aconto)</span><b>${formatNumber(aconto)} kr.</b></p>
            </div>
        </details>
    `;
}

// One-time "indskud" (deposit + prepaid rent) shown as a single price line — the
// same concept the search filter uses, so the two never disagree. Tapping it
// expands the breakdown. Hidden when there is no up-front capital (e.g. many
// scraped ads lack deposit/prepaid data).
function renderMoveInPriceLine(room) {
    const deposit = Number(room.deposit) || 0;
    const prepaidRent = Number(room.prepaidRent) || 0;
    const price = Number(room.price) || 0;
    if (!deposit && !prepaidRent) return "";

    const total = deposit + prepaidRent;
    const depositHint = describeDepositMonths(deposit, price);
    const prepaidHint = describePrepaidMonths(prepaidRent, price);

    return `
        <details class="room-detail-movein">
            <summary>
                <span>Indskud<i class="fa-solid fa-chevron-down"></i></span>
                <b>${formatNumber(total)} kr.</b>
            </summary>
            <div class="room-detail-movein-breakdown">
                ${deposit ? `<p><span>Depositum${depositHint ? `<small>${depositHint}</small>` : ""}</span><b>${formatMoneyOrDash(deposit)}</b></p>` : ""}
                ${prepaidRent ? `<p><span>Forudbetalt leje${prepaidHint ? `<small>${prepaidHint}</small>` : ""}</span><b>${formatMoneyOrDash(prepaidRent)}</b></p>` : ""}
            </div>
        </details>
    `;
}

// "ca. 3 måneders husleje" hint — only shown when the amount divides cleanly into
// the monthly rent (within 15%), so we never display a misleading fraction.
function describeDepositMonths(deposit, price) {
    const months = monthsOfRent(deposit, price);
    if (!months) return "";
    return months === 1 ? "1 måneds husleje" : `${formatNumber(months)} måneders husleje`;
}

function describePrepaidMonths(prepaidRent, price) {
    const months = monthsOfRent(prepaidRent, price);
    return months ? formatMonthCount(months) : "";
}

function monthsOfRent(amount, price) {
    if (!amount || !price) return 0;
    const months = Math.round(amount / price);
    if (months < 1) return 0;
    if (Math.abs(amount - months * price) > price * 0.15) return 0;
    return months;
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
