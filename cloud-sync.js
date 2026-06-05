/**
 * Sincronizare criptată între dispozitive (favorite, parole, note, setări).
 * Backend: GitHub Gist sau GitLab Snippet (token stocat local în browser).
 */
(function (global) {
    'use strict';

    const SYNC_VERSION = 4;
    const SYNC_PROVIDER_KEY = 'herculesSyncProvider_v1';
    const SYNC_TOKEN_KEY = 'herculesSyncToken_v1';
    const SYNC_REMOTE_ID_KEY = 'herculesSyncRemoteId_v1';
    const SYNC_PIN_HASH_KEY = 'herculesSyncPinHash_v1';
    const SYNC_ENABLED_KEY = 'herculesSyncEnabled_v1';
    const SYNC_LAST_PULL_KEY = 'herculesSyncLastPull_v1';
    const SYNC_SESSION_PIN_KEY = 'herculesSyncSessionPin_v1';
    const SYNC_FILE_NAME = 'hercules-sync.enc.json';
    const PASSWORD_HISTORY_MAX = 30;

    let syncPinCache = null;
    let pushTimer = null;
    let pullInFlight = false;
    let pushInFlight = false;

    function bytesToB64(bytes) {
        let s = '';
        const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
        return btoa(s);
    }

    function b64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    async function sha256Hex(text) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function deriveAesKey(pin, saltBytes) {
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(pin),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: saltBytes, iterations: 120000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptJson(pin, obj) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveAesKey(pin, salt);
        const plain = new TextEncoder().encode(JSON.stringify(obj));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
        return {
            v: 1,
            salt: bytesToB64(salt),
            iv: bytesToB64(iv),
            data: bytesToB64(cipher)
        };
    }

    async function decryptJson(pin, envelope) {
        if (!envelope || !envelope.salt || !envelope.iv || !envelope.data) {
            throw new Error('Format criptat invalid');
        }
        const salt = b64ToBytes(envelope.salt);
        const iv = b64ToBytes(envelope.iv);
        const cipher = b64ToBytes(envelope.data);
        const key = await deriveAesKey(pin, salt);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
        return JSON.parse(new TextDecoder().decode(plain));
    }

    function isSyncConfigured() {
        return (
            localStorage.getItem(SYNC_ENABLED_KEY) === 'true' &&
            !!localStorage.getItem(SYNC_REMOTE_ID_KEY) &&
            !!localStorage.getItem(SYNC_TOKEN_KEY) &&
            !!localStorage.getItem(SYNC_PIN_HASH_KEY)
        );
    }

    function getSyncProvider() {
        return localStorage.getItem(SYNC_PROVIDER_KEY) || 'github';
    }

    function sanitizeSyncToken(raw) {
        if (raw == null) return '';
        return String(raw)
            .replace(/^\uFEFF/, '')
            .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
            .replace(/\s+/g, '')
            .replace(/[^\x21-\x7E]/g, '');
    }

    function assertAsciiHeaderValue(value, label) {
        if (!value) return '';
        for (let i = 0; i < value.length; i++) {
            if (value.charCodeAt(i) > 255) {
                throw new Error(
                    label + ' conține caractere invalide (spațiu invizibil la copy-paste). ' +
                    'Șterge câmpul, copiază din nou tokenul (ghp_… sau glpat-…) și lipește.'
                );
            }
        }
        return value;
    }

    function getSyncToken() {
        const raw = localStorage.getItem(SYNC_TOKEN_KEY) || '';
        const clean = sanitizeSyncToken(raw);
        if (clean && clean !== raw) {
            localStorage.setItem(SYNC_TOKEN_KEY, clean);
        }
        return clean;
    }

    function getRemoteId() {
        return localStorage.getItem(SYNC_REMOTE_ID_KEY) || '';
    }

    function collectPayload() {
        const deps = global.HerculesSyncDeps;
        if (!deps) return null;
        return {
            version: SYNC_VERSION,
            updatedAt: Date.now(),
            favorites: deps.getFavorites ? deps.getFavorites() : [],
            searchHistory: deps.getSearchHistory ? deps.getSearchHistory() : [],
            passwordHistory: deps.getPasswordHistory ? deps.getPasswordHistory() : [],
            notes: deps.getNotes ? deps.getNotes() : [],
            links: deps.getLinks ? deps.getLinks() : [],
            customOrder: deps.getCustomOrder ? deps.getCustomOrder() : [],
            visitStats: deps.getVisitStats ? deps.getVisitStats() : {},
            lastClickedUrl: deps.getLastClickedUrl ? deps.getLastClickedUrl() : null,
            theme: deps.getTheme ? deps.getTheme() : null,
            soundEnabled: deps.getSoundEnabled ? deps.getSoundEnabled() : null,
            zoomLevel: deps.getZoomLevel ? deps.getZoomLevel() : null
        };
    }

    function mergePasswordHistory(local, remote) {
        const map = new Map();
        [...(local || []), ...(remote || [])].forEach((item) => {
            if (!item || !item.password) return;
            const key = item.password + '|' + (item.timestamp || 0);
            const prev = map.get(key);
            if (!prev || (item.timestamp || 0) > (prev.timestamp || 0)) map.set(key, item);
        });
        return Array.from(map.values())
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, PASSWORD_HISTORY_MAX);
    }

    function mergeFavorites(local, remote) {
        const set = new Set([...(local || []), ...(remote || [])]);
        return [...set];
    }

    function visitStatsToByDevice(stats) {
        if (!stats) return {};
        if (stats.byDevice && typeof stats.byDevice === 'object') {
            return { ...stats.byDevice };
        }
        if (stats.count) {
            return { _legacy: stats.count };
        }
        return {};
    }

    function sumByDevice(byDevice) {
        return Object.values(byDevice).reduce((sum, n) => sum + (Number(n) || 0), 0);
    }

    function computeVisitTotal(byDevice) {
        const vals = Object.values(byDevice)
            .map((n) => Number(n) || 0)
            .filter((n) => n > 0);
        if (vals.length === 0) return 0;
        if (vals.length === 1) return vals[0];
        const max = Math.max(...vals);
        const sum = vals.reduce((a, b) => a + b, 0);
        if (vals.every((v) => v === max)) return max;
        return sum;
    }

    function mergeByDeviceMaps(localMap, remoteMap) {
        const merged = { ...remoteMap };
        Object.entries(localMap).forEach(([devId, count]) => {
            merged[devId] = Math.max(Number(merged[devId]) || 0, Number(count) || 0);
        });
        return merged;
    }

    function buildVisitStatEntry(byDevice, lastVisit) {
        return {
            count: computeVisitTotal(byDevice),
            lastVisit: lastVisit || null,
            byDevice
        };
    }

    function mergeVisitStatEntries(a, b) {
        return buildVisitStatEntry(
            mergeByDeviceMaps(visitStatsToByDevice(a), visitStatsToByDevice(b)),
            Math.max(a?.lastVisit || 0, b?.lastVisit || 0) || null
        );
    }

    function mergeVisitStats(local, remote) {
        const allUrls = new Set([
            ...Object.keys(local || {}),
            ...Object.keys(remote || {})
        ]);
        const merged = {};
        allUrls.forEach((url) => {
            merged[url] = mergeVisitStatEntries((local && local[url]) || {}, (remote && remote[url]) || {});
        });
        return merged;
    }

    function pickLastClickedUrl(localUrl, remoteUrl, stats) {
        if (!localUrl) return remoteUrl || null;
        if (!remoteUrl) return localUrl;
        const localT = (stats[localUrl] && stats[localUrl].lastVisit) || 0;
        const remoteT = (stats[remoteUrl] && stats[remoteUrl].lastVisit) || 0;
        return remoteT > localT ? remoteUrl : localUrl;
    }

    async function applyRemotePayload(remote, options) {
        const opts = options || {};
        const deps = global.HerculesSyncDeps;
        if (!deps || !remote) return { applied: false, reason: 'empty' };
        const localTs = parseInt(localStorage.getItem(SYNC_LAST_PULL_KEY) || '0', 10);
        const remoteTs = remote.updatedAt || 0;
        if (!opts.force && remoteTs <= localTs) return { applied: false, reason: 'stale' };

        const useRemoteFavorites = opts.force || opts.preferRemote;
        let mergedFavorites;
        if (Array.isArray(remote.favorites) && remote.favorites.length > 0) {
            mergedFavorites = useRemoteFavorites
                ? remote.favorites
                : mergeFavorites(deps.getFavorites(), remote.favorites);
        } else if (Array.isArray(remote.favorites) && remote.favorites.length === 0 && useRemoteFavorites) {
            mergedFavorites = deps.getFavorites();
        } else if (Array.isArray(remote.favorites)) {
            mergedFavorites = mergeFavorites(deps.getFavorites(), remote.favorites);
        } else {
            mergedFavorites = deps.getFavorites();
        }

        const mergedVisitStats = mergeVisitStats(
            deps.getVisitStats ? deps.getVisitStats() : {},
            remote.visitStats
        );

        const mergedPayload = {
            favorites: mergedFavorites,
            passwordHistory: mergePasswordHistory(deps.getPasswordHistory(), remote.passwordHistory),
            notes: remote.notes,
            links: remote.links,
            customOrder: remote.customOrder,
            visitStats: mergedVisitStats,
            lastClickedUrl: pickLastClickedUrl(
                deps.getLastClickedUrl ? deps.getLastClickedUrl() : null,
                remote.lastClickedUrl || null,
                mergedVisitStats
            ),
            theme: remote.theme,
            soundEnabled: remote.soundEnabled,
            zoomLevel: remote.zoomLevel,
            fromCloud: true
        };
        if (Array.isArray(remote.searchHistory)) {
            mergedPayload.searchHistory = remote.searchHistory;
        }

        let summary = { favorites: 0, searches: 0, passwords: 0, notes: 0, links: 0 };
        if (deps.applyMerged) {
            summary = deps.applyMerged(mergedPayload) || summary;
        }
        localStorage.setItem(SYNC_LAST_PULL_KEY, String(remoteTs || Date.now()));
        return { applied: true, summary, remoteTs };
    }

    function formatGitHubError(status, errText) {
        const lower = (errText || '').toLowerCase();
        if (status === 403 && (lower.includes('not accessible by personal access token') || lower.includes('resource not accessible'))) {
            return (
                'Token GitHub fără acces la Gist (403). Creează un token CLASIC (nu „fine-grained”): ' +
                'GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic) → ' +
                'bifează DOAR «gist» → Generate. Tokenul începe cu ghp_ (nu github_pat_). ' +
                'Sau folosește GitLab Snippet în dropdown.'
            );
        }
        if (status === 401) {
            return 'Token GitHub respins (401). Token expirat sau greșit — generează unul nou (classic, scope gist).';
        }
        if (status === 404) {
            return 'Gist negăsit (404). Verifică ID profil sau reactivează pe primul dispozitiv.';
        }
        return 'GitHub ' + status + ': ' + (errText.slice(0, 100) || 'eroare API');
    }

    async function githubFetch(path, options) {
        const token = assertAsciiHeaderValue(getSyncToken(), 'Token API');
        const headers = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(options && options.headers ? options.headers : {})
        };
        if (token) headers.Authorization = 'Bearer ' + token;
        let res;
        try {
            res = await fetch('https://api.github.com' + path, { ...options, headers });
        } catch (fetchErr) {
            const msg = fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr);
            if (/ISO-8859-1|non.*code point/i.test(msg)) {
                throw new Error(
                    'Token API invalid (caractere invizibile). Șterge tokenul, copiază din nou din GitHub (ghp_…) și lipește.'
                );
            }
            throw fetchErr;
        }
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(formatGitHubError(res.status, errText));
        }
        return res.json();
    }

    async function gitlabFetch(path, options) {
        const token = assertAsciiHeaderValue(getSyncToken(), 'Token API');
        const headers = {
            ...(options && options.headers ? options.headers : {})
        };
        if (token) headers['PRIVATE-TOKEN'] = token;
        let res;
        try {
            res = await fetch('https://gitlab.com/api/v4' + path, { ...options, headers });
        } catch (fetchErr) {
            const msg = fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr);
            if (/ISO-8859-1|non.*code point/i.test(msg)) {
                throw new Error(
                    'Token API invalid (caractere invizibile). Șterge tokenul, copiază din nou din GitLab (glpat-…) și lipește.'
                );
            }
            throw fetchErr;
        }
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error('GitLab: ' + res.status + ' ' + (errText.slice(0, 120) || res.statusText));
        }
        return res.json();
    }

    function missingRemoteIdError() {
        return new Error(
            'Lipsește ID profil (Gist/Snippet). Pe primul dispozitiv: apasă doar «Activează» (fără ID). ' +
            'Pe al doilea: lipește ID-ul copiat de pe primul dispozitiv, apoi «Activează».'
        );
    }

    async function remoteReadEnvelope() {
        const provider = getSyncProvider();
        const id = getRemoteId();
        if (!id) throw missingRemoteIdError();

        if (provider === 'gitlab') {
            const snippet = await gitlabFetch('/snippets/' + encodeURIComponent(id));
            const content = snippet.content || (snippet.files && snippet.files[0] && snippet.files[0].content) || '';
            if (!content) return null;
            return JSON.parse(content);
        }

        const gist = await githubFetch('/gists/' + encodeURIComponent(id));
        const file = gist.files && gist.files[SYNC_FILE_NAME];
        if (!file || !file.content) return null;
        return JSON.parse(file.content);
    }

    async function remoteWriteEnvelope(envelope) {
        const provider = getSyncProvider();
        const id = getRemoteId();
        const content = JSON.stringify(envelope);

        if (provider === 'gitlab') {
            if (!id) {
                const created = await gitlabFetch('/snippets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: 'Hercules Dashboard Sync',
                        description: 'hercules-dashboard-sync',
                        visibility: 'private',
                        file_name: SYNC_FILE_NAME,
                        content
                    })
                });
                localStorage.setItem(SYNC_REMOTE_ID_KEY, String(created.id));
                return created.id;
            }
            await gitlabFetch('/snippets/' + encodeURIComponent(id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Hercules Dashboard Sync',
                    file_name: SYNC_FILE_NAME,
                    content
                })
            });
            return id;
        }

        if (!id) {
            const created = await githubFetch('/gists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: 'hercules-dashboard-sync',
                    public: false,
                    files: {
                        [SYNC_FILE_NAME]: { content }
                    }
                })
            });
            localStorage.setItem(SYNC_REMOTE_ID_KEY, created.id);
            return created.id;
        }

        await githubFetch('/gists/' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: {
                    [SYNC_FILE_NAME]: { content }
                }
            })
        });
        return id;
    }

    async function pullFromCloud(pin, force) {
        if (!navigator.onLine || pullInFlight) return { ok: false, reason: 'offline' };
        if (!getRemoteId()) return { ok: false, error: missingRemoteIdError().message };
        pullInFlight = true;
        try {
            const usePin = pin || syncPinCache;
            if (!usePin) return { ok: false, reason: 'no-pin' };
            const envelope = await remoteReadEnvelope();
            if (!envelope) {
                return {
                    ok: true,
                    applied: false,
                    updated: false,
                    error: 'Cloud gol. Pe dispozitivul 1: ☁️ → Încarcă acum, apoi încearcă din nou Descarcă.'
                };
            }
            const payload = await decryptJson(usePin, envelope);
            const result = await applyRemotePayload(payload, { force: !!force, preferRemote: !!force });
            const applied = !!(result && result.applied);
            return {
                ok: true,
                applied,
                updated: applied,
                summary: result && result.summary ? result.summary : null,
                fromCloud: true
            };
        } catch (e) {
            console.warn('Cloud pull:', e);
            return { ok: false, error: e.message };
        } finally {
            pullInFlight = false;
        }
    }

    async function pushToCloud(pin, force) {
        if (!navigator.onLine || pushInFlight) return { ok: false, reason: 'offline' };
        if (!isSyncConfigured() && !force) return { ok: false, reason: 'not-configured' };
        pushInFlight = true;
        try {
            const usePin = pin || syncPinCache;
            if (!usePin) return { ok: false, reason: 'no-pin' };
            const payload = collectPayload();
            if (!payload) return { ok: false, reason: 'no-deps' };
            const envelope = await encryptJson(usePin, payload);
            const remoteId = await remoteWriteEnvelope(envelope);
            return { ok: true, remoteId: remoteId || getRemoteId() };
        } catch (e) {
            console.warn('Cloud push:', e);
            return { ok: false, error: e.message };
        } finally {
            pushInFlight = false;
        }
    }

    function scheduleCloudSyncPush() {
        if (!isSyncConfigured()) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            pushToCloud().then((r) => {
                if (r.ok && global.HerculesSyncDeps && global.HerculesSyncDeps.onSyncStatus) {
                    global.HerculesSyncDeps.onSyncStatus('pushed');
                }
            });
        }, 2500);
    }

    function warnIfGitHubTokenUnsuitable(token, provider) {
        if (provider !== 'gitlab' && token.startsWith('github_pat_')) {
            throw new Error(
                'Token „fine-grained” (github_pat_…) nu funcționează cu Gist. Folosește token CLASIC (ghp_…) cu scope «gist», ' +
                'sau alege «GitLab Snippet» în Platformă.'
            );
        }
    }

    async function setupCloudSync({ provider, token, pin, remoteId }) {
        if (!pin || pin.length < 8) throw new Error('PIN-ul trebuie să aibă minim 8 caractere');
        const cleanToken = sanitizeSyncToken(token);
        if (!cleanToken || cleanToken.length < 10) {
            throw new Error('Token invalid — lipește token GitHub (ghp_…) sau GitLab (glpat-…), fără spații');
        }
        const prov = provider === 'gitlab' ? 'gitlab' : 'github';
        warnIfGitHubTokenUnsuitable(cleanToken, prov);
        const pinHash = await sha256Hex(pin);
        syncPinCache = pin;
        saveSessionPin(pin);
        localStorage.setItem(SYNC_PROVIDER_KEY, provider === 'gitlab' ? 'gitlab' : 'github');
        localStorage.setItem(SYNC_TOKEN_KEY, cleanToken);
        localStorage.setItem(SYNC_PIN_HASH_KEY, pinHash);
        localStorage.setItem(SYNC_ENABLED_KEY, 'true');

        const trimmedRemote = remoteId ? String(remoteId).trim() : '';
        const hadExistingRemote = !!(trimmedRemote || getRemoteId());
        if (trimmedRemote) {
            localStorage.setItem(SYNC_REMOTE_ID_KEY, trimmedRemote);
        }

        // Al 2-lea dispozitiv / pagina GitLab: MAI ÎNTÂI descarcă din cloud, apoi încarcă
        // (altfel push-ul cu favoritele implicite locale șterge stelele de pe PC)
        if (hadExistingRemote) {
            const pullFirst = await pullFromCloud(pin, true);
            if (!pullFirst.ok && pullFirst.error) {
                console.warn('Pull înainte de activare:', pullFirst.error);
            }
        }

        const pushResult = await pushToCloud(pin, true);
        if (!pushResult.ok) {
            throw new Error(pushResult.error || 'Nu s-a putut încărca în cloud. Verifică token-ul (GitHub: scope «gist»).');
        }

        const finalId = getRemoteId();
        if (!finalId) {
            throw new Error(
                'Cloud-ul nu a returnat ID profil. Verifică token-ul și încearcă din nou «Activează» (fără ID profil pe primul dispozitiv).'
            );
        }

        if (!hadExistingRemote) {
            const pullResult = await pullFromCloud(pin, true);
            if (!pullResult.ok && pullResult.error && !pullResult.error.includes('Lipsește')) {
                console.warn('Pull după activare:', pullResult.error);
            }
        }

        return { remoteId: finalId };
    }

    function disableCloudSync() {
        localStorage.removeItem(SYNC_ENABLED_KEY);
        localStorage.removeItem(SYNC_TOKEN_KEY);
        localStorage.removeItem(SYNC_REMOTE_ID_KEY);
        localStorage.removeItem(SYNC_PIN_HASH_KEY);
        localStorage.removeItem(SYNC_LAST_PULL_KEY);
        clearSessionPin();
        syncPinCache = null;
    }

    function saveSessionPin(pin) {
        try {
            if (pin) sessionStorage.setItem(SYNC_SESSION_PIN_KEY, pin);
        } catch (e) {
            /* sessionStorage indisponibil */
        }
    }

    function clearSessionPin() {
        try {
            sessionStorage.removeItem(SYNC_SESSION_PIN_KEY);
        } catch (e) {
            /* ignore */
        }
    }

    function getSessionPin() {
        try {
            return sessionStorage.getItem(SYNC_SESSION_PIN_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    async function tryRestoreSessionPin() {
        const pin = getSessionPin();
        if (!pin) return false;
        if (!(await verifyPin(pin))) {
            clearSessionPin();
            return false;
        }
        syncPinCache = pin;
        return true;
    }

    async function verifyPin(pin) {
        const hash = await sha256Hex(pin);
        return hash === localStorage.getItem(SYNC_PIN_HASH_KEY);
    }

    async function unlockSyncPin(pin) {
        if (!(await verifyPin(pin))) return false;
        syncPinCache = pin;
        saveSessionPin(pin);
        return true;
    }

    function initCloudSync() {
        if (!isSyncConfigured()) return;
        // Fără prompt la refresh: PIN memorat doar în sesiunea tab-ului (până închizi browserul)
        tryRestoreSessionPin().then((ok) => {
            if (!ok) return;
            pullFromCloud(null, false).then((r) => {
                if (r.applied && r.summary && global.HerculesSyncDeps && global.HerculesSyncDeps.notify) {
                    const s = r.summary;
                    global.HerculesSyncDeps.notify(
                        '☁️ Din cloud: ' + s.favorites + ' favorite, ' + (s.visits || 0) + ' carduri cu vizite, ' + s.searches + ' căutări',
                        'success'
                    );
                }
            });
        });
        setInterval(() => {
            if (syncPinCache) pullFromCloud();
        }, 90000);
        setInterval(() => {
            if (syncPinCache) pushToCloud();
        }, 120000);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && syncPinCache && isSyncConfigured()) {
                pushToCloud();
            }
        });
    }

    global.HerculesCloudSync = {
        isSyncConfigured,
        setupCloudSync,
        disableCloudSync,
        pullFromCloud,
        pushToCloud,
        scheduleCloudSyncPush,
        initCloudSync,
        unlockSyncPin,
        getRemoteId,
        getSyncProvider,
        sanitizeSyncToken,
        PASSWORD_HISTORY_MAX
    };
})(typeof window !== 'undefined' ? window : globalThis);
