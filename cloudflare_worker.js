const BACKEND_API_URL = "https://api2.andelsboligbasen.dk/roomies/rooms/all";
const IMAGE_BUCKET_URL = "https://images.andelsboligbasen.dk";
const DEFAULT_IMAGE = "https://roomiedanmark.dk/pics/opengraph3.webp";
const BASE_URL = "https://roomiedanmark.dk";
const CACHE_TTL = 21600; // 6 hours in seconds
const CACHE_KEY = "ALL_ROOMS";

// Social link-preview images (OG/Twitter) must be JPEG: Apple/iMessage does not
// render WebP previews, and Facebook needs accurate dimensions to show the card on
// the first scrape. We force JPEG at a fixed 1200x630 (1.91:1) social-card size via
// Cloudflare Image Transformations.
// Transformations run per zone with Sources = "This zone only", so an image can only
// be transformed via the zone that hosts it:
//   - room photos live on images.andelsboligbasen.dk -> transform via andelsboligbasen.dk
//   - the default OG image lives on roomiedanmark.dk  -> transform via BASE_URL
const ANDELSBOLIG_ZONE = "https://andelsboligbasen.dk";
const SOCIAL_IMAGE_WIDTH = 1200;
const SOCIAL_IMAGE_HEIGHT = 630;
const toSocialImage = (srcUrl, zoneHost = ANDELSBOLIG_ZONE) =>
    `${zoneHost}/cdn-cgi/image/format=jpeg,width=${SOCIAL_IMAGE_WIDTH},height=${SOCIAL_IMAGE_HEIGHT},fit=cover/${srcUrl}`;
const DEFAULT_SOCIAL_IMAGE = toSocialImage(DEFAULT_IMAGE, BASE_URL);

