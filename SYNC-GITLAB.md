# Sincronizare GitHub → GitLab (Bollywood și toate update-urile)

Modificările sunt pe **GitHub**. Site-ul live e pe **GitLab Pages** — trebuie să legi cele două.

Alege **una** din metode:

---

## Metoda A — Mirror în GitLab (recomandat, o singură dată)

GitLab **trage** codul de pe GitHub automat (la fiecare câteva minute).

### Pe mobil / browser

1. Deschide **proiectul GitLab** (cel cu Pages).
2. **Settings** → **Repository** → derulează la **Mirroring repositories**.
3. **Expand** → **Add new** (sau **Update mirror**).
4. **Git repository URL:**
   ```
   https://github.com/metusalem969-ro/fhgvbsadujfhgweayiurfgewikugtreiwuqqtqwioarfgvweilugrtiweugbvesdiourtfgewhuiotgferiw.git
   ```
5. **Mirror direction:** **Pull** (din GitHub în GitLab).
6. **Authentication:** lasă gol dacă repo GitHub e **public**; dacă cere user/token, folosește un [GitHub token](https://github.com/settings/tokens) cu `repo` (sau doar public read).
7. **Save** → apasă **Update now** / **Sync now**.
8. Așteaptă 1–2 min → **Build** → **Pipelines** (verde).
9. Reîncarcă site-ul Pages.

După asta, orice update pe **GitHub** `main` ajunge singur pe GitLab (și Bollywood apare după sync).

---

## Metoda B — Import proiect nou din GitHub

Dacă mirror nu merge pe proiectul vechi:

1. **+** → **New project** → **Import project** → **GitHub**.
2. Alege repo-ul `fhgvbsadujfhgweayiurfgewikugtreiwuqqtqwioarfgvweilugrtiweugbvesdiourtfgewhuiotgferiw`.
3. **Private** → **Import** (un singur repo, nu „Import 17”).
4. Configurează **Pages** pe proiectul nou; actualizează bookmark-ul.

---

## Metoda C — GitHub Actions (automat la fiecare push)

În repo **GitHub**:

1. GitLab → **Preferences** → **Access tokens** → Create: `write_repository`, `api`.
2. Copiază tokenul.
3. GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New secret**:
   - `GITLAB_TOKEN` = tokenul GitLab
   - `GITLAB_PROJECT` = `Hercules-metusalem969/dashboard` (proiectul importat cu Pages)
4. La fiecare push pe `main`, workflow-ul `.github/workflows/sync-to-gitlab.yml` trimite codul la GitLab.

---

## Push direct de la agent (după token)

Dacă adaugi `GITLAB_TOKEN` în Cursor (vezi **GITLAB-PAS-CU-PAS.md**), agentul poate rula:

```bash
./scripts/push-to-gitlab.sh
```

— același rezultat ca push pe GitHub, fără edit manual în browser.

## De ce nu merge fără token

Cloud Agent are acces la **GitHub** (`origin`), nu la **GitLab** până nu există `GITLAB_TOKEN` sau mirror/Actions (metodele de mai sus).

---

## După sync

- Caută **Bollywood Filme** la categoria **Filme** sau în bara de filtru: `bollywood`.
- Dacă tot nu apare: șterge datele site-ului în browser (cache) sau deschide Pages în fereastră privată.
