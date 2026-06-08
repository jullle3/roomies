

Popup prompting their user if theyre sure they want to delete the room. Use the "genericConfirmationModal" HTML and draw inspiration from this implementation

<div class="modal fade" id="deleteRoomModal" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg rounded-4 p-4">
            <div class="text-center mb-4">
                <div class="d-inline-flex align-items-center justify-content-center bg-danger bg-opacity-10 text-danger rounded-circle mb-3" style="width: 64px; height: 64px;">
                    <i class="fa-solid fa-triangle-exclamation fs-2"></i>
                </div>
                <h3 class="fw-bold">Slet annonce?</h3>
                <p class="text-muted mb-0">Er du sikker på, at du vil slette denne annonce? Dette kan ikke fortrydes, og alle billeder og beskrivelser vil gå tabt.</p>
                <p class="small text-muted mt-2">Tip: Hvis værelset er udlejet, anbefaler vi at bruge "Markér som udlejet" i stedet.</p>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-light rounded-pill w-50 fw-bold" data-bs-dismiss="modal">Annuller</button>
                <button type="button" class="btn btn-danger rounded-pill w-50 fw-bold" id="btn-confirm-delete-room">
                    <i class="fa-solid fa-trash-can me-2"></i>Slet permanent
                </button>
            </div>
        </div>
    </div>
</div>

function getDeleteHousingModalHtml() {
const isReserved = usersCurrentActiveHousing?.reserved === true;
const isSold = usersCurrentActiveHousing?.sold === true;
const reserveLabel = isReserved ? 'Allerede reserveret' : 'Markér som reserveret';
const soldLabel = isSold ? 'Allerede solgt' : 'Markér som solgt';
const reserveStyle = `color: ${isReserved ? '#ffffff' : '#d97706'}; background-color: ${isReserved ? '#d97706' : '#fef3c7'}; border: 1px solid #fcd34d;`;
const soldStyle = `color: ${isSold ? '#ffffff' : '#166534'}; background-color: ${isSold ? '#166534' : '#dcfce7'}; border: 1px solid #86efac;`;

    return [
        'Måske behøver du ikke slette annoncen. Hvis annoncen er sat på pause eller du har en køber, kan du markere den som reserveret eller solgt.',
        '<div class="d-grid gap-2 mt-4 text-start">',
        `<button type="button" class="btn rounded-pill py-3 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2" id="delete-modal-reserve-btn" ${isReserved ? 'disabled' : ''} style="${reserveStyle}"><i class="fa-solid fa-hourglass-half"></i><span>${reserveLabel}</span></button>`,
        `<button type="button" class="btn rounded-pill py-3 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2" id="delete-modal-sold-btn" ${isSold ? 'disabled' : ''} style="${soldStyle}"><i class="fa-solid fa-handshake"></i><span>${soldLabel}</span></button>`,
        '</div>',
        '<p class="small text-muted mt-4 mb-0">Slet kun annoncen, hvis den skal fjernes permanent.</p>'
    ].join('');
}


function openDeleteHousingOptionsModal(id) {
showConfirmationModal(
'Vil du slette annoncen?',
getDeleteHousingModalHtml(),
async () => {
const res = await authFetch(`/advertisement/${id}`, { method: 'DELETE' });
if (res.ok) {
displaySuccessMessage("Annonce slettet");
setTimeout(() => showView("liste"), 500);
resetForm();
} else {
displayErrorMessage("Kunne ikke slette annonce");
}
}
);

    setupDeleteModalStatusActions();
}

- It seems theres a blocking request when accesing view "boligovervaagning", please dont block the entering of the view as its bad UX, perhaps show a loading spinner on the view or similar instead so the site doesnt feel laggy for the user
- Synes ikke billeder blev til webp? Mangler frontend optimering, eller backend? 
- Upload af billede skal trigger en update mod backend med det samme, uden at behøve at klikke gem. Man skal også kunne vælge et billede ved at klikke på sit profilbillede
- Tilpas Room i backend ud fra frontend properties, se codex chat. 
- Jeg skriver gratis lidt for ofte og mange steder
- When the user wants to create an SøgeAgent, in case they have NOT filled out their roomie profile (read local cache), show a popup prompting them to do so. It should link them to the profile page directly to  roomie-profile section
- Find god måde at få folks profilbilleder vist på room listings, det giver tillid.
- Remove the "favorite" button on room cards, dont need the feature atm. 
- Keep the easy flow to create an user. However we should expand the profile view a bit. Users must be able to fill out a profile with their interests, and a short desccription about them, their gender (optional) 
and a photo of them. This is important for the site since its all about human connection in the end. After users have created an account, thank them and send them an email to remind them of filling this.
Plan https://gemini.google.com/gem/c9297fa0daa6/438200f96cb01b5e
- Brug ansigt billede fremfor bolig billede i chat view. Hav default billede hvis intet billede
- login med google?
- Seo optimer alt
- Få AI til at dobbelttjek at alle frontend kald ryger til endpoints med /roomies prefix
- Reklame sektion i bunden ligesom TrustMRR
- Theres a bug when i click one of the elements in the dropdown in "<!-- Auth / Bruger Menu (Right aligned) -->" the buttons background color seems to turn blue and stay blue? Thats weird, no need for this at all. The buttons already animate a little when hovered/clicked and thats enough
- Cache endpointet "/rooms/all" i CF
- Vigtigt jeg får folk til at oprettet en profil med billede, både købere og sælgere, det er det menneskelige der skal drive siden rundt.
- "The existing housing_list anchor/pagination restoration still works."
Remove this, not needed in this project
- Generel oprydning i viewmanager? 
- Implementer også denne smarte router løsning i andelsboligbasen? og academy
- Få reklamer på roomies siden 
‘andelsbolig basen, den nemmeste vej til en andelsbolig’
- Freemium, se freemium_ideas.txt
- Slug på roomies fremfor bare ID. Det giver bedre SEO
- Skriv simpelt "vilkaar" view 
- Scrape værelser fra facebook til at starte med
- Under "Bliv en del af fælleskabet", CTA der opretter konto
- Alle billeder skal være webp
- Opret FB/Insta og link til dem i footer

# Giga smoketest

# Marketing strategy / GoLive
- Reklamer via good guy metoden på FB grupper via privat profil
Jeg har lavet det her til jer, det er 100% gratis og finansieret af mig til at starte med. Håber på at kunne indhente lidt fortjenste via målrettede
reklamer der reelt gavner målgruppen
- Efterfølgende opsæt evt FB scraber og så reklamer på reddit m.m.
