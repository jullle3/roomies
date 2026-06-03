import {showView} from "../views/viewManager.js";
import {updateNavbar} from "../header/header.js";
import {resetCurrentUser, showConfirmationModal} from "../utils.js";
import {stopGlobalConversationUnreadPolling} from "../conversations/conversations.js";

export function setupLogoutView() {
    document.getElementById("logout").addEventListener('click', (event) => {
        event.preventDefault();

        showConfirmationModal(
            "Log ud",
            "Er du sikker på, at du vil logge ud?",
            () => {
                // Clear JWT from localStorage
                localStorage.removeItem('jwt');
                resetCurrentUser();
                stopGlobalConversationUnreadPolling();

                // Clean the users information from the website
                // We add simple checks to ensure elements exist before accessing properties
                const nameInput = document.getElementById('fullName-profile');
                if (nameInput) nameInput.value = '';
                const emailInput = document.getElementById('email-profile');
                if (emailInput) emailInput.value = '';

                updateNavbar();
                showView('housing_list');
            },
            "btn-primary" // Use primary color (Blue) since this isn't a destructive action like delete
        );
    });
}
