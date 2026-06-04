# Creează repo GitHub `bec-lampa` (2 minute)

Pagina **Lampa Bec** e deja pe GitLab. Pentru același link scurt pe GitHub:

## Pas 1 — Import din GitLab (cel mai simplu)

1. Deschide: https://github.com/new/import
2. **Clone URL:** `https://gitlab.com/Hercules-metusalem969/bec-lampa.git`
3. **Owner:** `metusalem969-ro`
4. **Repository name:** `bec-lampa`
5. **Public** → **Begin import**
6. După import: **Settings** → **Pages** → **Deploy from branch** → `main` → folder `/ (root)` → **Save**

## Pas 2 — Link final

https://metusalem969-ro.github.io/bec-lampa/

---

## Alternativ: repo gol + push

1. https://github.com/new?name=bec-lampa (fără README)
2. Token GitHub cu `repo` → `export GITHUB_TOKEN=...`
3. `./scripts/push-bec-lampa-github.sh`
