import {authFetch} from "../auth/auth.js";
import {basePath, s3Url} from "../config/config.js";
import {decodeJwt, displayErrorMessage, displaySuccessMessage, getHousingById, isLoggedIn} from "../utils.js";

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
        const response = await authFetch('/conversations');

        if (!response.ok) {
            const body = await safeJson(response);
            if (silent) return;
            displayErrorMessage(body.detail || 'Kunne ikke hente beskeder.');
            return;
        }

        const rawConversations = await response.json();
        conversations = await enrichConversations(rawConversations);
        conversations.sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));

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
        const response = await authFetch('/conversations');
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
    scrollConversationsIntoView();
    updateConversationUnreadBadgeFromConversations(conversations);
}

function showMobileConversationList() {
    mobileConversationMode = 'list';
    renderConversationPanelsForViewport();
    scrollConversationsIntoView();
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

function scrollConversationsIntoView() {
    const view = document.getElementById('conversations');
    if (!view || !isMobileConversationLayout()) return;

    window.requestAnimationFrame(() => {
        view.scrollIntoView({block: 'start'});
    });
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
        const response = await authFetch(`/conversation/${encodeURIComponent(conversationId)}/read`, {method: 'POST'});
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
        const response = await authFetch('/conversation/message', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                receiver_id: receiverId,
                text,
            }),
        });

        if (!response.ok) {
            const body = await safeJson(response);
            displayErrorMessage(body.detail || 'Beskeden kunne ikke sendes.');
            return;
        }

        const updatedConversation = await response.json();
        upsertConversation(updatedConversation);
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
                    ${renderInboxThumbnail(context)}
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
        imageContainer.innerHTML = renderHeaderThumbnail(context);
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
    return conversation._participantNames?.[participantId] || fallback;
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

    if (index === -1) {
        conversations.unshift(updatedConversation);
    } else {
        conversations[index] = updatedConversation;
    }
    conversations.sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
}

async function enrichConversations(rawConversations) {
    const currentUserId = getCurrentUserId();
    return Promise.all((rawConversations || []).map(async conversation => {
        conversation._uiContext = await buildConversationContext(conversation, currentUserId);
        conversation._participantNames = conversation.participant_names || {};
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
            property: await getHousingById(participantId, 'created_by'),
        }))
    )).filter(item => item.property);

    const ownProperty = participantProperties.find(item => item.participantId === currentUserId)?.property || null;
    const firstSenderId = conversation.messages?.[0]?.sender_id || null;
    const initialReceiverId = participantIds.find(participantId => participantId !== firstSenderId) || null;
    const initialReceiverProperty = participantProperties.find(item => item.participantId === initialReceiverId)?.property || null;
    const firstAvailableProperty = participantProperties[0]?.property || null;
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
        properties: [initialReceiverProperty || ownProperty || firstAvailableProperty].filter(Boolean),
        propertyEntries: participantProperties,
    };
}

/**
 * Creates the compact inbox thumbnail, including stacked images for exchanges.
 */
function renderInboxThumbnail(context) {
    if (context?.isExchange) {
        const properties = getExchangeProperties(context);
        return `
            <div class="chat-thumb-stack flex-shrink-0">
                <img src="${escapeHtml(getPropertyImageUrl(properties[0]))}" alt="Bolig 1">
                <img src="${escapeHtml(getPropertyImageUrl(properties[1]))}" alt="Bolig 2">
            </div>
        `;
    }

    const property = getPrimaryProperty(context);
    return `
        <img src="${escapeHtml(getPropertyImageUrl(property))}" class="chat-thumb-single flex-shrink-0" alt="Bolig">
    `;
}

/**
 * Creates the active chat header thumbnail, including dual images for exchanges.
 */
function renderHeaderThumbnail(context) {
    if (context?.isExchange) {
        const properties = getExchangeProperties(context);
        return `
            <div class="chat-thumb-exchange-header">
                <img src="${escapeHtml(getPropertyImageUrl(properties[0]))}" alt="Bolig 1">
                <div class="chat-exchange-icon" aria-hidden="true">
                    <i class="fa-solid fa-arrow-right-arrow-left"></i>
                </div>
                <img src="${escapeHtml(getPropertyImageUrl(properties[1]))}" alt="Bolig 2">
            </div>
        `;
    }

    const property = getPrimaryProperty(context);
    return `
        <img src="${escapeHtml(getPropertyImageUrl(property))}" class="chat-thumb-single" alt="Bolig">
    `;
}

/**
 * Creates the listing navigation action for the selected conversation.
 */
function renderHeaderAction(context, currentUserId) {
    const property = getConversationActionProperty(context, currentUserId);
    if (!property?._id) return '';

    const label = context?.isExchange ? 'Se deres bolig' : 'Se bolig';
    return `
        <a href="/detaljer?id=${encodeURIComponent(property._id)}"
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
        return [otherParticipantName, 'Byttehandel'].filter(Boolean).join(' · ');
    }

    const property = getPrimaryProperty(context);
    if (!property) {
        return otherParticipantName || 'Samtale';
    }

    if (!property.price) {
        return [otherParticipantName, 'Pris ikke angivet'].filter(Boolean).join(' · ');
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
    if (!property) return 'Andelsbolig';
    return property.street_name || property.address || property.title || 'Andelsbolig';
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
