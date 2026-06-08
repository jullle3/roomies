- Create a new PATCH endpoint which can be used to update if a listing is available. It should update the field "available" of the specified rooms. The user must only update one room per request

- .I recommend placing the controls only on the Detail View (#room_detail), but using a clever trick: The "Owner's View."Here is exactly how that flow works:1. The Profile is just a Router. In your #profile view, you already have a button built for this: <div id="btn-my-listing">.
  When the user clicks this button, it does not open a special editing dashboard. It simply redirects them to the standard #room_detail page for their room.  2. The Detail View (Owner vs. Seeker)When the #room_detail view loads, your JavaScript checks one simple thing: Is the logged-in user the person who created this room? (currentUser.id === room.created_by).  If it is a normal room-seeker: They just see the pictures, the rent, and the "Kontakt udlejer" button.If it is the owner: You use JavaScript to inject that "Admin Dashboard" HTML block at the very top of the page. You also change the "Kontakt udlejer" button to "Rediger opslag" which redirects them to the udlej-vaerelse view .Why this is the best UX By putting the visibility controls on the actual detail page, the landlord sees exactly what the rest of the world sees right before they pause or delete it. It gives them total context. It also keeps your #profile view clean and strictly focused on account settings, rather than turning it into a complex content management system.
In addition to the above brainstorm with gemini, the profile should list all rooms that the user has available for rent

I also want a similar (or perhaps the same, up to you) admin panel in the udlej-vaerelse view before "Opret dit værelse", it should be simple and easy to use for the user.

- Delete endpoint in backend which doesnt actually delete, but prefixes created_by with "deleted" use this as inspiration
  @router.delete("/advertisement/{_id}")
  def delete_advertisement(_id, jwt=Depends(is_authenticated)):
  db.read_and_update(
  {"_id": _id, "created_by": jwt.sub},
  {
  "$set": {
  "deleted": True,
  "deleted_at": int(time.time()),
  "visible": False,
  "created_by": f"deleted_{jwt.sub}",
  }
  },
  )


- Popup prompting their user if theyre sure they want to delete the room. Use the "genericConfirmationModal" HTML and draw inspiration from this implementation
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
