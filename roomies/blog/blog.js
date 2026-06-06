const BLOG_AUTHOR_IMAGE = "/pics/julian3.PNG";

export const BLOG_POSTS = [
    {
        slug: "hvorfor-det-er-gratis-at-finde-en-roomie",
        title: "Hvorfor det ikke skal koste 400 kr. om måneden at finde en roomie i Danmark",
        excerpt: "Det danske lejemarked er brutalt, og boligportaler udnytter boligsøgende med tårnhøje betalingsmure. Her er grunden til, at jeg har bygget et 100% gratis alternativ.",
        publishedDate: "2026-06-06",
        displayDate: "6. juni 2026",
        readingTime: "4 min. læsning",
        author: "Julian Køster",
        category: "Mission",
        heroIcon: "fa-solid fa-hand-holding-heart",
        intro: "Hvis du har ledt efter et værelse eller en roomie i Danmark for nylig, kender du allerede den hårde virkelighed: markedet er brutalt, stressende og ekstremt konkurrencepræget. Men det, der gør det absolut uacceptabelt, er ikke kun manglen på boliger – det er den systematiske udnyttelse af mennesker, der bare leder efter et sted at sove. Derfor har jeg bygget roomies. En 100% gratis platform.",
        sections: [
            {
                title: "Den grådige standardmodel",
                body: [
                    "Lige nu er standardmodellen for bolig- og roomieportaler i Danmark at opsætte en massiv betalingsmur mellem dig og dit fremtidige hjem. De kræver 300, nogle gange over 400 kr. hver eneste måned, bare for at du får lov til at sende en besked til en udlejer eller en potentiel roommate.",
                    "Tænk over det. Du er i forvejen stresset over at finde tag over hovedet. Måske er du studerende på SU, eller måske flytter du til en ny by for at starte på en frisk. For overhovedet at få en chance, tvinges du til at aflevere hundredvis af kroner til et fordyrende mellemled.",
                    "Det er grådigt. Det er et fuldstændig uacceptabelt misbrug af desperate boligsøgende. Og det skal stoppe."
                ]
            },
            {
                title: "En bedre og gratis løsning",
                body: [
                    "Det var præcis den frustration, der fik mig til at bygge roomies.",
                    "Som softwareudvikler ved jeg, hvad det kræver at bygge et sikkert, lynhurtigt og pålideligt system. Og jeg ved med sikkerhed, at det ikke kræver, at man afpresser sine brugere for at holde serverne kørende.",
                    "roomies er en helt ny platform til at finde roomies og udleje værelser, og den er 100% gratis."
                ],
                bullets: [
                    "<strong>Ingen skjulte gebyrer:</strong> Hvad du ser, er hvad du får.",
                    "<strong>Ingen premium-mure:</strong> Dine beskeder bliver aldrig låst bag et dyrt abonnement.",
                    "<strong>Intet krav om betalingskort:</strong> Du kan kontakte præcis dem, du vil, helt gratis."
                ]
            },
            {
                title: "Hjælp mig med at ændre markedet",
                body: [
                    "Jeg har ikke bygget denne platform for at blive millionær. Jeg har bygget den for at løse et problem, der gjorde mig rasende. Boligmarkedet er svært nok i forvejen – det burde ikke koste kassen at komme i kontakt med andre mennesker.",
                    "Fordi denne platform er gratis og ikke tjener penge på dig, har jeg kun én ting at bede om: din støtte. Hvis du har et værelse at leje ud, så opret det her. Hvis du leder efter en roomie, så opret en profil. Og hvis du er enig i, at boligsøgning ikke bør gemmes bag en betalingsmur, så hjælp mig med at dele siden med dit netværk."
                ],
                callout: {
                    icon: "fa-solid fa-users",
                    title: "Lad os fikse markedet sammen",
                    text: "Opret dig i dag og bliv en del af løsningen. Det koster ingenting, og det kommer det heller aldrig til.",
                    cta: {
                        href: "/opret",
                        view: "signup",
                        label: "Opret gratis profil",
                        helper: "Det tager under 1 minut."
                    }
                }
            }
        ],
        finalCta: {
            eyebrow: "Klar til at finde din nye roomie?",
            title: "Start din boligsøgning uden betalingsmur.",
            text: "Opret en profil, find ledige værelser eller lej dit eget værelse ud – helt gratis.",
            primary: {
                href: "/opret",
                view: "signup",
                icon: "fa-regular fa-user",
                label: "Opret gratis profil"
            },
            secondary: {
                href: "/vaerelser",
                view: "room_list",
                icon: "fa-solid fa-magnifying-glass",
                label: "Se ledige værelser"
            }
        }
    }
];

