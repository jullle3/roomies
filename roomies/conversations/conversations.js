import {authFetch} from "../auth/auth.js";
import {basePath, s3Url} from "../config/config.js";
import {decodeJwt, displayErrorMessage, displaySuccessMessage, isLoggedIn} from "../utils.js";
import {getRoomById, getRoomByCreatedBy} from "../rooms/room_cache.js";

let conversations = [];
let activeConversationId = null;
let activeConversationWasExplicitlySelected = false;
let conversationPollIntervalId = null;
let globalUnreadPollIntervalId = null;
let conversationFetchInFlight = false;
let globalUnreadFetchInFlight = false;
let mobileConversationMode = 'list';

const CONVERSATION_POLL_INTERVAL_MS = 15 * 60 * 1000;
const GLOBAL_UNREAD_POLL_INTERVAL_MS = 15 * 60 * 1000;

// Local-only placeholder id for a conversation that has not been created in the
// backend yet (opened via "Kontakt" but no message sent). It becomes a real
// conversation the moment the first message is posted.
const DRAFT_CONVERSATION_ID = '__draft__';

// Public roomie profiles (every user), loaded lazily the first time someone opens a
// profile and cached for the session. Small dataset, so one fetch covers all the
// people the user might inspect from their inbox.
const roomieProfileCache = new Map();
let roomieProfilesPromise = null;

function loadRoomieProfiles() {
    if (!roomieProfilesPromise) {
        roomieProfilesPromise = authFetch('/roomies/users/profile')
            .then(async (response) => {
                if (!response.ok) throw new Error('Kunne ikke hente profiler');
                const profiles = await response.json();
                profiles.forEach(profile => roomieProfileCache.set(profile.id, profile));
                return roomieProfileCache;
            })
            .catch((error) => {
                // Allow a later retry instead of caching the failure.
                roomieProfilesPromise = null;
                throw error;
            });
    }
    return roomieProfilesPromise;
}

/**
 * Wires inbox row selection and reply submission for the conversations view.
 */
export function setupConversationsView() {
    const view = document.getElementById('conversations');
    if (!view) return;

    view.addEventListener('click', (event) => {
        const card = event.target.closest('[data-conversation-id]');
        if (!card) return;

        openConversation(card.dataset.conversationId);
    });

    document.getElementById('conversation-mobile-back')?.addEventListener('click', showMobileConversationList);
    window.addEventListener('resize', renderConversationPanelsForViewport);

    const replyForm = document.getElementById('conversation-reply-form');
    replyForm?.addEventListener('submit', sendConversationReply);

    document.getElementById('conversation-active-person')?.addEventListener('click', () => {
        const conversation = getActiveConversation();
        if (!conversation) return;
        openRoomieProfileModal(getOtherParticipantId(conversation, getCurrentUserId()));
    });
}

/**
 * Loads the authenticated user's conversations and renders the inbox/thread UI.
 */
