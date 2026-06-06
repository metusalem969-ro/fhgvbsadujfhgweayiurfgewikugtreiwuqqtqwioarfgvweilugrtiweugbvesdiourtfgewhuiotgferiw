# AGENTS.md

## Cursor Cloud specific instructions

### Product

**Hercules Command Center** is a static, client-only PWA (single `index.html` + `manifest.json` + `sw.js`). There is no backend, `package.json`, build step, or in-repo test/lint tooling.

### Running locally

Serve the repo root over HTTP (required for service worker and normal PWA behavior; avoid `file://`):

```bash
python3 -m http.server 8000 --directory /workspace
```

Open `http://localhost:8000/index.html`.

Alternative: `npx --yes serve /workspace -p 3000`

### Services

| Service | Required? | Notes |
|--------|-----------|--------|
| Static HTTP server on port 8000 (or similar) | Yes | No install step; use Python or `npx serve` |
| Outbound HTTPS | For full features | Weather (`ipapi.co`, `wttr.in`, etc.), Font Awesome CDN, external links |
| `http://localhost:8899` | No | Only for the built-in “Control PC Desktop” shortcut |

### Lint / test / build

Not defined in this repository. Smoke checks: HTTP 200 for `index.html`, `manifest.json`, `sw.js`; manual browser E2E (add bookmark, search bar, import/export).

### Gotchas

- **No dependency install** on VM startup; the update script is a no-op (`true`).
- **Service worker cache version** in `sw.js` should stay in sync with comments in `index.html` when changing cache behavior.
- **README.md** is placeholder text, not setup documentation.
- Reinstalling dependencies does not apply (there are none); if you change static assets, hard-refresh or bump SW cache version to avoid stale shell.
