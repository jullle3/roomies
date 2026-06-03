import {authFetch} from "../auth/auth.js";
import {currentUser, displayErrorMessage, displaySuccessMessage} from "../utils.js";
import {showView} from "../views/viewManager.js";

const SEND_MESSAGE_BUTTON_DEFAULT_HTML = '<i class="fa-regular fa-paper-plane me-2"></i>Send besked';

function getFirstName(fullName) {
    return (fullName || '').trim().split(/\s+/)[0] || '';
}

function buildDefaultSellerMessage(sellerName) {
    const greeting = sellerName ? `Hej ${sellerName},` : 'Hej,';
    return `${greeting}

Jeg er interesseret i din andelsbolig og vil gerne høre lidt mere om den.

Har du mulighed for at vende tilbage, så vi eventuelt kan aftale en fremvisning eller tale nærmere om boligen?

På forhånd tak.

Venlig hilsen`;
}

export async function loadSellerProfile(seller_profile_id) {
    const response = await authFetch(`/user/${seller_profile_id}`);
    if (!response.ok) {
        let body = await response.json()
        displayErrorMessage(body.detail);
        return;
    }

    // Fetch advertisement to show the full address
    const housing_detail_response = await authFetch(`/advertisement?created_by=${seller_profile_id}&full_model=true`);
    if (!housing_detail_response.ok) {
        let body = await housing_detail_response.json()
        displayErrorMessage(body.detail);
        return;
    }
    const housing_detail_page = await housing_detail_response.json();
    const address = housing_detail_page.objects[0].address
    const seller_profile = await response.json();
    const sellerFirstName = getFirstName(seller_profile.full_name);

    // Populate data
    document.getElementById('seller-fullNameNavbar-profile').textContent = seller_profile.full_name;
    document.getElementById('seller-housing-full-address').innerHTML = `<h5>Boligens adresse</h5><h3><b>${address}</b></h3>`;
    document.getElementById('seller-message-text').value = buildDefaultSellerMessage(sellerFirstName);

    // --- Interaction Logic: Send Message to Seller ---
    const sendBtn = document.getElementById('sendMessageBtn');

    // Remove old listeners to prevent duplicates if function runs multiple times
    const newSendBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
    newSendBtn.disabled = false;
    newSendBtn.innerHTML = SEND_MESSAGE_BUTTON_DEFAULT_HTML;

    newSendBtn.addEventListener("click", async () => {
        if (!currentUser?._id) {
            displayErrorMessage('Du skal være logget ind for at sende en besked.');
            return;
        }

        const msgEl = document.getElementById('seller-message-text');
        const message = msgEl.value.trim();

        if (!message) {
            displayErrorMessage('Indtast venligst en besked før afsendelse.');
            return;
        }

        // 2. Disable button immediately to prevent spam
        newSendBtn.disabled = true;

        // 3. Save original content and show loading spinner
        const originalContent = SEND_MESSAGE_BUTTON_DEFAULT_HTML;
        newSendBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-2"></i>Sender...';

        try {
            const response = await authFetch(`/contact-seller`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    seller_id: seller_profile_id,
                    buyer_id: currentUser._id,
                    buyer_message: message,
                })
            });

            if (!response.ok) {
                let body = await response.json();
                displayErrorMessage(body.detail);

                // 4a. Re-enable on error so they can retry
                newSendBtn.disabled = false;
                newSendBtn.innerHTML = originalContent;
                return;
            }

            const updatedConversation = await response.json();
            displaySuccessMessage("Beskeden er sendt");

            newSendBtn.innerHTML = '<i class="fa-regular fa-comments me-2"></i>Åbner chat...';
            const params = updatedConversation?._id
                ? new URLSearchParams({id: updatedConversation._id})
                : new URLSearchParams();
            await showView('conversations', params);

        } catch (error) {
            console.error("Network or logic error:", error);
            displayErrorMessage("Der opstod en fejl. Prøv venligst igen.");

            // Re-enable on crash/network error
            newSendBtn.disabled = false;
            newSendBtn.innerHTML = originalContent;
        }
    });
}
