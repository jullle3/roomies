# Verificeringsflow: AI Dokument Scan + Betaling

## 1. UX Strategien: Ærlighed som en Feature
For at undgå, at brugerne føler, de "køber" troværdighed, skal vi være 100% gennemsigtige omkring, *hvorfor* det koster 49 kr. Vi positionerer det som et **Sikkerheds- og administrationsgebyr**.

Dette gebyr tjener to formål:
1. Dækker den faktiske omkostning til det sikre AI-dokumentscan.
2. Fungerer som en finansiel barriere, der holder internationale svindlere og bots væk.

---

## 2. UI Copy (Modalen)
Når en bruger klikker på "Bliv verificeret", vises en clean, glassmorphism modal med følgende tekst:

**Overskrift:** Skil dig ud med et Verificeret-badge 🛡️

**Brødtekst:** Vis andre roomies, at du er en rigtig person. Verificerede profiler får op til 3x flere henvendelser.

**Checkliste:**
- **ID-Scan:** Vi bruger en sikker AI til at matche dit navn med et gyldigt ID (fx studiekort eller sundhedskort).
- **Sikkerhedsgebyr (49 kr.):** Gebyret dækker systemets omkostninger og fungerer som en effektiv blokering mod svindlere og bots.
- **100% Frivilligt:** Det er og vil altid være gratis at bruge platformens kernefunktioner.

---

## 3. Det Tekniske Flow (FastAPI + Stripe)

### Trin 1: Dokument Upload & AI Scan
* **Handling:** Brugeren uploader et billede af deres Sundhedskort eller Studiekort (med anvisning om at dække CPR-nummeret til, så kun navn og udsteder fremgår).
* **Teknologi:** Billedet sendes til FastAPI backend. Et letvægts OCR-bibliotek (f.eks. Tesseract) eller en AI vision-model udtrækker teksten og bekræfter, at navnet matcher brugerens profilnavn.

### Trin 2: Stripe Checkout
* **Handling:** Efter upload sendes brugeren til et Stripe payment intent for at betale de 49 kr.
* **Teknologi:** Stripe håndterer transaktionen og giver automatisk 3D Secure-tjekket (hvilket i Danmark ofte tvinger svindlere til at skulle verificere med MitID via deres bank for at godkende kortet).

### Trin 3: Match & Badge Tildeling
* **Handling:** Hvis Stripe-betalingen går igennem, og din backend har godkendt OCR-navnematchet, får profilen status som "Verificeret".
* **Teknologi:** Brugeren redirectes tilbage til sin profil, og dit premium gradient badge aktiveres permanent (eller årligt) på deres avatar.

---

## 4. CSS Implementering (Premium Badge)
Her er den foreslåede styling, der matcher dit premium accent flow:

```css
.verified-badge {
    background: linear-gradient(135deg, var(--color-premium-start), var(--color-premium-end));
    color: #fff;
    font-weight: 700;
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-soft);
    padding: 4px 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}