// --- STATIC SEO MAP (Replicating viewManager.js metadata) ---
const STATIC_SEO_ROUTES = {
    '/spoergsmaal-om-roomies': {
        title: 'Spørgsmål og svar om værelser og roomies',
        desc: 'Få svar på spørgsmål om at finde værelse til leje, udleje et værelse, skrive med roomies og bruge Roomie Danmark gratis.'
    },
    '/ledige-vaerelser': {
        title: 'Værelse til leje – ledige værelser i hele Danmark',
        desc: 'Find ledige værelser til leje i København, Aarhus, Odense og Aalborg. Filtrér efter pris og indflytning – og skriv gratis til din nye roomie uden betalingsmur.'
    },
    '/vaerelse': {
        title: 'Værelse til leje | Roomie Danmark',
        desc: 'Se et ledigt værelse til leje: husleje, størrelse, beliggenhed og hverdagen i hjemmet. Skriv gratis til din kommende roomie – ingen betalingsmur.'
    },
    '/udlej-vaerelse': {
        title: 'Udlej værelse gratis – lej dit værelse ud',
        desc: 'Udlej dit værelse gratis hos Roomie Danmark. Opret en annonce og lej dit værelse ud til en tryg roomie blandt studerende og unge på boligjagt – uden skjulte gebyrer.'
    },
    '/boligovervaagning': {
        title: 'SøgeAgent | Få besked om nye værelser',
        desc: 'Opret en gratis SøgeAgent og få besked, når et værelse matcher dit budget og dine områder.'
    },
    '/vilkaar': {
        title: 'Vilkår og betingelser',
        desc: 'Læs vilkår for brug af roomies på roomiedanmark.dk, herunder profiler, værelsesannoncer, beskeder, SøgeAgent og persondata.'
    },
    '/beskeder': {
        title: 'Beskeder',
        desc: 'Se og svar på dine samtaler med roomies om værelser, fællesskab og næste hjem.'
    },
    '/profil': {
        title: 'Profil | Roomie Danmark',
        desc: 'Udfyld din roomie-profil med billede, interesser og ønsker, så andre kan lære dig bedre at kende.'
    },
    '/blog': {
        title: 'Blog om værelser, studiebolig og roomies | Roomie Danmark',
        desc: 'Læs tips og erfaringer om at finde værelse til leje, studiebolig og en god roomie – og om et mere fair boligmarked uden betalingsmure.',
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "Blog",
            "name": "roomies Blog",
            "url": `${BASE_URL}/blog`
        }
    },
    '/blog?slug=hvorfor-det-er-gratis-at-finde-en-roomie': {
        title: 'Hvorfor det ikke skal koste 400 kr. om måneden at finde en roomie i Danmark | Roomie Danmark',
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
                "name": "Roomie Danmark",
                "logo": {
                    "@type": "ImageObject",
                    "url": `${BASE_URL}/favicon/android-chrome-192x192.webp`
                }
            },
            "mainEntityOfPage": `${BASE_URL}/blog?slug=hvorfor-det-er-gratis-at-finde-en-roomie`
        }
    },
    '/': {
        title: 'Værelse til leje & studiebolig i hele Danmark | Roomie Danmark',
        desc: 'Find ledige værelser, studieboliger og din næste roomie i København, Aarhus, Odense og Aalborg. Skriv gratis til alle – ingen betalingsmur.'
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

        // 1. DYNAMISK RUTE: /vaerelse?id=... (per-værelse SEO metadata)
        if (url.pathname === '/vaerelse' && url.searchParams.has('id')) {
            const roomId = url.searchParams.get('id');
            let allRoomsData = null;

            try {
                // 1. Get the ENTIRE dataset from KV Cache
                if (env.ROOMIE_ROOM_CACHE) {
                    allRoomsData = await env.ROOMIE_ROOM_CACHE.get(CACHE_KEY, { type: "json" });
                }

                // 2. Cache MISS: Fetch ALL data from backend and save it
                if (!allRoomsData) {
                    console.log("Cache MISS for Bulk Data. Fetching from backend...");
                    const apiRes = await fetch(BACKEND_API_URL);

                    if (apiRes.ok) {
                        allRoomsData = await apiRes.json();

                        // Save the entire payload to KV in the background
                        if (env.ROOMIE_ROOM_CACHE) {
                            env.ROOMIE_ROOM_CACHE.put(CACHE_KEY, JSON.stringify(allRoomsData), { expirationTtl: CACHE_TTL })
                                .catch(err => console.error("Failed to save bulk data to KV", err));
                        }
                    }
                }

                // 3. Find the specific room
                if (allRoomsData) {
                    const roomsArray = Array.isArray(allRoomsData)
                        ? allRoomsData
                        : (allRoomsData.rooms || allRoomsData.objects || []);
                    const room = roomsArray.find(r => (r._id || r.id) === roomId);

                    if (room) {
                        const formatNumber = (num) => new Intl.NumberFormat('da-DK').format(num || 0);

                        // 1. Lokationsstreng for keywords (f.eks. "2200 København N" eller "Aarhus")
                        let locationStr = "";
                        if (room.postal_number && (room.postal_name || room.city)) {
                            locationStr = `${room.postal_number} ${room.postal_name || room.city}`;
                        } else if (room.postal_name || room.city) {
                            locationStr = room.postal_name || room.city;
                        }

                        // 2. Total månedlig husleje (husleje + aconto). Backend udregner
                        // total_monthly_price; fald tilbage til at summere lokalt.
                        const totalPrice = Number(
                            room.total_monthly_price ??
                            (Number(room.monthly_price ?? room.price ?? 0) + Number(room.acconto_monthly_price ?? 0))
                        );
                        const size = Number(room.square_meters ?? 0);

                        // 3. SEO-titel med eksakt keyword "Værelse til leje" + geo + pris.
                        // F.eks.: "Værelse til leje i 2200 København N – 5.500 kr./md."
                        let seoTitle = "Værelse til leje";
                        if (locationStr) seoTitle += ` i ${locationStr}`;
                        if (totalPrice) seoTitle += ` – ${formatNumber(totalPrice)} kr./md.`;

                        // Google klipper titler ved ~60-65 tegn.
                        if (seoTitle.length < 45) {
                            seoTitle += ` | Roomie Danmark`;
                        } else if (seoTitle.length > 65) {
                            seoTitle = seoTitle.substring(0, 62) + '...';
                        }

                        // 4. Meta description med fokus på CTR + roomies' gratis-vinkel.
                        let seoDesc = "Ledigt værelse til leje";
                        if (locationStr) seoDesc += ` i ${locationStr}`;
                        if (size) seoDesc += ` på ${size} m²`;
                        if (totalPrice) seoDesc += ` til ${formatNumber(totalPrice)} kr./md.`;
                        seoDesc += ". Skriv gratis til din kommende roomie – ingen betalingsmur.";

                        const firstImage = room.images && room.images.length > 0 ? room.images[0] : null;
                        const imageName = typeof firstImage === 'string' ? firstImage : firstImage?.name;
                        // Room photos live on the andelsboligbasen.dk zone; the default lives on
                        // roomiedanmark.dk. Each is transformed via its own zone -> always JPEG.
                        const seoImage = imageName
                            ? toSocialImage(`${IMAGE_BUCKET_URL}/${imageName}`)
                            : DEFAULT_SOCIAL_IMAGE;

                        const canonicalUrl = `${BASE_URL}/vaerelse?id=${roomId}`;

                        const jsonLd = {
                            "@context": "https://schema.org",
                            "@type": "RealEstateListing",
                            "name": seoTitle,
                            "description": seoDesc,
                            "url": canonicalUrl,
                            "image": seoImage,
                            "datePosted": room.created ? new Date(room.created * 1000).toISOString() : undefined,
                            "offers": {
                                "@type": "Offer",
                                "price": totalPrice || 0,
                                "priceCurrency": "DKK",
                                "availability": room.available === false
                                    ? "https://schema.org/OutOfStock"
                                    : "https://schema.org/InStock"
                            },
                            "address": {
                                "@type": "PostalAddress",
                                "addressLocality": room.postal_name || room.city,
                                "postalCode": room.postal_number?.toString(),
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
                            .on('meta[property="og:image:width"]', new AttributeHandler('content', String(SOCIAL_IMAGE_WIDTH)))
                            .on('meta[property="og:image:height"]', new AttributeHandler('content', String(SOCIAL_IMAGE_HEIGHT)))
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

        // Hvis der anmodes om en route, der ikke ligger under STATIC_SEO_ROUTES og ikke er /vaerelse,
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
                .on('meta[property="og:image"]', new AttributeHandler('content', DEFAULT_SOCIAL_IMAGE))
                .on('meta[property="og:image:width"]', new AttributeHandler('content', String(SOCIAL_IMAGE_WIDTH)))
                .on('meta[property="og:image:height"]', new AttributeHandler('content', String(SOCIAL_IMAGE_HEIGHT)))
                .on('meta[property="og:url"]', new AttributeHandler('content', canonicalUrl))
                .on('meta[property="og:locale"]', new AttributeHandler('content', 'da_DK'))
                .on('meta[name="twitter:title"]', new AttributeHandler('content', routeData.title))
                .on('meta[name="twitter:description"]', new AttributeHandler('content', routeData.desc))
                .on('meta[name="twitter:image"]', new AttributeHandler('content', DEFAULT_SOCIAL_IMAGE))
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