export function getBlogPostBySlug(slug) {
    return BLOG_POSTS.find(post => post.slug === slug) || null;
}

export function getBlogPostUrl(post) {
    return `/blog?slug=${encodeURIComponent(post.slug)}`;
}

export function renderBlogPage(slug) {
    const indexContainer = document.getElementById("blog-index-content");
    const articleContainer = document.getElementById("blog-article-container");

    if (slug) {
        if (indexContainer) indexContainer.classList.add("d-none");
        if (articleContainer) articleContainer.classList.remove("d-none");
        renderBlogArticle(slug);
        return;
    }

    if (articleContainer) {
        articleContainer.classList.add("d-none");
        articleContainer.innerHTML = "";
    }
    if (indexContainer) indexContainer.classList.remove("d-none");
    renderBlogIndex();
}

function renderBlogIndex() {
    const container = document.getElementById("blog-posts-container");
    if (!container) return;

    container.innerHTML = BLOG_POSTS.map(post => `
        <a href="${getBlogPostUrl(post)}" data-view="blog" class="blog-card card border-0 rounded-4 shadow-sm h-100 overflow-hidden hover-lift text-decoration-none">
            <div class="card-body p-4 p-md-5 d-flex flex-column h-100">
                <div class="d-flex align-items-center gap-2 mb-4">
                    <span class="blog-chip">
                        <i class="fa-solid fa-book-open me-1"></i>${post.category}
                    </span>
                    <span class="text-muted small fw-semibold">${post.readingTime}</span>
                </div>

                <div class="blog-card-icon mb-4">
                    <i class="${post.heroIcon}"></i>
                </div>

                <h2 class="h3 fw-bold mb-3">${post.title}</h2>
                <p class="text-muted mb-4 blog-card-excerpt">${post.excerpt}</p>

                <div class="d-flex align-items-center justify-content-between gap-3 mt-auto">
                    <span class="small text-muted fw-semibold">${post.displayDate}</span>
                    <span class="btn btn-primary rounded-pill px-4 fw-bold">
                        Læs indlæg
                        <i class="fa-solid fa-arrow-right ms-2"></i>
                    </span>
                </div>
            </div>
        </a>
    `).join("");
}

