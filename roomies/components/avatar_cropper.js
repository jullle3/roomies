// Circular avatar cropper built on Cropper.js, which is loaded as a global
// (window.Cropper) via a CDN <script> in index.html — the same pattern used for
// bootstrap/pica. Opens a modal, lets the user zoom/drag a fixed square crop so
// their face is in focus, and resolves a cropped File ready for upload.
//
// Resolves:
//   - a File           when the user confirms the crop
//   - null             when the user cancels/closes the modal
// Callers should check isAvatarCropperAvailable() first and fall back to the
// original file when the library failed to load, so cropping stays optional.

const OUTPUT_SIZE = 800;          // px; square written to the upload
const OUTPUT_TYPE = "image/webp"; // backend re-encodes to webp anyway
const OUTPUT_QUALITY = 0.92;

let modalEl = null;
let modalInstance = null;
let cropper = null;
let imgEl = null;
let objectUrl = null;
let activeResolve = null;
let pendingResult = null;

export function isAvatarCropperAvailable() {
    return typeof window !== "undefined" && typeof window.Cropper === "function";
}

export function cropAvatarFile(file) {
    return new Promise(resolve => {
        if (!file || !isAvatarCropperAvailable() || !window.bootstrap?.Modal) {
            resolve(null);
            return;
        }

        // A second open while one is in flight just cancels the previous one.
        if (activeResolve) {
            const previous = activeResolve;
            activeResolve = null;
            previous(null);
        }

        activeResolve = resolve;
        pendingResult = null;

        ensureModal();

        objectUrl = URL.createObjectURL(file);
        imgEl.src = objectUrl;

        modalInstance.show();
    });
}

function ensureModal() {
    if (modalEl) return;

    modalEl = document.createElement("div");
    modalEl.className = "modal fade avatar-cropper-modal";
    modalEl.tabIndex = -1;
    modalEl.setAttribute("aria-hidden", "true");
    modalEl.innerHTML = `
        <div class="modal-dialog modal-dialog-centered avatar-cropper-dialog">
            <div class="modal-content avatar-cropper-content border-0">
                <div class="avatar-cropper-header">
                    <h3>Beskær dit billede</h3>
                    <p>Zoom og flyt, så dit ansigt er i fokus 👤</p>
                </div>
                <div class="avatar-cropper-stage">
                    <img data-avatar-cropper-img alt="">
                </div>
                <div class="avatar-cropper-actions">
                    <button type="button" class="btn rounded-pill fw-bold avatar-cropper-cancel" data-bs-dismiss="modal">Annullér</button>
                    <button type="button" class="btn btn-primary-coral rounded-pill fw-bold avatar-cropper-confirm">Brug billede</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);

    imgEl = modalEl.querySelector("[data-avatar-cropper-img]");
    modalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);

    modalEl.addEventListener("shown.bs.modal", initCropper);
    modalEl.addEventListener("hidden.bs.modal", teardown);
    modalEl.querySelector(".avatar-cropper-confirm").addEventListener("click", confirmCrop);
}

function initCropper() {
    destroyCropper();
    // Fixed square crop box; the user moves/zooms the image underneath — the
    // familiar avatar-cropping interaction.
    cropper = new window.Cropper(imgEl, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: "move",
        autoCropArea: 1,
        background: false,
        guides: false,
        center: false,
        highlight: false,
        rotatable: false,
        scalable: false,
        cropBoxMovable: false,
        cropBoxResizable: false,
        toggleDragModeOnDblclick: false,
        minContainerHeight: 320
    });
}

function confirmCrop() {
    if (!cropper) {
        modalInstance.hide();
        return;
    }

    const canvas = cropper.getCroppedCanvas({
        width: OUTPUT_SIZE,
        height: OUTPUT_SIZE,
        imageSmoothingQuality: "high"
    });

    if (!canvas) {
        modalInstance.hide();
        return;
    }

    canvas.toBlob(blob => {
        pendingResult = blob ? new File([blob], `avatar-${Date.now()}.webp`, {type: OUTPUT_TYPE}) : null;
        modalInstance.hide();
    }, OUTPUT_TYPE, OUTPUT_QUALITY);
}

// Runs on every close (confirm, cancel, backdrop, Esc) — single place to clean
// up and settle the promise with whatever the result turned out to be.
function teardown() {
    destroyCropper();

    if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
    }
    imgEl.removeAttribute("src");

    const resolve = activeResolve;
    const result = pendingResult;
    activeResolve = null;
    pendingResult = null;
    if (resolve) resolve(result);
}

function destroyCropper() {
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
}