export async function renderConversations(targetConversationId = null, options = {}) {
    const loading = document.getElementById('conversations-loading');
    const empty = document.getElementById('conversations-empty');
    const layout = document.getElementById('conversations-layout');
    const silent = options.silent === true;

    if (!isLoggedIn()) {
        stopConversationPolling();
        displayErrorMessage('Du skal logge ind for at se dine beskeder.');
        return;
    }

    if (conversationFetchInFlight) return;
    conversationFetchInFlight = true;

    if (!silent) {
        loading?.classList.remove('d-none');
        empty?.classList.add('d-none');
        layout?.classList.add('d-none');
    }

    try {
        const response = await authFetch('/roomies/conversations');

        if (!response.ok) {
            const body = await safeJson(response);
            if (silent) return;
            displayErrorMessage(body.detail || 'Kunne ikke hente beskeder.');
            return;
        }

        const rawConversations = await response.json();
        conversations = await enrichConversations(rawConversations);
        conversations.sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));

        // Opened from "Kontakt": focus an existing thread with this user, or spin up
        // a local draft so they can write the first message (which creates it server-side).
        const draftReceiverId = options.draftReceiverId || null;
        if (draftReceiverId && draftReceiverId !== getCurrentUserId()) {
            const existing = conversations.find(conversation =>
                (conversation.participant_ids || []).includes(draftReceiverId));
            if (existing) {
                targetConversationId = existing._id;
            } else {
                const draft = await buildDraftConversation(draftReceiverId, options.draftRoomId);
                conversations.unshift(draft);
                activeConversationId = draft._id;
                activeConversationWasExplicitlySelected = true;
                if (isMobileConversationLayout()) {
                    mobileConversationMode = 'thread';
                }
            }
        }

        if (conversations.length === 0) {
            if (!silent) {
                empty?.classList.remove('d-none');
            }
            updateConversationUnreadBadge(0);
            startConversationPolling();
            return;
        }

        if (targetConversationId && conversations.some(conversation => conversation._id === targetConversationId)) {
            activeConversationId = targetConversationId;
            activeConversationWasExplicitlySelected = true;
        } else if (!activeConversationId || !conversations.some(conversation => conversation._id === activeConversationId)) {
            activeConversationId = conversations[0]._id;
            activeConversationWasExplicitlySelected = false;
        }

        if (!silent && !targetConversationId) {
            activeConversationWasExplicitlySelected = false;
        }

        if (!silent && isMobileConversationLayout()) {
            mobileConversationMode = targetConversationId ? 'thread' : 'list';
        }

        if (activeConversationWasExplicitlySelected && shouldShowConversationThread()) {
            markActiveConversationRead({render: false});
        }

        layout?.classList.remove('d-none');
        empty?.classList.add('d-none');
        renderConversationList();
        renderActiveConversation();
        renderConversationPanelsForViewport();
        updateConversationUnreadBadgeFromConversations(conversations);
        startConversationPolling();

        // Opened via "Kontakt": land at the bottom of the thread, ready to reply
        // (mobile shows the thread panel; desktop focuses the prefilled composer).
        if (options.draftReceiverId) {
            revealConversationComposer();
        }
    } catch (error) {
        console.error('Failed to load conversations', error);
        if (silent) return;
        displayErrorMessage('Der opstod en fejl. Prøv igen senere.');
    } finally {
        conversationFetchInFlight = false;
        loading?.classList.add('d-none');
    }
}

export function startGlobalConversationUnreadPolling() {
    if (!isLoggedIn()) {
        stopGlobalConversationUnreadPolling();
        return;
    }

    refreshGlobalConversationUnreadCount({force: true});

    if (globalUnreadPollIntervalId) return;
    globalUnreadPollIntervalId = window.setInterval(refreshGlobalConversationUnreadCount, GLOBAL_UNREAD_POLL_INTERVAL_MS);
}

export function stopGlobalConversationUnreadPolling() {
    if (globalUnreadPollIntervalId) {
        window.clearInterval(globalUnreadPollIntervalId);
        globalUnreadPollIntervalId = null;
    }
    updateConversationUnreadBadge(0);
}

async function refreshGlobalConversationUnreadCount({force = false} = {}) {
    if (!isLoggedIn()) {
        stopGlobalConversationUnreadPolling();
        return;
    }

    if (!force && (document.hidden || isConversationViewOpen() || globalUnreadFetchInFlight)) return;
    if (globalUnreadFetchInFlight) return;

    globalUnreadFetchInFlight = true;
    try {
        const response = await authFetch('/roomies/conversations');
        if (!response.ok) return;

        const rawConversations = await response.json();
        updateConversationUnreadBadgeFromConversations(rawConversations || []);
    } catch (error) {
        console.error('Failed to refresh unread conversations', error);
    } finally {
        globalUnreadFetchInFlight = false;
    }
}

function updateConversationUnreadBadgeFromConversations(conversationsToCount) {
    updateConversationUnreadBadge(getTotalUnreadCount(conversationsToCount, getCurrentUserId()));
}

function updateConversationUnreadBadge(unreadCount) {
    const badges = document.querySelectorAll('.conversation-unread-badge');
    if (badges.length === 0) return;

    badges.forEach(badge => {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            badge.classList.remove('d-none');
        } else {
            badge.textContent = '';
            badge.classList.add('d-none');
        }
    });
}

function startConversationPolling() {
    if (conversationPollIntervalId) return;

    conversationPollIntervalId = window.setInterval(async () => {
        if (!isConversationViewOpen()) {
            stopConversationPolling();
            return;
        }

        if (document.hidden) return;

        await renderConversations(activeConversationId, {silent: true});
    }, CONVERSATION_POLL_INTERVAL_MS);
}

