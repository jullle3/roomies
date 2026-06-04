const BACKEND_API_URL = "https://api2.roomies.dk/advertisement?page=0&size=10000";
const IMAGE_BUCKET_URL = "https://images.roomies.dk";
const DEFAULT_IMAGE = "https://roomies.dk/pics/opengraph.webp";
const BASE_URL = "https://roomies.dk";
const CACHE_TTL = 21600; // 6 hours in seconds
const CACHE_KEY = "ALL_ADVERTISEMENTS";

// --- STATIC SEO MAP (Replicating viewManager.js metadata) ---
const STATIC_SEO_ROUTES = {
    '/saelg-andelsbolig-selv': {
        title: 'Sælg andelsbolig selv - 100% gratis | Salg & Bytte',
        desc: 'Sælg din andelsbolig selv og spar mægleren. Det er 100% gratis at oprette din annonce til salg eller bytte af andelsbolig.',
    },
    '/saelg-andelsbolig-selv-koncept': {
        title: 'Sælg din andelsbolig selv – 100% gratis | Se konceptet',
        desc: 'Står du overfor et salg af din andelsbolig? Lad roomies hjælpe dig trygt og nemt videre. Uanset om din bolig ligger i København, Aarhus, på Frederiksberg, Amager, Østerbro eller et andet sted i Danmark, gør vi det enkelt at finde den rette køber.',
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "Må jeg sælge min andelsbolig selv?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Ja, du må i høj grad gerne sælge din andelsbolig selv. Faktisk er selvsalg den mest almindelige måde at sælge andelsboliger på i Danmark. Du behøver ingen ejendomsmægler, da andelsboligforeningens administrator typisk står for at udarbejde overdragelsesaftalen og håndtere det juridiske papirarbejde."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvad er processen når jeg sælger selv?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Processen er simpel: 1. Undersøg først, hvilke regler og processer der gælder i din specifikke andelsboligforening (f.eks. krav til vurderingsmand). 2. Opret en gratis annonce på roomies og fremvis boligen for interesserede købere. 3. Når du har fundet din køber, giver du besked til foreningens administrator, som herefter opretter overdragelsesaftalen og indhenter bestyrelsens godkendelse."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Er det usikkert at sælge uden en ejendomsmægler?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Nej, og salg går ofte hurtigere ved selvsalg. Alt salg af andelsboliger skal lovpligtigt godkendes af andelsboligforeningens bestyrelse. Det er foreningens professionelle administrator (ofte en advokat), der udarbejder selve købsaftalen og håndterer købesummen sikkert via en deponeringskonto. Mæglerens primære job er blot at finde køberen, hvilket vi hjælper dig med."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvad koster det at sælge andelsbolig?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Hos roomies er det 100% gratis at sælge. Dine eneste udgifter ved et selvsalg vil typisk være et overdragelsesgebyr til foreningens administrator, udgiften til en vurderingsmand, et gebyr til banken for indfrielse af dit eventuelle lån, samt et el- og VVS-tjek, hvis din forening kræver det."
                    }
                }
            ]
        }
    },
    '/spoergsmaal-om-andelsbolig': {
        title: 'Ofte stillede spørgsmål | roomies',
        desc: 'Få svar på alle dine spørgsmål om køb, salg og bytte af andelsboliger og læs mere om hvordan roomies fungerer her.',
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "Hvordan fungerer konceptet?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "I dag er andelsboligmarkedet spredt ud over hele internettet – på DBA, Boliga, i over 50 forskellige Facebook-grupper og mange andre steder. Det problem løser vi. Vi samler markedet ét sted og gør det skjulte marked synligt for alle. Det er 100% gratis at sælge eller bytte din andelsbolig via os, og vi sørger for at annoncere din bolig ud til mange tusinde købere."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Koster det penge at sælge min andelsbolig?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Nej, det er 100% gratis at oprette en salgs- eller bytteannonce på roomies. Vi har fjernet de dyre mellemled, så du trygt kan finde den rette køber uden at skulle have penge op af lommen."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvad koster det at kontakte en sælger?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "For kun 99 kr. om måneden får du fuld adgang til at kontakte alle sælgere direkte og se de fulde adressedetaljer. Der er 0 skjulte gebyrer og absolut ingen binding – du kan afmelde dig præcis, når du vil. Vores pris er desuden over 75% billigere end lignende portaler."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvad er processen når jeg sælger selv?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Overordnet set er processen simpel: 1. Undersøg først, hvilke regler og processer der gælder i din specifikke andelsboligforening (f.eks. krav til vurderingsmand). 2. Opret en gratis annonce på roomies. Vi finder interesserede købere og du fremviser boligen. 3. Når du har fundet din køber, giver du besked til foreningens administrator, som herefter opretter overdragelsesaftalen og indhenter bestyrelsens godkendelse."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvordan fungerer BoligMatch?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Med BoligMatch overvåger vi markedet for dig helt automatisk. Du opretter dine kriterier (f.eks. pris, størrelse og område), og vi sender dig en e-mail i samme sekund, som en andelsbolig, der matcher dine drømme, bliver sat til salg."
                    }
                },
                {
                    "@type": "Question",
                    "name": "Hvor kommer boligerne fra?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Boligerne på platformen kommer fra to primære kilder. Flere og flere andelshavere opretter selv deres salgs- og bytteannoncer direkte hos os, fordi det er gratis, og fordi vi hjælper med salget. For at hjælpe dig med at overvåge et ellers uoverskueligt marked, bruger vi derudover avanceret teknologi til automatisk at indsamle annoncer fra resten af internettet, herunder DBA, Boliga og diverse internetsider. På den måde behøver du kun at lede ét sted. Vi håber du finder drømmeboligen hos os 😊"
                    }
                }
            ]
        }
    },
    '/liste': {
        title: 'Andelsboliger til salg i København, Aarhus og hele Danmark',
        desc: 'Se alle aktuelle andelsboliger til salg her. Find din nye andelslejlighed i København (inkl. 2100 Østerbro), Amager, Frederiksberg, Aarhus. m.m.',
    },
    '/soeg-vaerelse': {
        title: 'Søg værelse og find din næste roomie | roomies',
        desc: 'Find ledige værelser i København, Aarhus og resten af Danmark. Filtrér efter pris, størrelse og den hverdag, du gerne vil være en del af.',
    },
    '/boligovervaagning': {
        title: 'Køb andelsbolig | Få besked når andelsboliger sættes til salg',
        desc: 'Gå ikke glip af drømmeboligen. Opret et gratis BoligMatch og få besked så snart, drømmebolien sættes til salg til salg.',
    },
    '/kort': {
        title: 'Kort over andelsboliger til salg | Find andelsbolig nær dig',
        desc: 'Søg efter andelsboliger til salg via vores kort. Find nemt en andelsbolig i indre København, Amager, Frederiksberg, Lyngby, Aarhus og resten af landet.',
    },
    '/vilkaar': {
        title: 'Vilkår og Betingelser | roomies',
        desc: 'Læs de gældende vilkår og betingelser for brug af roomies. Få overblik over regler for køb af andelsbolig, annoncering og persondatahåndtering.',
    },
    '/om-os': {
        title: 'Om roomies | Nem, billig og hurtig bolighandel',
        desc: 'Læs historien bag roomies. Vi tilstræber at gøre det mere gennemsigtigt, billigt og nemt at købe, sælge og bytte andelsboliger i Danmark.',
    },
    '/blog': {
        title: 'Blog | roomies',
        desc: 'Læs historier, tips og erfaringer fra andelsboligmarkedet. Få inspiration til boligjagten, selvsalg og BoligMatch.',
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "Blog",
            "name": "roomies Blog",
            "url": `${BASE_URL}/blog`,
            "blogPost": [
                {
                    "@type": "BlogPosting",
                    "headline": "Sådan fik jeg tilbudt 10 attraktive andelsboliger i København på under en måned",
                    "url": `${BASE_URL}/blog?slug=saadan-fik-jeg-tilbudt-10-andelsboliger-i-koebenhavn`,
                    "datePublished": "2026-05-13",
                    "author": {
                        "@type": "Person",
                        "name": "Julian Køster"
                    }
                },
                {
                    "@type": "BlogPosting",
                    "headline": "Historien bag roomies",
                    "url": `${BASE_URL}/blog?slug=historien-bag-andelsbolig-basen`,
                    "datePublished": "2026-04-30",
                    "author": {
                        "@type": "Person",
                        "name": "Julian KÃ¸ster"
                    }
                }
            ]
        }
    },
    '/blog?slug=saadan-fik-jeg-tilbudt-10-andelsboliger-i-koebenhavn': {
        title: 'Sådan fik jeg tilbudt 10 attraktive andelsboliger i København på under en måned | roomies',
        desc: 'Min personlige historie om forberedelse, hurtig kontakt og det flyer-trick, der hjalp mig med at finde en andelsbolig i København.',
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": "Sådan fik jeg tilbudt 10 attraktive andelsboliger i København på under en måned",
            "description": "Min personlige historie om forberedelse, hurtig kontakt og det flyer-trick, der hjalp mig med at finde en andelsbolig i København.",
            "datePublished": "2026-05-13",
            "dateModified": "2026-05-13",
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
            "mainEntityOfPage": `${BASE_URL}/blog?slug=saadan-fik-jeg-tilbudt-10-andelsboliger-i-koebenhavn`
        }
    },
    '/blog?slug=historien-bag-andelsbolig-basen': {
        title: 'Historien bag roomies | roomies',
        desc: 'Hvorfor jeg byggede roomies, og hvordan en frustrerende boligjagt blev til en billigere, nemmere og tryggere platform for andelsboliger.',
        jsonLd: {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": "Historien bag roomies",
            "description": "Hvorfor jeg byggede roomies, og hvordan en frustrerende boligjagt blev til en billigere, nemmere og tryggere platform for andelsboliger.",
            "datePublished": "2026-04-30",
            "dateModified": "2026-04-30",
            "author": {
                "@type": "Person",
                "name": "Julian KÃ¸ster"
            },
            "publisher": {
                "@type": "Organization",
                "name": "roomies",
                "logo": {
                    "@type": "ImageObject",
                    "url": `${BASE_URL}/favicon/android-chrome-192x192.webp`
                }
            },
            "mainEntityOfPage": `${BASE_URL}/blog?slug=historien-bag-andelsbolig-basen`
        }
    },
    '/': {
        title: 'Andelsboliger til salg | Køb, Salg & Bytte af andelsbolig',
        desc: 'Danmarks nye portal for andelsboliger. Find andelsboliger til salg i København, Frederiksberg og Aarhus, eller sælg din andelsbolig selv – 100% gratis.',
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
