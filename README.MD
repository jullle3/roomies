- Der er noget broken når jeg trykker Gem roomie profil, i hvert fald bug med vibe tags, den sender de samme flere gange..
example response {
  "detail": [
  {
  "type": "too_long",
  "loc": [
  "body",
  "roomie_profile",
  "interests"
  ],
  "msg": "List should have at most 5 items after validation, not 8",
  "input": [
  "🍻 Socialt anlagt",
  "🎧 Privatliv",
  "☕ Fællesspisning",
  "🧹 Rengøringsplan",
  "🍻 Socialt anlagt",
  "🎧 Privatliv",
  "☕ Fællesspisning",
  "🧹 Rengøringsplan"
  ],
  "ctx": {
  "field_type": "List",
  "max_length": 5,
  "actual_length": 8
  }
  }
  ]
  }

- Remove the "Kan flytte ind fra" field, no need on roomie profile
- Simplify the card shown on "Find Roomie"

- Jeg skal have CTA'er til at oprette søgeagent hvis brugeren ikke allerede har en
- Du kunne også som yderligere ting gøre sådan, at brugere kan oprette sig som "søger værelse" - så kan alle dem der har et værelse selv scanne markedet og se hvem de gider mødes med uden at lave et opslag. Det er dog mere en beslutning, om man er interesseret i dét, kan nok få en del creeps til at skrive til unge piger xD
- Haha, at skrive det gav mig lige en ny ide - du kan også lave sådan et "matching system", med nogle helt basic spørgsmål ala kandidattest, bare for lejligheder. Sådan noget med renlighed, hobbyer og hvad ved jeg. Kunne da være sådan en sjov ting der adskilte dig fra alle andre
- MitID verificering af brugere?


Grupper at skrive i
https://www.facebook.com/groups/LejeboligerAarhus/
https://www.facebook.com/groups/roomieskobenhavn/
https://www.facebook.com/groups/375201816994364/
https://www.facebook.com/groups/minlejeboligaarhus/
https://www.facebook.com/groups/320108652008/
https://www.facebook.com/groups/LedigeLejlighederKBH
https://www.facebook.com/groups/boliger.koebenhavn

grupper DONE
https://www.facebook.com/groups/roomieskobenhavn/ - done https://www.facebook.com/groups/320108652008/permalink/10165404711827009/
https://www.facebook.com/groups/320108652008/ - done https://www.facebook.com/groups/roomieskobenhavn/permalink/1519984182837556/


- Roomies, skriv til aviser og nyheds medier https://g.co/gemini/share/a1ffaa90fc9e
- Roomie Reddit og FB Opslag - https://gemini.google.com/gem/c9297fa0daa6/f6fccd4db7de4739?hl=da
- Verificer google oauth, afventer https://console.cloud.google.com/auth/verification?project=roomiedanmark


# Marketing strategy / GoLivet
- Efterfølgende opsæt evt FB scraber og så reklamer på reddit m.m.

# Future
- Reklamer? Se ad-placement-ideas.md
- Freemium, se freemium_ideas.txt
- Scrape værelser fra facebook til at starte med
- Få reklamer på roomies siden
‘andelsbolig basen, den nemmeste vej til en andelsbolig’
- Implementer også denne smarte router løsning i andelsboligbasen? og academy
- Mit id verificering af brugere på roomiedanmark, 49kr per. One time payment
- Lav Facebook gruppe til roomies for de forskellige byer? måske, bare det ikke kræver meget arbejde og slet ingen drift
- PSEO
Roomie PSEO tier
Udlej værelse [by]