function stopConversationPolling() {
    if (!conversationPollIntervalId) return;

    window.clearInterval(conversationPollIntervalId);
    conversationPollIntervalId = null;
}

function isConversationViewOpen() {
    const view = document.getElementById('conversations');
    return !!view && !view.hasAttribute('hidden') && view.style.display !== 'none';
}

function openConversation(conversationId) {
    activeConversationId = conversationId;
    activeConversationWasExplicitlySelected = true;
    if (isMobileConversationLayout()) {
        mobileConversationMode = 'thread';
    }
    markActiveConversationRead({render: false});
    renderConversationList();
    renderActiveConversation();
    renderConversationPanelsForViewport();
    revealConversationComposer();
    updateConversationUnreadBadgeFromConversations(conversations);
}

function showMobileConversationList() {
    mobileConversationMode = 'list';
    renderConversationPanelsForViewport();
    scrollActiveConversationIntoView();
}

function renderConversationPanelsForViewport() {
    const listColumn = document.getElementById('conversation-list-column');
    const threadColumn = document.getElementById('conversation-thread-column');
    if (!listColumn || !threadColumn) return;

    if (!isMobileConversationLayout()) {
        listColumn.classList.remove('d-none');
        threadColumn.classList.remove('d-none');
        return;
    }

    const showThread = mobileConversationMode === 'thread' && !!activeConversationId;
    listColumn.classList.toggle('d-none', showThread);
    threadColumn.classList.toggle('d-none', !showThread);
}

function shouldShowConversationThread() {
    return !isMobileConversationLayout() || mobileConversationMode === 'thread';
}

function isMobileConversationLayout() {
    return window.matchMedia('(max-width: 991.98px)').matches;
}

/**
 * When returning to the mobile inbox via "Tilbage", scrolls the conversation the user
 * was just viewing back into view so they keep their place in a long list.
 */
function scrollActiveConversationIntoView() {
    if (!isMobileConversationLayout()) return;

    const activeItem = document.querySelector('#conversation-list .conversation-list-item.active');
    const fallback = document.getElementById('conversations');

    window.requestAnimationFrame(() => {
        if (activeItem) {
            activeItem.scrollIntoView({behavior: 'smooth', block: 'center'});
        } else {
            fallback?.scrollIntoView({block: 'start'});
        }
    });
}

/**
 * After a conversation opens, scrolls to the latest message so the user lands at the
 * bottom of the thread, ready to reply. On desktop we also place the cursor in the
 * textarea; on mobile we skip auto-focus so the on-screen keyboard doesn't cover the
 * thread.
 */
function revealConversationComposer() {
    const messages = document.getElementById('conversation-messages');
    const replyForm = document.getElementById('conversation-reply-form');
    if (!messages || !replyForm) return;

    const replyInput = document.getElementById('conversation-reply-text');
    const isMobile = isMobileConversationLayout();

    window.requestAnimationFrame(() => {
        scrollActiveThreadToLatest(messages, replyForm, isMobile);

        if (!isMobile) {
            replyInput?.focus({preventScroll: true});
        }
    });
}

/**
 * Scrolls the thread so the most recent message is visible at the bottom.
 * Desktop scrolls inside the fixed-height messages panel; mobile scrolls the page,
 * since there the composer is sticky to the viewport bottom (scrolling it into view
 * would be a no-op) and the page itself is the scroll container.
 */
function scrollActiveThreadToLatest(messages, replyForm, isMobile) {
    if (!isMobile) {
        messages.scrollTop = messages.scrollHeight;
        return;
    }

    const messagesBottom = window.scrollY + messages.getBoundingClientRect().bottom;
    const composerHeight = replyForm?.offsetHeight || 0;
    const target = messagesBottom - window.innerHeight + composerHeight;
    window.scrollTo({top: Math.max(0, target), behavior: 'smooth'});
}

function markActiveConversationRead({render = true} = {}) {
    if (!activeConversationId) return;
    markConversationRead(activeConversationId, {render});
}

