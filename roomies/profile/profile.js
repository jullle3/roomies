import {authFetch} from "../auth/auth.js";
import {displayErrorMessage, decodeJwt, currentUser, getHousingById} from "../utils.js";
import {stripe_customer_portal} from "../config/config.js";
import {showView} from "../views/viewManager.js";

export function setupProfileView() {
    setupProfileSettingsHandlers();
    setupStripeManageButton();
    setupFavoritesShortcut();
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

function setupStripeManageButton() {
    if (!document.getElementById('stripe-manage-btn')) {
        const manageBtn = document.createElement('a');
        manageBtn.id = 'stripe-manage-btn';
        manageBtn.href = stripe_customer_portal;
        manageBtn.target = '_blank';
        manageBtn.className = 'btn btn-primary btn-lg w-100 rounded-pill fw-bold shadow-sm mt-4 py-3';
        manageBtn.textContent = 'Administrer abonnement';

        document.getElementById('profileForm')?.insertAdjacentElement('afterend', manageBtn);
    }
}

function setupFavoritesShortcut() {
    const favBtn = document.getElementById('btn-my-favorites');
    if (favBtn) {
        const newBtn = favBtn.cloneNode(true);
        favBtn.parentNode.replaceChild(newBtn, favBtn);

        newBtn.addEventListener('click', async (e) => {
            e.preventDefault();

            resetHousingListFilters();
            const favCheckbox = document.getElementById('filter-favorites');
            if (favCheckbox) favCheckbox.checked = true;

            await showView('housing_list');
            window.scrollTo(0, 0);
        });
    }
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

function resetHousingListFilters() {
    const searchInput = document.getElementById('housing-list-search');
    if (searchInput) searchInput.value = '';

    const dropdowns = ['price-filter', 'rooms-filter', 'monthly-fee-filter', 'square-meters-filter'];
    dropdowns.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 'all';
    });

    document.querySelectorAll('.extra-filter-checkbox').forEach(cb => cb.checked = false);

    const defaultTypeRadio = document.getElementById('filter-type-all');
    if (defaultTypeRadio) defaultTypeRadio.checked = true;

    const sortSelect = document.getElementById('sort-options');
    if (sortSelect) sortSelect.value = 'created-desc';
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