function renderBlogArticle(slug) {
    const container = document.getElementById("blog-article-container");
    if (!container) return;

    const post = getBlogPostBySlug(slug) || BLOG_POSTS[0];

    if (!post) {
        container.innerHTML = `
            <div class="container py-5">
                <div class="bg-white rounded-4 shadow-sm p-5 text-center mx-auto" style="max-width: 760px;">
                    <div class="blog-card-icon mx-auto mb-4">
                        <i class="fa-regular fa-file-lines"></i>
                    </div>
                    <h1 class="fw-bold mb-3">Blogindlægget blev ikke fundet</h1>
                    <p class="text-muted mb-4">Indlægget findes ikke længere eller har fået en ny adresse.</p>
                    <a href="/blog" data-view="blog" class="btn btn-primary rounded-pill px-4 fw-bold">
                        <i class="fa-solid fa-arrow-left me-2"></i>Tilbage til bloggen
                    </a>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="blog-article-shell">
            <div class="container py-5">
                <div class="mx-auto" style="max-width: 960px;">
                    <a href="/blog" data-view="blog" class="blog-back-link text-decoration-none d-inline-flex align-items-center mb-4">
                        <i class="fa-solid fa-arrow-left me-2"></i>
                        Tilbage til bloggen
                    </a>

                    <article class="blog-article-card bg-white rounded-4 shadow-sm overflow-hidden">
                        <header class="blog-article-header p-4 p-md-5 text-center text-md-start">
                            <div class="d-flex flex-wrap align-items-center justify-content-center justify-content-md-start gap-2 mb-4">
                                <span class="blog-chip">
                                    <i class="fa-solid fa-book-open me-1"></i>${post.category}
                                </span>
                                <span class="blog-chip blog-chip-soft">
                                    <i class="fa-regular fa-clock me-1"></i>${post.readingTime}
                                </span>
                                <span class="text-muted small fw-semibold">${post.displayDate}</span>
                            </div>

                            <div class="blog-author-card d-inline-flex align-items-center gap-3 rounded-pill bg-white shadow-sm border px-3 py-2 mb-4">
                                <img src="${BLOG_AUTHOR_IMAGE}"
                                     alt="${post.author}, stifter af roomies"
                                     width="56"
                                     height="56"
                                     class="blog-author-photo rounded-circle flex-shrink-0"
                                     loading="eager">
                                <div class="text-start">
                                    <div class="fw-bold company-dark">${post.author}</div>
                                    <div class="small text-muted fw-semibold">Stifter af roomies</div>
                                </div>
                            </div>

                            <div class="row align-items-center gy-4">
                                <div class="col-md-8">
                                    <h1 class="display-5 fw-bold mb-4">${post.title}</h1>
                                    <p class="lead text-muted mb-0">${post.intro}</p>
                                </div>
                                <div class="col-md-4 text-center">
                                    <div class="blog-hero-emblem mx-auto">
                                        <i class="${post.heroIcon}"></i>
                                    </div>
                                </div>
                            </div>
                        </header>

                        <div class="blog-article-body p-4 p-md-5">
                            ${post.sections.map(renderArticleSection).join("")}

                            ${renderFinalCta(post)}
                            ${renderRelatedCta(post)}
                        </div>
                    </article>
                </div>
            </div>
        </div>
    `;
}

export function getBlogPostStructuredData(post, origin = window.location.origin) {
    if (!post) return null;

    return {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post.title,
        "description": post.excerpt,
        "image": `${origin}${BLOG_AUTHOR_IMAGE}`,
        "datePublished": post.publishedDate,
        "dateModified": post.publishedDate,
        "author": {
            "@type": "Person",
            "name": post.author
        },
        "publisher": {
            "@type": "Organization",
            "name": "roomies",
            "logo": {
                "@type": "ImageObject",
                "url": `${origin}/favicon/android-chrome-192x192.webp`
            }
        },
        "mainEntityOfPage": `${origin}${getBlogPostUrl(post)}`
    };
}

export function getBlogStructuredData(origin = window.location.origin) {
    return {
        "@context": "https://schema.org",
        "@type": "Blog",
        "name": "roomies Blog",
        "url": `${origin}/blog`,
        "blogPost": BLOG_POSTS.map(post => ({
            "@type": "BlogPosting",
            "headline": post.title,
            "url": `${origin}${getBlogPostUrl(post)}`,
            "datePublished": post.publishedDate,
            "author": {
                "@type": "Person",
                "name": post.author
            }
        }))
    };
}

function renderArticleSection(section) {
    return `
        <section class="blog-article-section">
            <h2>${section.title}</h2>
            ${(section.body || []).map(paragraph => `<p>${paragraph}</p>`).join("")}
            ${section.bullets ? renderBullets(section.bullets) : ""}
            ${section.callout ? renderCallout(section.callout) : ""}
        </section>
    `;
}

function renderBullets(bullets) {
    return `
        <ul class="blog-article-list">
            ${bullets.map(item => `
                <li>
                    <i class="fa-solid fa-circle-check"></i>
                    <span>${item}</span>
                </li>
            `).join("")}
        </ul>
    `;
}

function renderCallout(callout) {
    return `
        <div class="blog-callout rounded-4 p-4 my-4">
            <div class="d-flex gap-3">
                <div class="blog-callout-icon">
                    <i class="${callout.icon}"></i>
                </div>
                <div>
                    <h3 class="h5 fw-bold mb-2">${callout.title}</h3>
                    <p class="mb-0">${callout.text}</p>
                    ${callout.cta ? renderCalloutCta(callout.cta) : ""}
                </div>
            </div>
        </div>
    `;
}

function renderCalloutCta(cta) {
    return `
        <div class="blog-callout-cta d-flex flex-column flex-sm-row align-items-sm-center gap-3 mt-4">
            <a href="${cta.href}" data-view="${cta.view}" class="btn btn-primary rounded-pill px-4 fw-bold shadow-sm">
                ${cta.label}
                <i class="fa-solid fa-arrow-right ms-2"></i>
            </a>
            <span class="small text-muted fw-semibold">${cta.helper}</span>
        </div>
    `;
}

function renderFinalCta(post) {
    const cta = post.finalCta || {
        eyebrow: "Klar til at finde din nye roomie?",
        title: "Start din boligsøgning uden betalingsmur.",
        text: "Opret en profil, find ledige værelser eller lej dit eget værelse ud – helt gratis.",
        primary: {
            href: "/opret",
            view: "signup",
            icon: "fa-regular fa-user",
            label: "Opret gratis profil"
        },
        secondary: {
            href: "/vaerelser",
            view: "room_list",
            icon: "fa-solid fa-magnifying-glass",
            label: "Se ledige værelser"
        }
    };

    return `
        <aside class="blog-final-cta rounded-4 p-4 p-md-5 mt-5">
            <div class="row align-items-center gy-4">
                <div class="col-lg-7">
                    <p class="small text-uppercase fw-bold text-primary mb-2">${cta.eyebrow}</p>
                    <h2 class="h3 fw-bold mb-3">${cta.title}</h2>
                    <p class="text-muted mb-0">${cta.text}</p>
                </div>
                <div class="col-lg-5">
                    <div class="d-grid gap-2">
                        <a href="${cta.primary.href}" data-view="${cta.primary.view}" class="btn btn-primary rounded-pill py-3 fw-bold shadow-sm">
                            <i class="${cta.primary.icon} me-2"></i>${cta.primary.label}
                        </a>
                        <a href="${cta.secondary.href}" data-view="${cta.secondary.view}" class="btn btn-outline-primary rounded-pill py-3 fw-bold">
                            <i class="${cta.secondary.icon} me-2"></i>${cta.secondary.label}
                        </a>
                    </div>
                </div>
            </div>
        </aside>
    `;
}

function renderRelatedCta(post) {
    if (!post.relatedCta) return "";

    const cta = post.relatedCta;

    return `
        <aside class="blog-related-cta rounded-4 p-4 mt-4">
            <div class="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-4">
                <div>
                    <p class="small text-uppercase fw-bold text-primary mb-2">${cta.eyebrow}</p>
                    <h2 class="h4 fw-bold mb-2">${cta.title}</h2>
                    <p class="text-muted mb-0">${cta.text}</p>
                </div>
                <a href="${cta.href}" data-view="${cta.view}" class="btn btn-outline-primary rounded-pill px-4 py-3 fw-bold flex-shrink-0">
                    <i class="${cta.icon} me-2"></i>${cta.label}
                </a>
            </div>
        </aside>
    `;
}