async function markConversationRead(conversationId, {render = true} = {}) {
    const currentUserId = getCurrentUserId();
    const conversation = conversations.find(item => item._id === conversationId);

    if (!currentUserId || !conversation || getUnreadCount(conversation, currentUserId) === 0) return;

    markConversationReadLocally(conversation, currentUserId);

    if (render) {
        renderConversationList();
        renderActiveConversation();
    }
    updateConversationUnreadBadgeFromConversations(conversations);

    try {
        const response = await authFetch(`/roomies/conversation/${encodeURIComponent(conversationId)}/read`, {method: 'POST'});
        if (!response.ok) return;

        const updatedConversation = await response.json();
        upsertConversation(updatedConversation);
        updateConversationUnreadBadgeFromConversations(conversations);
        if (render) {
            renderConversationList();
            renderActiveConversation();
        }
    } catch (error) {
        console.error('Failed to mark conversation as read', error);
    }
}

function markConversationReadLocally(conversation, userId) {
    conversation.read_message_count_by_user = {
        ...(conversation.read_message_count_by_user || {}),
        [userId]: (conversation.messages || []).length,
    };
}

/**
 * Sends a reply in the active conversation using the authenticated user as sender.
 */
async function sendConversationReply(event) {
    event.preventDefault();

    const currentUserId = getCurrentUserId();
    const activeConversation = getActiveConversation();
    const input = document.getElementById('conversation-reply-text');
    const button = document.getElementById('conversation-reply-submit');
    const text = input?.value.trim();

    if (!currentUserId || !activeConversation) {
        displayErrorMessage('Kunne ikke finde samtalen.');
        return;
    }

    if (!text) {
        displayErrorMessage('Skriv en besked før du sender.');
        return;
    }

    const receiverId = getOtherParticipantId(activeConversation, currentUserId);
    if (!receiverId) {
        displayErrorMessage('Kunne ikke finde modtageren.');
        return;
    }

    const originalButtonHtml = button?.innerHTML;
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-2"></i>Sender...';
    }

    try {
        const response = await authFetch('/roomies/conversation/message', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                receiver_id: receiverId,
                text,
                room_id: activeConversation.room_id || null,
            }),
        });

        if (!response.ok) {
            const body = await safeJson(response);
            displayErrorMessage(body.detail || 'Beskeden kunne ikke sendes.');
            return;
        }

        const updatedConversation = await response.json();
        // If this was a draft (no server-side conversation yet), the POST just created it.
        // Drop the local draft and carry its room context onto the real conversation.
        const previousContext = activeConversation._uiContext || null;
        conversations = conversations.filter(conversation => !conversation._isDraft);
        upsertConversation(updatedConversation);
        const storedConversation = conversations.find(conversation => conversation._id === updatedConversation._id);
        if (storedConversation && !storedConversation._uiContext) {
            storedConversation._uiContext = previousContext;
        }
        activeConversationId = updatedConversation._id;
        markActiveConversationRead({render: false});
        if (input) input.value = '';
        renderConversationList();
        renderActiveConversation();
        updateConversationUnreadBadgeFromConversations(conversations);
        displaySuccessMessage('Beskeden er sendt');
    } catch (error) {
        console.error('Failed to send conversation reply', error);
        displayErrorMessage('Der opstod en fejl. Prøv igen senere.');
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = originalButtonHtml;
        }
    }
}

/**
 * Renders the left-side inbox with property context for each conversation.
 */
function renderConversationList() {
    const container = document.getElementById('conversation-list');
    if (!container) return;

    const currentUserId = getCurrentUserId();

    container.innerHTML = conversations.map(conversation => {
        const lastMessage = getLastMessage(conversation);
        const activeClass = conversation._id === activeConversationId ? 'active' : '';
        const senderLabel = lastMessage?.sender_id === currentUserId ? 'Dig: ' : '';
        const preview = lastMessage ? `${senderLabel}${lastMessage.text}` : 'Ingen beskeder endnu';
        const context = conversation._uiContext;
        const unreadCount = getUnreadCount(conversation, currentUserId);
        const unreadClass = unreadCount > 0 ? 'unread' : '';

        return `
            <button type="button"
                    class="conversation-list-item ${activeClass} ${unreadClass}"
                    data-conversation-id="${escapeHtml(conversation._id)}">
                <div class="d-flex align-items-center gap-3">
                    ${renderInboxThumbnail(conversation, currentUserId)}
                    <div class="min-width-0 flex-grow-1">
                        <div class="d-flex align-items-baseline justify-content-between gap-3">
                            <div class="fw-bold company-dark conversation-title">
                                ${escapeHtml(getConversationTitle(conversation, currentUserId))}
                            </div>
                            <div class="conversation-date text-muted flex-shrink-0">
                                ${escapeHtml(formatConversationTime(lastMessage?.created || conversation.updated))}
                            </div>
                        </div>
                        <div class="conversation-preview text-muted">
                            ${escapeHtml(preview)}
                        </div>
                        <div class="conversation-property-subtitle text-muted">
                            ${escapeHtml(getConversationSubtitle(context, conversation, currentUserId))}
                        </div>
                    </div>
                    ${unreadCount > 0 ? `<span class="conversation-unread-count flex-shrink-0">${escapeHtml(unreadCount)}</span>` : ''}
                </div>
            </button>
        `;
    }).join('');
}

