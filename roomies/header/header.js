import { decodeJwt } from "../utils.js";

let navbarAutoCloseInitialized = false;

export function SetupHeader() {
    updateNavbar(); // Initial state check
    setupNavbarAutoClose();

    // Setup event handlers
    document.querySelectorAll('nav ul li a').forEach(link => {
        link.addEventListener('click', function() {
            document.querySelectorAll('nav ul li a').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

function setupNavbarAutoClose() {
    if (navbarAutoCloseInitialized) return;

    const navbar = document.querySelector('.navbar');
    const navbarCollapse = document.getElementById('navMenu');

    if (!navbar || !navbarCollapse) return;

    navbarAutoCloseInitialized = true;

    document.addEventListener('click', (event) => {
        if (!navbarCollapse.classList.contains('show')) return;
        if (navbar.contains(event.target)) return;

        closeNavbarMenu();
    });

}

export function closeNavbarMenu() {
    const navbarCollapse = document.getElementById('navMenu') || document.querySelector('.navbar-collapse');
    if (!navbarCollapse || !navbarCollapse.classList.contains('show')) return;

    if (typeof bootstrap !== 'undefined' && bootstrap.Collapse) {
        bootstrap.Collapse.getOrCreateInstance(navbarCollapse, { toggle: false }).hide();
        return;
    }

    navbarCollapse.classList.remove('show');
    document.querySelector('.navbar-toggler')?.setAttribute('aria-expanded', 'false');
}

export function updateNavbar() {
    const decodedJwt = decodeJwt();

    const profileLink = document.querySelector('[data-view="profile"]')?.parentElement;
    const conversationsLink = document.querySelector('[data-view="conversations"]')?.parentElement;
    const logoutLink = document.getElementById("logout")?.parentElement;
    const loginLink = document.getElementById('login')?.parentElement;
    const navbarGreetingText = document.getElementById('navbar-name-text');
    const navbarGreeting = document.getElementById('navbar-name');

    const setGreetingText = (text) => {
        if (navbarGreetingText) {
            navbarGreetingText.textContent = text;
            return;
        }

        if (!navbarGreeting) return;

        const textNode = Array.from(navbarGreeting.childNodes)
            .find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

        if (textNode) {
            textNode.textContent = text;
        } else {
            navbarGreeting.insertAdjacentText('afterbegin', text);
        }
    };

    if (loggedIn()) {
        if (profileLink) profileLink.style.display = 'block';
        if (conversationsLink) conversationsLink.style.display = 'block';
        if (logoutLink) logoutLink.style.display = 'block';
        if (loginLink) loginLink.style.display = 'none';
        setGreetingText(getFirstName(decodedJwt?.full_name) || 'Min profil');
    } else {
        if (profileLink) profileLink.style.display = 'none';
        if (conversationsLink) conversationsLink.style.display = 'none';
        if (logoutLink) logoutLink.style.display = 'none';
        if (loginLink) loginLink.style.display = 'block';
        setGreetingText("Log ind her");
    }
}

function loggedIn() {
    return localStorage.getItem('jwt') !== null;
}

function getFirstName(fullName) {
    return String(fullName || '').trim().split(/\s+/)[0] || '';
}

export function renderLandingCarousel(slides) {
    const inner = document.getElementById('landing-carousel-inner');
    if (!inner) return;

    inner.innerHTML = slides.map((html, i) =>
        `<div class="carousel-item ${i === 0 ? 'active' : ''}">
       <div class="d-flex justify-content-center align-items-center py-3">${html}</div>
     </div>`
    ).join('');

    const el = document.getElementById('priceChangeCarousel');
    if (el && typeof bootstrap !== 'undefined') {
        const inst = bootstrap.Carousel.getOrCreateInstance(el, {
            interval: 5000,
            pause: false,
            ride: true,
            wrap: true,
            touch: false
        });
        inst.cycle();
    }
}

export function loadHousingStats(advertisementData) {
    const sold = Number(advertisementData.sold ?? 0);
    const newL = Number(advertisementData.new_listings ?? 0);

    // Large carousel on Landing Page
    renderLandingCarousel([
        `<i class="fa-regular fa-bell text-primary me-2 fs-5"></i><span class="fs-5 opacity-75"><strong class="text-dark">${newL}</strong> nye annoncer</span>`,
        `<i class="fa-regular fa-circle-check text-primary me-2 fs-5"></i><span class="fs-5 opacity-75"><strong class="text-dark">${sold}</strong> solgt (7 dage)</span>`
    ]);

    // Header Ticker (Navbar)
    const header = document.getElementById('header-stats');
    const line   = document.getElementById('stat-line');
    if (!header || !line) return;

    if (window.innerWidth < 992) {
        header.classList.add('d-none');
        return;
    }
    header.classList.remove('d-none');

    // The simplified text you liked, now perfectly aligned
    const msgs = [
        // Message 1
        `<div class="d-inline-flex align-items-center">
            <i class="fa-regular fa-bell text-primary me-2" style="font-size: 1.1em;"></i>
            <span style="font-weight: 500; color: #4b5563;">
                <strong style="color: var(--company-dark); font-weight: 700;">${newL}</strong> nye annoncer
            </span>
         </div>`,

        // Message 2
        `<div class="d-inline-flex align-items-center">
            <i class="fa-regular fa-circle-check text-primary me-2" style="font-size: 1.1em;"></i>
            <span style="font-weight: 500; color: #4b5563;">
                <strong style="color: var(--company-dark); font-weight: 700;">${sold}</strong> solgt (7 dage)
            </span>
         </div>`
    ];

    let i = 0;
    function render(htmlContent) {
        // Reset state for animation
        line.style.transition = 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1), opacity 250ms ease';
        line.style.opacity = 0;
        line.style.transform = 'translateY(-10px)'; // Slide from top

        setTimeout(() => {
            line.innerHTML = htmlContent;

            // Trigger slide in
            line.style.transform = 'translateY(10px)'; // Start slightly below

            // Force reflow/next tick to ensure transition happens
            requestAnimationFrame(() => {
                line.style.transform = 'translateY(0)';
                line.style.opacity = 1;
            });
        }, 200);
    }

    render(msgs[i]);
    setInterval(() => { i = (i + 1) % msgs.length; render(msgs[i]); }, 6000);
}

window.updateNavbar = updateNavbar;
