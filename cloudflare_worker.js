const BACKEND_API_URL = "https://api2.roomies.dk/advertisement?page=0&size=10000";
const IMAGE_BUCKET_URL = "https://images.roomies.dk";
const DEFAULT_IMAGE = "https://roomiedanmark.dk/pics/opengraph2.webp";
const BASE_URL = "https://roomiedanmark.dk";
const CACHE_TTL = 21600; // 6 hours in seconds
const CACHE_KEY = "ALL_ADVERTISEMENTS";

// --- STATIC SEO MAP (Replicating viewManager.js metadata) ---
const STATIC_SEO_ROUTES = {
    '/spoergsmaal-om-roomies': {
        title: 'Spørgsmål og svar | roomies',
        desc: 'Få svar på spørgsmål om at finde værelse, udleje et værelse, skrive med roomies og bruge roomies gratis.'
    },
    '/ledige-vaerelser': {
        title: 'Søg værelse og find din næste roomie | roomies',
        desc: 'Find ledige værelser i København, Aarhus og resten af Danmark. Filtrér efter pris, indflytning og den hverdag, du gerne vil være en del af.'
    },
    '/vaerelse': {
        title: 'Ledigt værelse | roomies',
        desc: 'Se detaljer om et ledigt værelse på roomies, herunder husleje, størrelse, beliggenhed og hverdagen i hjemmet.'
    },
    '/udlej-vaerelse': {
        title: 'Udlej værelse gratis | Find en roomie med roomies',
        desc: 'Udlej dit værelse gratis på roomies. Opret en annonce, find en tryg roomie, og få kontakt med unge på boligjagt uden skjulte gebyrer.'
    },
    '/boligovervaagning': {
        title: 'SøgeAgent | Få besked om nye værelser',
        desc: 'Opret en gratis SøgeAgent og få besked, når et værelse matcher dit budget og dine områder.'
    },
    '/vilkaar': {
        title: 'Vilkår og betingelser | roomies',
        desc: 'Læs vilkår for brug af roomies på roomiedanmark.dk, herunder profiler, værelsesannoncer, beskeder, SøgeAgent og persondata.'
    },
    '/beskeder': {
        title: 'Beskeder | roomies',
        desc: 'Se og svar på dine samtaler med roomies om værelser, fællesskab og næste hjem.'
    },
    '/profil': {
        title: 'Profil | roomies',
        desc: 'Udfyld din roomie-profil med billede, interesser og ønsker, så andre kan lære dig bedre at kende.'
    },
    '/blog': {
        title: 'Blog | roomies',
        desc: 'Læs historier, tips og erfaringer om roomies, ledige værelser og et mere fair boligmarked uden betalingsmure.',
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "Blog",
            "name": "roomies Blog",
            "url": `${BASE_URL}/blog`
        }
    },
    '/blog?slug=hvorfor-det-er-gratis-at-finde-en-roomie': {
        title: 'Hvorfor det ikke skal koste 400 kr. om måneden at finde en roomie i Danmark | roomies',
        desc: 'Det danske lejemarked er brutalt, og boligportaler udnytter boligsøgende med tårnhøje betalingsmure. Her er grunden til, at roomies er gratis.',
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": "Hvorfor det ikke skal koste 400 kr. om måneden at finde en roomie i Danmark",
            "description": "Det danske lejemarked er brutalt, og boligportaler udnytter boligsøgende med tårnhøje betalingsmure. Her er grunden til, at roomies er gratis.",
            "datePublished": "2026-06-06",
            "dateModified": "2026-06-06",
            "author": {
                "@type": "Person",
                "name": "Julian Køster"
            },
            "publisher": {
                "@type": "Organization",
                "name": "roomies",
                "logo": {
                    "@type": "ImageObject",
                    "url": `${BASE_URL}/favicon/android-chrome-192x192.webp`
                }
            },
            "mainEntityOfPage": `${BASE_URL}/blog?slug=hvorfor-det-er-gratis-at-finde-en-roomie`
        }
    },
    '/': {
        title: 'roomies | Find værelse eller roomie i Danmark',
        desc: 'Find dit næste værelse eller en ny roomie i Danmark. Opret annonce, skriv beskeder og brug SøgeAgent helt gratis.'
    }
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const response = await fetch(request);

        // Optimering: Vi spilder ikke tid på at tjekke/omskrive assets (CSS, JS, billeder)
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("text/html")) {
            return response;
        }

        // 1. DYNAMISK RUTE: /detaljer?id=...
        if (url.pathname === '/detaljer' && url.searchParams.has('id')) {
            const housingId = url.searchParams.get('id');
            let allHousingData = null;

            try {
                // 1. Get the ENTIRE dataset from KV Cache
                if (env.SEO_CACHE) {
                    allHousingData = await env.SEO_CACHE.get(CACHE_KEY, { type: "json" });
                }

                // 2. Cache MISS: Fetch ALL data from backend and save it
                if (!allHousingData) {
                    console.log("Cache MISS for Bulk Data. Fetching from backend...");
                    const apiRes = await fetch(BACKEND_API_URL);

                    if (apiRes.ok) {
                        allHousingData = await apiRes.json();

                        // Save the entire payload to KV in the background
                        if (env.SEO_CACHE) {
                            env.SEO_CACHE.put(CACHE_KEY, JSON.stringify(allHousingData), { expirationTtl: CACHE_TTL })
                                .catch(err => console.error("Failed to save bulk data to KV", err));
                        }
                    }
                }

                // 3. Find the specific housing item
                if (allHousingData) {
                    const adsArray = Array.isArray(allHousingData) ? allHousingData : (allHousingData.objects || []);
                    const housing = adsArray.find(ad => ad._id === housingId);

                    if (housing) {
                        const formatNumber = (num) => new Intl.NumberFormat('da-DK').format(num || 0);

                        const streetStr = `${housing.street_name || ''} ${housing.house_number || ''}`.trim();

                        // 1. Byg en stærk lokationsstreng for keywords (f.eks. "8361 Hasselager" eller "Aarhus")
                        let locationStr = "";
                        if (housing.postal_number && housing.city) {
                            locationStr = `${housing.postal_number} ${housing.city}`;
                        } else if (housing.city || housing.postal_name) {
                            locationStr = housing.city || housing.postal_name;
                        }

                        // 2. Brug eksakte match fra Keyword Planner analyse
                        const isSwap = housing.exchange_only;
                        const actionKeyword = isSwap ? "Bytte andelsbolig" : "Andelsbolig til salg";

                        // 3. Byg SEO Titlen. Output f.eks.: "Andelsbolig til salg i 8361 Hasselager - Skovhøj 165"
                        let seoTitle = `${actionKeyword}`;
                        if (locationStr) seoTitle += ` i ${locationStr}`;
                        if (streetStr) seoTitle += ` - ${streetStr}`;

                        // Google klipper titler ved ~60-65 tegn.
                        if (seoTitle.length < 45) {
                            seoTitle += ` | roomies`;
                        } else if (seoTitle.length > 65) {
                            seoTitle = seoTitle.substring(0, 62) + '...';
                        }

                        // 4. Optimeret Meta Description med fokus på CTR
                        let seoDesc = `${actionKeyword} på ${housing.square_meters} m² med ${housing.rooms} værelser`;
                        if (locationStr) seoDesc += ` beliggende i ${locationStr}. `;
                        else seoDesc += `. `;

                        if (housing.price) seoDesc += `Pris: ${formatNumber(housing.price)} kr. `;
                        if (housing.monthly_fee) seoDesc += `Boligafgift: ${formatNumber(housing.monthly_fee)} kr./md. `;
                        if (housing.description) {
                            seoDesc += housing.description.substring(0, 80).trim().replace(/\n/g, ' ') + '...';
                        }

                        const seoImage = housing.images && housing.images.length > 0
                            ? `${IMAGE_BUCKET_URL}/${housing.images[0].name}`
                            : DEFAULT_IMAGE;

                        const canonicalUrl = `${BASE_URL}/detaljer?id=${housingId}`;

                        const jsonLd = {
                            "@context": "https://schema.org",
                            "@type": "RealEstateListing",
                            "name": seoTitle,
                            "description": seoDesc,
                            "url": canonicalUrl,
                            "image": seoImage,
                            "datePosted": housing.created ? new Date(housing.created * 1000).toISOString() : undefined,
                            "offers": {
                                "@type": "Offer",
                                "price": housing.price || 0,
                                "priceCurrency": "DKK",
                                "availability": "https://schema.org/InStock"
                            },
                            "address": {
                                "@type": "PostalAddress",
                                "streetAddress": streetStr,
                                "addressLocality": housing.city || housing.postal_name,
                                "postalCode": housing.postal_number?.toString(),
                                "addressCountry": "DK"
                            }
                        };

                        return new HTMLRewriter()
                            .on('head', new HeadHandler(JSON.stringify(jsonLd), canonicalUrl))
                            .on('title', new ElementHandler(seoTitle))
                            .on('meta[name="description"]', new AttributeHandler('content', seoDesc))
                            .on('meta[property="og:title"]', new AttributeHandler('content', seoTitle))
                            .on('meta[property="og:description"]', new AttributeHandler('content', seoDesc))
                            .on('meta[property="og:image"]', new AttributeHandler('content', seoImage))
                            .on('meta[property="og:url"]', new AttributeHandler('content', canonicalUrl))
                            .on('meta[property="og:locale"]', new AttributeHandler('content', 'da_DK'))
                            .on('meta[name="twitter:title"]', new AttributeHandler('content', seoTitle))
                            .on('meta[name="twitter:description"]', new AttributeHandler('content', seoDesc))
                            .on('meta[name="twitter:image"]', new AttributeHandler('content', seoImage))
                            .transform(response);
                    }
                }
            } catch (err) {
                console.error("Worker Error:", err);
                return response;
            }
        }

        // 2. STATISKE RUTER (Forside, /liste, /opret, osv.)
        // Checker om det eksakte path ligger i vores SEO map. Ellers falder vi tilbage til forsiden '/'.
        const blogSlug = url.pathname === '/blog' ? url.searchParams.get('slug') : null;
        const routeKey = blogSlug ? `/blog?slug=${blogSlug}` : url.pathname;
        let routeData = STATIC_SEO_ROUTES[routeKey];

        // Hvis der anmodes om en route, der ikke ligger under STATIC_SEO_ROUTES og ikke er /detaljer,
        // (f.eks. ukendte paths der sendes til index.html via dine fallback regler), så brug default '/'.
        if (!routeData && url.pathname === '/') {
            routeData = STATIC_SEO_ROUTES['/'];
        }

        if (routeData) {
            const canonicalUrl = `${BASE_URL}${routeKey}`;
            const jsonLdString = routeData.jsonLd ? JSON.stringify(routeData.jsonLd) : null;

            return new HTMLRewriter()
                .on('head', new HeadHandler(jsonLdString, canonicalUrl))
                .on('title', new ElementHandler(routeData.title))
                .on('meta[name="description"]', new AttributeHandler('content', routeData.desc))
                .on('meta[property="og:title"]', new AttributeHandler('content', routeData.title))
                .on('meta[property="og:description"]', new AttributeHandler('content', routeData.desc))
                .on('meta[property="og:image"]', new AttributeHandler('content', DEFAULT_IMAGE))
                .on('meta[property="og:url"]', new AttributeHandler('content', canonicalUrl))
                .on('meta[property="og:locale"]', new AttributeHandler('content', 'da_DK'))
                .on('meta[name="twitter:title"]', new AttributeHandler('content', routeData.title))
                .on('meta[name="twitter:description"]', new AttributeHandler('content', routeData.desc))
                .on('meta[name="twitter:image"]', new AttributeHandler('content', DEFAULT_IMAGE))
                .transform(response);
        }

        // Fallback for evt. assets/dokumenter vi alligevel ramte
        return response;
    }
};

// --- HTMLRewriter Helper Classes ---
class HeadHandler {
    constructor(jsonLdString, canonicalUrl) {
        this.jsonLdString = jsonLdString;
        this.canonicalUrl = canonicalUrl;
    }
    element(element) {
        // Undgå tomme tags. Injektér kun hvis variablen findes.
        if (this.canonicalUrl) {
            element.append(`<link rel="canonical" href="${this.canonicalUrl}">\n`, { html: true });
        }
        if (this.jsonLdString) {
            element.append(`<script type="application/ld+json">${this.jsonLdString}</script>\n`, { html: true });
        }
    }
}

class ElementHandler {
    constructor(content) { this.content = content; }
    element(element) { element.setInnerContent(this.content); }
}

class AttributeHandler {
    constructor(attributeName, content) { this.attributeName = attributeName; this.content = content; }
    element(element) { element.setAttribute(this.attributeName, this.content); }
}