/**
 * Renders the selected conversation header and message thread.
 */
function renderActiveConversation() {
    const conversation = getActiveConversation();
    const currentUserId = getCurrentUserId();
    const title = document.getElementById('conversation-active-title');
    const subtitle = document.getElementById('conversation-active-subtitle');
    const imageContainer = document.getElementById('conversation-active-image');
    const actionContainer = document.getElementById('conversation-active-action');
    const messagesContainer = document.getElementById('conversation-messages');

    if (!conversation || !messagesContainer) return;

    const context = conversation._uiContext;

    if (title) {
        title.textContent = getConversationTitle(conversation, currentUserId);
    }

    if (subtitle) {
        subtitle.textContent = getConversationSubtitle(context, conversation, currentUserId);
    }

    if (imageContainer) {
        imageContainer.innerHTML = renderPersonAvatar(getOtherParticipantProfile(conversation, currentUserId));
    }

    if (actionContainer) {
        actionContainer.innerHTML = renderHeaderAction(context, currentUserId);
    }

    messagesContainer.innerHTML = (conversation.messages || []).map(message => {
        const isMine = message.sender_id === currentUserId;
        const sideClass = isMine ? 'mine' : 'theirs';
        const senderLabel = isMine ? 'Dig' : getParticipantDisplayName(conversation, message.sender_id, currentUserId);

        return `
            <div class="conversation-message-row ${sideClass}">
                <div class="conversation-message-bubble">
                    <div class="conversation-message-meta">${escapeHtml(senderLabel)} · ${escapeHtml(formatMessageTime(message.created))}</div>
                    <div class="conversation-message-text">${escapeHtml(message.text)}</div>
                </div>
            </div>
        `;
    }).join('');

    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    prefillDraftMessage(conversation);
}

// Prefill the personalized opener for a fresh "Kontakt" draft (once, never
// clobbering anything the user has typed).
function prefillDraftMessage(conversation) {
    const input = document.getElementById('conversation-reply-text');
    if (!input || !conversation?._isDraft) return;

    if (conversation._prefillText && !conversation._prefilled && !input.value.trim()) {
        input.value = conversation._prefillText;
        conversation._prefilled = true;
    }
}

function getActiveConversation() {
    return conversations.find(conversation => conversation._id === activeConversationId) || null;
}

function getCurrentUserId() {
    return decodeJwt()?.sub || null;
}

function getOtherParticipantId(conversation, currentUserId) {
    return (conversation.participant_ids || []).find(id => id !== currentUserId) || null;
}

/**
 * Returns the display name for the participant on the other side of the chat.
 */
function getOtherParticipantName(conversation, currentUserId) {
    const otherParticipantId = getOtherParticipantId(conversation, currentUserId);
    return getParticipantDisplayName(conversation, otherParticipantId, currentUserId, '');
}

/**
 * Resolves a participant label from the enriched conversation user-name map.
 */
function getParticipantDisplayName(conversation, participantId, currentUserId, fallback = 'Modpart') {
    if (!participantId) return fallback;
    if (participantId === currentUserId) return 'Dig';
    // Prefer the live profile name, fall back to the snapshot stored on the conversation.
    return conversation._participantProfiles?.[participantId]?.full_name
        || conversation._participantNames?.[participantId]
        || fallback;
}

function getOtherParticipantProfile(conversation, currentUserId) {
    const otherParticipantId = getOtherParticipantId(conversation, currentUserId);
    return conversation._participantProfiles?.[otherParticipantId] || null;
}

/**
 * Renders the chat counterpart's circular avatar, falling back to an icon when they
 * have no profile photo.
 */
