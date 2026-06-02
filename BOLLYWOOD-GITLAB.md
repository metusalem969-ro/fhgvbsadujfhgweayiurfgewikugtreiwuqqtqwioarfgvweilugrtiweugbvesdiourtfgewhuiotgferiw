# Bollywood pe GitLab — pași rapizi (mobil)

Repo GitLab: `Hercules-metusalem` / proiectul cu numele lung (sau `hercules-dashboard`).

---

## Pas 1 — Iconița (1 minut)

1. **Code** → folder **icons** → **+** → **New file**
2. Nume fișier: `bollywood.svg`
3. Lipește conținutul:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="Bollywood">
  <rect width="24" height="24" rx="4" fill="#e65100"/>
  <polygon points="8,7 8,17 16,12" fill="#fff"/>
  <text x="12" y="22" text-anchor="middle" fill="#fff3e0" font-family="Arial,Helvetica,sans-serif" font-size="4.5" font-weight="800">BOLLY</text>
</svg>
```

4. **Commit**

---

## Pas 2 — Card în index.html (2 minut)

1. **Code** → **index.html** → **Edit**
2. Caută: `OneMagia`
3. După linia cu OneMagia, adaugă:

```javascript
            { name: "Bollywood Filme", url: "https://www.justwatch.com/ro/filme?production_countries=IN", category: "filme", iconUrl: "icons/bollywood.svg" },
```

4. Caută: `const INLINE_ICON_DATA`
5. Înainte de `};` care închide obiectul, adaugă (dacă lipsește):

```javascript
            'icons/bollywood.svg': 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#e65100"/><polygon points="8,7 8,17 16,12" fill="#fff"/><text x="12" y="22" text-anchor="middle" fill="#fff3e0" font-family="Arial,sans-serif" font-size="4.5" font-weight="800">BOLLY</text></svg>'),
```

6. **Commit**

---

## Pas 3 — Publică site-ul

1. **Build** → **Pipelines** → aștepți **verde**
2. Reîncarcă linkul **Pages** (închide tab, deschide din nou)
3. La **Filme** sau caută **bollywood**

---

## Varianta automată (PC) — tot codul de pe GitHub

```bash
git clone https://github.com/metusalem969-ro/fhgvbsadujfhgweayiurfgewikugtreiwuqqtqwioarfgvweilugrtiweugbvesdiourtfgewhuiotgferiw.git dashboard
cd dashboard
git remote add gitlab https://gitlab.com/Hercules-metusalem/NUME-PROIECT-TAU.git
git push gitlab main
```

Înlocuiește `NUME-PROIECT-TAU` cu numele exact din URL-ul GitLab.

---

## Mirror GitHub → GitLab (opțional, viitor)

**Settings** → **Repository** → **Mirroring** → Pull from:
`https://github.com/metusalem969-ro/fhgvbsadujfhgweayiurfgewikugtreiwuqqtqwioarfgvweilugrtiweugbvesdiourtfgewhuiotgferiw.git`

Apoi la fiecare update pe GitHub, GitLab se actualizează singur.
