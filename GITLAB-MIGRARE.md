# Migrare dashboard pe GitLab (privat + Pages doar pentru tine)

Ghid pas cu pas — repo **privat**, site accesibil de pe telefon și PC după login GitLab (fără parolă separată pe site).

---

## 1. Cont GitLab

1. Deschide https://gitlab.com și creează cont (sau loghează-te).
2. Confirmă emailul dacă ți se cere.

---

## 2. Proiect privat nou

1. **New project** → **Create blank project**
2. Nume recomandat: `hercules-dashboard` (sau cum vrei tu)
3. **Visibility: Private**
4. Debifează „Initialize with README” (avem deja fișierele)
5. **Create project**

Notează URL-ul SSH sau HTTPS de pe pagina proiectului, de exemplu:

- HTTPS: `https://gitlab.com/TI_USERNAME/hercules-dashboard.git`
- SSH: `git@gitlab.com:TI_USERNAME/hercules-dashboard.git`

---

## 3. Trimite codul de pe PC (din folderul proiectului)

În terminal, în folderul unde ai `index.html`:

```bash
# Dacă nu ai git inițializat:
git init
git add index.html manifest.json sw.js .nojekyll .gitlab-ci.yml icons/ sounds/ *.mp3
git commit -m "Dashboard Hercules — migrare GitLab Pages"

# Leagă de GitLab (înlocuiește TI_USERNAME și numele proiectului):
git remote add gitlab https://gitlab.com/TI_USERNAME/hercules-dashboard.git
git branch -M main
git push -u gitlab main
```

Dacă ai deja remote GitHub și vrei să păstrezi ambele:

```bash
git remote add gitlab https://gitlab.com/TI_USERNAME/hercules-dashboard.git
git push -u gitlab main
```

---

## 4. Așteaptă primul deploy (GitLab CI)

1. În proiect: **Build** → **Pipelines**
2. Primul pipeline ar trebui să fie **verde** (job `pages`)
3. Apoi: **Deploy** → **Pages** — vezi URL-ul site-ului

Adresa va arăta cam așa:

`https://TI_USERNAME.gitlab.io/hercules-dashboard/`

---

## 5. Site doar pentru tine (fără public pe internet)

1. **Settings** → **General** → **Visibility, project features, permissions**
2. La **Pages**, apasă **Expand**
3. Activează **Pages access control** (dacă apare opțiunea)
4. Alege **Only project members** (doar membrii proiectului)

Astfel, vizitatorii trebuie să fie logați la GitLab și să fie membri ai proiectului (tu ești owner, deci merge pe toate dispozitivele unde te loghezi cu același cont).

> Dacă nu vezi „Pages access control”, pe GitLab.com site-ul Pages poate rămâne public la URL — tot e greu de ghicit, dar nu e la fel de strict ca „only members”. În acel caz poți folosi proiect privat + nu distribui linkul.

---

## 6. Cursor — lucrul cu proiectul

### Variantă A: clone proaspăt

```bash
git clone https://gitlab.com/TI_USERNAME/hercules-dashboard.git
cd hercules-dashboard
```

Deschide folderul în **Cursor**: File → Open Folder.

### Variantă B: proiectul actual + remote GitLab

Ai deja folderul — doar adaugi remote `gitlab` (pasul 3).

### Integrare Cursor ↔ GitLab (opțional)

1. https://cursor.com → **Dashboard** → **Integrations**
2. **Connect** lângă GitLab
3. Autorizează și **Sync Repos**

Funcții avansate (Cloud Agents) pe GitLab pot fi limitate față de GitHub; editarea codului merge normal.

---

## 7. Telefon / tabletă

1. Deschide în browser URL-ul din **Deploy → Pages**
2. La prima vizită: **Log in** cu contul GitLab (același ca pe PC)
3. Adaugă la **Ecran principal** / bookmark — la fel de rapid ca înainte

---

## 8. GitHub vechi (recomandat)

Ca să nu rămână site-ul public pe GitHub Pages:

- Fie lași repo GitHub **public** dar dezactivezi Pages: **Settings → Pages → Source: None**
- Fie pui repo GitHub **privat** (fără Pro, Pages nu mai merge oricum)

Codul poate rămâne pe GitHub ca backup sau doar pe GitLab — cum preferi.

---

## 9. Actualizări ulterioare

După ce modifici în Cursor:

```bash
git add -A
git commit -m "Descriere modificare"
git push gitlab main
```

Pipeline-ul republică site-ul în 1–2 minute.

---

## Probleme frecvente

| Problemă | Soluție |
|----------|---------|
| Pipeline roșu | **Build → Pipelines** → click job → citește logul |
| 404 pe Pages | Așteaptă 5–10 min după primul pipeline verde |
| Iconițe lipsă pe desktop | Deschide URL cu slash final: `.../hercules-dashboard/` |
| Mi se cere login mereu | Normal pe dispozitiv nou; bifează „remember” la GitLab |

---

## Fișiere importante în repo

| Fișier | Rol |
|--------|-----|
| `index.html` | Dashboard-ul |
| `.gitlab-ci.yml` | Publicare automată GitLab Pages |
| `icons/`, `sounds/`, `*.mp3` | Resurse site |

Dacă vrei ajutor la un pas concret (eroare pipeline, URL, Cursor), spune la ce pas ești.