function renderPersonAvatar(profile, baseClass = 'chat-person-avatar') {
    const photo = profile?.profile_photo;
    if (photo) {
        return `<img src="${escapeHtml(`${s3Url}/${photo}`)}" class="${baseClass}" alt="Profilbillede" loading="lazy">`;
    }
    return `<div class="${baseClass} ${baseClass}--fallback"><i class="fa-solid fa-user"></i></div>`;
}

/**
 * Opens the read-only profile of the roomie on the other side of the chat. Loads the
 * (cached) public-profile dataset on first use, then renders from cache.
 */
async function openRoomieProfileModal(userId) {
    const modalEl = document.getElementById('roomieProfileModal');
    if (!modalEl || !userId) return;

    const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
    setRoomieProfileModalState(modalEl, 'loading');
    modal.show();

    try {
        await loadRoomieProfiles();
        renderRoomieProfileCard(modalEl, roomieProfileCache.get(userId) || null);
    } catch (error) {
        setRoomieProfileModalState(modalEl, 'error');
    }
}

function setRoomieProfileModalState(modalEl, state) {
    modalEl.querySelector('[data-rp-loading]')?.classList.toggle('d-none', state !== 'loading');
    modalEl.querySelector('[data-rp-error]')?.classList.toggle('d-none', state !== 'error');
    modalEl.querySelector('[data-rp-content]')?.classList.toggle('d-none', state !== 'content');
}

function renderRoomieProfileCard(modalEl, profile) {
    setRoomieProfileModalState(modalEl, 'content');

    // A missing cache entry still resolves to a friendly card (deleted/unknown user).
    const safeProfile = profile || {};
    const interests = Array.isArray(safeProfile.interests) ? safeProfile.interests : [];

    const avatar = modalEl.querySelector('[data-rp-avatar]');
    if (avatar) avatar.innerHTML = renderPersonAvatar(safeProfile, 'roomie-profile-avatar-img');

    const nameEl = modalEl.querySelector('[data-rp-name]');
    if (nameEl) nameEl.textContent = safeProfile.full_name || 'Roomie';

    const metaParts = [
        safeProfile.age ? `${safeProfile.age} år` : null,
        safeProfile.occupation || null,
        capitalizeFirst(safeProfile.gender),
    ].filter(Boolean);
    const metaEl = modalEl.querySelector('[data-rp-meta]');
    if (metaEl) metaEl.textContent = metaParts.join(' · ');

    const vibesSection = modalEl.querySelector('[data-rp-vibes-section]');
    const vibes = modalEl.querySelector('[data-rp-vibes]');
    if (vibes) {
        vibes.innerHTML = interests
            .map(tag => `<span class="roomie-profile-vibe">${escapeHtml(tag)}</span>`)
            .join('');
    }
    vibesSection?.classList.toggle('d-none', interests.length === 0);

    const descSection = modalEl.querySelector('[data-rp-desc-section]');
    const desc = modalEl.querySelector('[data-rp-desc]');
    if (desc) desc.textContent = safeProfile.description || '';
    descSection?.classList.toggle('d-none', !safeProfile.description);

    const hasAnyDetails = Boolean(
        safeProfile.profile_photo || safeProfile.age || safeProfile.occupation
        || safeProfile.gender || interests.length || safeProfile.description
    );
    modalEl.querySelector('[data-rp-empty]')?.classList.toggle('d-none', hasAnyDetails);
}

