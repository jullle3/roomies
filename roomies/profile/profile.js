import {authFetch} from "../auth/auth.js";
import {displayErrorMessage, decodeJwt, currentUser, getHousingById} from "../utils.js";
import {showView} from "../views/viewManager.js";

export function setupProfileView() {
    setupProfileSettingsHandlers();
    setupConversationsShortcut();
}

export async function loadProfileView() {
    const userId = populateProfileView();

    if (userId) {
        if (currentUser && currentUser._id === userId) {
            updateProfileUI(currentUser);
        } else {
            try {
                const response = await authFetch(`/user/${userId}`);
                if (response.ok) {
                    const userProfile = await response.json();
                    updateProfileUI(userProfile);
                }
            } catch (err) {
                console.warn("Could not fetch fresh profile data. Relying on JWT.", err);
            }
        }

        // 2b. Find user's own listing from the global housing cache (loaded on startup)
        try {
            const listing = await getHousingById(userId, 'created_by');
            if (listing && listing._id) {
                const listingBtn = document.getElementById('btn-my-listing');
                const listingSubtitle = document.getElementById('btn-my-listing-subtitle');
                if (listingBtn) {
                    if (listingSubtitle && listing.address) {
                        listingSubtitle.textContent = listing.address;
                    }
                    listingBtn.classList.remove('d-none');

                    const newListingBtn = listingBtn.cloneNode(true);
                    listingBtn.parentNode.replaceChild(newListingBtn, listingBtn);

                    newListingBtn.addEventListener('click', (e) => {
                        e.preventDefault();
//                        showView('detail', new URLSearchParams({ id: listing._id }));
                        showView('create');
                        window.scrollTo(0, 0);
                    });
                }
            }
        } catch (err) {
            console.warn("Could not find user listing in housing cache.", err);
        }
    }
}

function setupProfileSettingsHandlers() {
    $('.profile-patch-operation').off('change').on('change', async function () {
        const settingName = this.id;
        const settingValue = $(this).is(':checked');

        const response = await authFetch('/user', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({[settingName]: settingValue})
        })

        if (!response.ok) {
            displayErrorMessage("Kunne ikke opdatere indstillingen.");
            $(this).prop('checked', !settingValue);
            return;
        }
    })
}

function setupConversationsShortcut() {
    const conversationsBtn = document.getElementById('btn-my-conversations');
    if (conversationsBtn) {
        const newBtn = conversationsBtn.cloneNode(true);
        conversationsBtn.parentNode.replaceChild(newBtn, conversationsBtn);

        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showView('conversations');
        });
    }
}

// Helper function to update the inputs
function updateProfileUI(userProfile) {
    document.getElementById('fullName-profile').value = userProfile.full_name;
    document.getElementById('email-profile').value = userProfile.email;

    const emailToggle = document.getElementById('email_notifications');
    if (emailToggle) {
        emailToggle.checked = userProfile.email_notifications;
    }

}


export function populateProfileView(){
    const payloadObj = decodeJwt();
    let userId = null;

    if (payloadObj) {
        const navName = document.getElementById('navbar-name-text');
        if (navName) navName.textContent = payloadObj.full_name;

        document.getElementById('fullName-profile').value = payloadObj.full_name;
        document.getElementById('email-profile').value = payloadObj.email;

        const emailToggle = document.getElementById('email_notifications');
        if (emailToggle) {
            emailToggle.checked = !!payloadObj.email_notifications;
        }

        userId = payloadObj.sub;
    }
    return userId
}