function capitalizeFirst(value) {
    if (!value) return null;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function getConversationTitle(conversation, currentUserId) {
    const context = conversation._uiContext;

    if (context?.isExchange) {
        const properties = getExchangeProperties(context);
        if (properties[0] && properties[1]) {
            return `${getPropertyName(properties[0])} ⇄ ${getPropertyName(properties[1])}`;
        }
        return `Bytte: ${getPropertyName(properties[0])}`;
    }

    const property = getPrimaryProperty(context);
    if (property) {
        return getPropertyName(property);
    }

    const otherParticipantName = getOtherParticipantName(conversation, currentUserId);
    if (otherParticipantName) {
        return otherParticipantName;
    }

    const otherParticipantId = getOtherParticipantId(conversation, currentUserId);
    return otherParticipantId ? 'Samtale med bruger' : 'Samtale';
}

function getLastMessage(conversation) {
    const messages = conversation.messages || [];
    return messages.length > 0 ? messages[messages.length - 1] : null;
}

export function getUnreadCount(conversation, currentUserId) {
    if (!conversation || !currentUserId) return 0;

    const messages = conversation.messages || [];
    const rawReadCount = Number(conversation.read_message_count_by_user?.[currentUserId] || 0);
    const readCount = Math.max(0, Math.min(rawReadCount, messages.length));

    return messages
        .slice(readCount)
        .filter(message => message.sender_id !== currentUserId)
        .length;
}

export function getTotalUnreadCount(conversationsToCount, currentUserId) {
    return (conversationsToCount || [])
        .reduce((total, conversation) => total + getUnreadCount(conversation, currentUserId), 0);
}

function upsertConversation(updatedConversation) {
    const index = conversations.findIndex(conversation => conversation._id === updatedConversation._id);
    const existingConversation = index === -1 ? null : conversations[index];
    updatedConversation._uiContext = existingConversation?._uiContext || null;
    updatedConversation._participantNames = updatedConversation.participant_names || {};
    updatedConversation._participantProfiles = updatedConversation.participant_profiles || {};

    if (index === -1) {
        conversations.unshift(updatedConversation);
    } else {
        conversations[index] = updatedConversation;
    }
    conversations.sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
}

/**
 * Builds a local-only draft conversation with a target user, used when the inbox is
 * opened from a room's "Kontakt" button before any message has been sent.
 */
async function buildDraftConversation(receiverId, roomId = null) {
    const currentUserId = getCurrentUserId();
    const draft = {
        _id: DRAFT_CONVERSATION_ID,
        _isDraft: true,
        participant_ids: [currentUserId, receiverId].filter(Boolean),
        room_id: roomId || null,
        participant_names: {},
        messages: [],
        read_message_count_by_user: {},
        updated: Math.floor(Date.now() / 1000),
    };

    // Seed the counterpart's name + photo from the room we came from. The room carries
    // a server-synced snapshot of the owner's profile, so it's fresh and lets the draft
    // show who you're writing to before any message exists.
    const ownerRoom = (roomId && await getRoomById(roomId))
        || await getRoomByCreatedBy(receiverId);
    if (ownerRoom?.host_name) {
        draft.participant_names[receiverId] = ownerRoom.host_name;
    }

    draft._participantNames = draft.participant_names;
    draft._participantProfiles = {
        [receiverId]: {
            full_name: ownerRoom?.host_name || '',
            profile_photo: ownerRoom?.profile_photo || null,
        },
    };

    // Personalized first-message opener, prefilled when the draft thread opens.
    const ownerFirstName = (ownerRoom?.host_name || '').trim().split(/\s+/)[0];
    draft._prefillText = buildContactOpener(ownerFirstName);

    draft._uiContext = await buildConversationContext(draft, currentUserId);
    return draft;
}

function buildContactOpener(firstName) {
    const greeting = firstName ? `Hej ${firstName} 👋` : 'Hej 👋';
    return `${greeting} Jeg så din annonce og er meget interesseret. Kan jeg komme og se værelset?`;
}

async function enrichConversations(rawConversations) {
    const currentUserId = getCurrentUserId();
    return Promise.all((rawConversations || []).map(async conversation => {
        conversation._uiContext = await buildConversationContext(conversation, currentUserId);
        conversation._participantNames = conversation.participant_names || {};
        conversation._participantProfiles = conversation.participant_profiles || {};
        return conversation;
    }));
}

/**
 * Builds display context from cached listings without fetching individual ads.
 */
async function buildConversationContext(conversation, currentUserId) {
    const participantIds = conversation.participant_ids || [];
    const participantProperties = (await Promise.all(
        participantIds.map(async participantId => ({
            participantId,
            property: await getRoomByCreatedBy(participantId),
        }))
    )).filter(item => item.property);

    const ownProperty = participantProperties.find(item => item.participantId === currentUserId)?.property || null;
    const firstSenderId = conversation.messages?.[0]?.sender_id || null;
    const initialReceiverId = participantIds.find(participantId => participantId !== firstSenderId) || null;
    const initialReceiverProperty = participantProperties.find(item => item.participantId === initialReceiverId)?.property || null;
    const firstAvailableProperty = participantProperties[0]?.property || null;
    // The exact listing the thread started from (pinned on the conversation), so
    // "Se værelse" stays correct even when the owner has multiple listings.
    const explicitProperty = conversation.room_id ? await getRoomById(conversation.room_id) : null;
    const hasExchangeContext = participantProperties.some(item => isExchangeOnlyProperty(item.property));
    const isExchange = hasExchangeContext && participantProperties.length > 0;

    if (isExchange) {
        return {
            isExchange: true,
            properties: participantProperties.map(item => item.property),
            propertyEntries: participantProperties,
        };
    }

    return {
        isExchange: false,
        properties: [explicitProperty || initialReceiverProperty || ownProperty || firstAvailableProperty].filter(Boolean),
        propertyEntries: participantProperties,
    };
}

/**
 * Creates the compact inbox thumbnail, including stacked images for exchanges.
 */
function renderInboxThumbnail(conversation, currentUserId) {
    const context = conversation._uiContext;

    if (context?.isExchange) {
        const properties = getExchangeProperties(context);
        return `
            <div class="chat-thumb-stack flex-shrink-0">
                <img src="${escapeHtml(getPropertyImageUrl(properties[0]))}" alt="Værelse 1">
                <img src="${escapeHtml(getPropertyImageUrl(properties[1]))}" alt="Værelse 2">
            </div>
        `;
    }

    return renderPersonAvatar(getOtherParticipantProfile(conversation, currentUserId), 'chat-inbox-avatar');
}

/**
 * Creates the listing navigation action for the selected conversation.
 */
function renderHeaderAction(context, currentUserId) {
    const property = getConversationActionProperty(context, currentUserId);
    if (!property?._id) return '';

    const label = context?.isExchange ? 'Se deres værelse' : 'Se værelse';
    return `
        <a href="/vaerelse?id=${encodeURIComponent(property._id)}"
           class="btn btn-light rounded-pill fw-bold shadow-sm hover-lift conversation-listing-link">
            <i class="fa-solid fa-arrow-up-right-from-square me-2"></i>${escapeHtml(label)}
        </a>
    `;
}

function getConversationActionProperty(context, currentUserId) {
    let property = null;

    if (context?.isExchange) {
        property = getOtherParticipantProperty(context, currentUserId);
    } else {
        property = getPrimaryProperty(context);
    }

    if (isCurrentUsersProperty(context, property, currentUserId)) {
        return null;
    }

    return property;
}

function getOtherParticipantProperty(context, currentUserId) {
    return (context?.propertyEntries || [])
        .find(item => item.participantId !== currentUserId)
        ?.property || null;
}

function isCurrentUsersProperty(context, property, currentUserId) {
    if (!property || !currentUserId) {
        return false;
    }

    return (context?.propertyEntries || [])
        .some(item => item.participantId === currentUserId && item.property?._id === property._id);
}

function isExchangeOnlyProperty(property) {
    return property?.exchange_only === true || String(property?.exchange_only).toLowerCase() === 'true';
}

function getConversationSubtitle(context, conversation = null, currentUserId = null) {
    const otherParticipantName = conversation ? getOtherParticipantName(conversation, currentUserId) : '';

    if (context?.isExchange) {
        return [otherParticipantName, 'Bytte'].filter(Boolean).join(' · ');
    }

    const property = getPrimaryProperty(context);
    if (!property || !property.price) {
        return otherParticipantName || 'Samtale';
    }

    return [otherParticipantName, `${Number(property.price).toLocaleString('da-DK')} kr.`].filter(Boolean).join(' · ');
}

function getPrimaryProperty(context) {
    return context?.properties?.[0] || null;
}

function getExchangeProperties(context) {
    const properties = context?.properties || [];
    return [
        properties[0] || null,
        properties[1] || null,
    ];
}

function getPropertyName(property) {
    if (!property) return 'Værelse';
    return property.street_name || property.address || property.title || 'Værelse';
}

function getPropertyImageUrl(property) {
    const firstImage = property?.images?.[0];
    const imageName = firstImage?.thumbnail_name || firstImage?.name;

    if (imageName) {
        return `${s3Url}/${imageName}`;
    }

    return `${basePath}/pics/default4.webp`;
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

function formatConversationTime(timestamp) {
    if (!timestamp) return '';
    return new Date(Number(timestamp) * 1000).toLocaleDateString('da-DK', {
        day: 'numeric',
        month: 'short',
    });
}

function formatMessageTime(timestamp) {
    if (!timestamp) return '';
    return new Date(Number(timestamp) * 1000).toLocaleString('da-DK', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
