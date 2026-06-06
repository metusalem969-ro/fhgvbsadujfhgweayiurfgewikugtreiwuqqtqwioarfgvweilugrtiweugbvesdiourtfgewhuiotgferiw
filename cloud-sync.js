/**
 * Sincronizare criptată între dispozitive (favorite, parole, note, setări).
 * Backend: GitHub Gist sau GitLab Snippet (token stocat local în browser).
 */
(function (global) {
    'use strict';

    const SYNC_VERSION = 5;
    const SYNC_PROVIDER_KEY = 'herculesSyncProvider_v1';
    const SYNC_MODE_KEY = 'herculesSyncMode_v1';
    const SYNC_TOKEN_KEY = 'herculesSyncToken_v1';
    const SYNC_REMOTE_ID_KEY = 'herculesSyncRemoteId_v1';
    const SYNC_GITHUB_TOKEN_KEY = 'herculesSyncGithubToken_v1';
    const SYNC_GITHUB_REMOTE_ID_KEY = 'herculesSyncGithubRemoteId_v1';
    const SYNC_GITLAB_TOKEN_KEY = 'herculesSyncGitlabToken_v1';
    const SYNC_GITLAB_REMOTE_ID_KEY = 'herculesSyncGitlabRemoteId_v1';
    const SYNC_MIGRATED_V2_KEY = 'herculesSyncMigrated_v2';
    const SYNC_PIN_HASH_KEY = 'herculesSyncPinHash_v1';
    const SYNC_ENABLED_KEY = 'herculesSyncEnabled_v1';
    const SYNC_LAST_PULL_KEY = 'herculesSyncLastPull_v1';
    const SYNC_LAST_PUSH_KEY = 'herculesSyncLastPush_v1';
    const SYNC_SESSION_PIN_KEY = 'herculesSyncSessionPin_v1';
    const SYNC_FILE_NAME = 'hercules-sync.enc.json';
    const PASSWORD_HISTORY_MAX = 30;
    /** Auto-sync mai rar — evită GitHub 403 rate limit */
    const AUTO_PULL_MS = 5 * 60 * 1000;
    const AUTO_PUSH_MS = 5 * 60 * 1000;
    const PUSH_DEBOUNCE_MS = 15000;
    const MIN_API_GAP_MS = 8000;

    let syncPinCache = null;
    let pushTimer = null;
    let pullInFlight = false;
    let pushInFlight = false;
    let rateLimitUntil = 0;
    let lastApiCallAt = 0;
    let rateLimitNotified = false;

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

    function providerTokenKey(provider) {
        return provider === 'gitlab' ? SYNC_GITLAB_TOKEN_KEY : SYNC_GITHUB_TOKEN_KEY;
    }

    function providerRemoteIdKey(provider) {
        return provider === 'gitlab' ? SYNC_GITLAB_REMOTE_ID_KEY : SYNC_GITHUB_REMOTE_ID_KEY;
    }

    function migrateLegacySyncStorage() {
        if (localStorage.getItem(SYNC_MIGRATED_V2_KEY) === 'done') return;
        const token = localStorage.getItem(SYNC_TOKEN_KEY);
        const remoteId = localStorage.getItem(SYNC_REMOTE_ID_KEY);
        const provider = localStorage.getItem(SYNC_PROVIDER_KEY) || 'github';
        if (token) {
            const tKey = providerTokenKey(provider === 'gitlab' ? 'gitlab' : 'github');
            const rKey = providerRemoteIdKey(provider === 'gitlab' ? 'gitlab' : 'github');
            if (!localStorage.getItem(tKey)) localStorage.setItem(tKey, token);
            if (remoteId && !localStorage.getItem(rKey)) localStorage.setItem(rKey, remoteId);
        }
        if (!localStorage.getItem(SYNC_MODE_KEY) && localStorage.getItem(SYNC_ENABLED_KEY) === 'true') {
            localStorage.setItem(SYNC_MODE_KEY, provider === 'gitlab' ? 'gitlab' : 'github');
        }
        localStorage.setItem(SYNC_MIGRATED_V2_KEY, 'done');
    }

    migrateLegacySyncStorage();

    function getSyncMode() {
        return localStorage.getItem(SYNC_MODE_KEY) || localStorage.getItem(SYNC_PROVIDER_KEY) || 'github';
    }

    function getSyncProvider() {
        return getSyncMode();
    }

    function getProviderToken(provider) {
        return localStorage.getItem(providerTokenKey(provider)) || '';
    }

    function setProviderToken(provider, token) {
        if (token) localStorage.setItem(providerTokenKey(provider), token);
    }

    function getProviderRemoteId(provider) {
        return localStorage.getItem(providerRemoteIdKey(provider)) || '';
    }

    function setProviderRemoteId(provider, id) {
        if (id) localStorage.setItem(providerRemoteIdKey(provider), String(id));
    }

    function getRemoteId() {
        const mode = getSyncMode();
        if (mode === 'gitlab') return getProviderRemoteId('gitlab');
        if (mode === 'both') return getProviderRemoteId('github') || getProviderRemoteId('gitlab');
        return getProviderRemoteId('github');
    }

    function getRemoteIds() {
        return {
            github: getProviderRemoteId('github'),
            gitlab: getProviderRemoteId('gitlab')
        };
    }

    function getActiveProvidersForSync() {
        const mode = getSyncMode();
        const providers = [];
        if (mode === 'both' || mode === 'github') {
            if (getProviderToken('github')) providers.push('github');
        }
        if (mode === 'both' || mode === 'gitlab') {
            if (getProviderToken('gitlab')) providers.push('gitlab');
        }
        return providers;
    }

    function isSyncConfigured() {
        if (localStorage.getItem(SYNC_ENABLED_KEY) !== 'true') return false;
        if (!localStorage.getItem(SYNC_PIN_HASH_KEY)) return false;
        const providers = getActiveProvidersForSync();
        if (providers.length === 0) return false;
        return providers.some((p) => !!getProviderRemoteId(p));
    }

    function getSyncToken() {
        const mode = getSyncMode();
        if (mode === 'gitlab') return getProviderToken('gitlab');
        return getProviderToken('github');
    }

    function collectPayload() {
        const deps = global.HerculesSyncDeps;
        if (!deps) return null;
        return {
            version: SYNC_VERSION,
            updatedAt: Date.now(),
            favorites: deps.getFavorites ? deps.getFavorites() : [],
            explicitFavorites: deps.getExplicitFavorites ? deps.getExplicitFavorites() : [],
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

        let mergedExplicitFavorites;
        if (Array.isArray(remote.explicitFavorites)) {
            mergedExplicitFavorites = [...remote.explicitFavorites];
        } else {
            mergedExplicitFavorites = deps.getExplicitFavorites ? deps.getExplicitFavorites() : [];
        }

        let mergedFavorites;
        if (Array.isArray(remote.favorites)) {
            mergedFavorites = [...remote.favorites];
        } else {
            mergedFavorites = [...mergedExplicitFavorites];
        }

        // Stele = explicitFavorites; lista din cloud înlocuiește local (nu se face uniune)
        if (Array.isArray(remote.explicitFavorites)) {
            mergedFavorites = [...mergedExplicitFavorites];
        }

        // Cloud gol, dar ai favorite noi local (ex. YouTube) — păstrează local, urcă în cloud
        const localExplicit = deps.getExplicitFavorites ? deps.getExplicitFavorites() : [];
        const localExplicitModified = deps.getExplicitFavoritesModifiedAt
            ? deps.getExplicitFavoritesModifiedAt()
            : 0;
        let pushLocalFavoritesAfterApply = false;
        if (
            Array.isArray(remote.explicitFavorites)
            && remote.explicitFavorites.length === 0
            && localExplicit.length > 0
            && localExplicitModified > (remote.updatedAt || 0)
        ) {
            mergedExplicitFavorites = [...localExplicit];
            mergedFavorites = [...localExplicit];
            pushLocalFavoritesAfterApply = true;
        }

        // explicitFavorites din cloud = alegeri ale utilizatorului — nu se filtrează
        if (deps.filterSyncFavorites && Array.isArray(mergedFavorites) && !Array.isArray(remote.explicitFavorites)) {
            mergedFavorites = deps.filterSyncFavorites(mergedFavorites);
        }

        const mergedVisitStats = mergeVisitStats(
            deps.getVisitStats ? deps.getVisitStats() : {},
            remote.visitStats
        );

        const mergedPayload = {
            favorites: mergedFavorites,
            explicitFavorites: mergedExplicitFavorites,
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
            fromCloud: true,
            remoteUpdatedAt: remote.updatedAt || 0
        };
        if (Array.isArray(remote.searchHistory)) {
            mergedPayload.searchHistory = remote.searchHistory;
        }

        let summary = { favorites: 0, searches: 0, passwords: 0, notes: 0, links: 0 };
        if (deps.applyMerged) {
            summary = deps.applyMerged(mergedPayload) || summary;
        }
        if (pushLocalFavoritesAfterApply) {
            if (deps.scheduleCloudSyncPush) deps.scheduleCloudSyncPush();
            else if (global.HerculesCloudSync && global.HerculesCloudSync.scheduleCloudSyncPush) {
                global.HerculesCloudSync.scheduleCloudSyncPush();
            }
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
        if (status === 403 && lower.includes('rate limit')) {
            return (
                'GitHub: limită API depășită (prea multe sync-uri). ' +
                'Așteaptă 15–60 minute sau folosește GitLab Snippet. ' +
                'Între timp: datele locale rămân, dar Încarcă/Descarcă nu merge.'
            );
        }
        return 'GitHub ' + status + ': ' + (errText.slice(0, 100) || 'eroare API');
    }

    function isRateLimited() {
        return Date.now() < rateLimitUntil;
    }

    function markRateLimitFromResponse(res, errText) {
        const lower = (errText || '').toLowerCase();
        if (res.status !== 403 || !lower.includes('rate limit')) return false;
        const resetHeader = res.headers.get('X-RateLimit-Reset');
        let until = Date.now() + 15 * 60 * 1000;
        if (resetHeader) {
            const resetMs = parseInt(resetHeader, 10) * 1000;
            if (Number.isFinite(resetMs)) {
                until = Math.max(Date.now() + 60000, resetMs);
            }
        }
        rateLimitUntil = until;
        if (!rateLimitNotified && global.HerculesSyncDeps && global.HerculesSyncDeps.notify) {
            rateLimitNotified = true;
            const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
            global.HerculesSyncDeps.notify(
                '⏳ GitHub: limită API. Sync automat oprit ~' + mins + ' min.',
                'warning'
            );
        }
        return true;
    }

    async function waitForApiSlot() {
        if (isRateLimited()) {
            throw new Error(formatGitHubError(403, 'rate limit exceeded'));
        }
        const gap = Date.now() - lastApiCallAt;
        if (gap < MIN_API_GAP_MS) {
            await new Promise((resolve) => setTimeout(resolve, MIN_API_GAP_MS - gap));
        }
        lastApiCallAt = Date.now();
    }

    async function githubFetch(path, options) {
        await waitForApiSlot();
        const token = getProviderToken('github');
        const headers = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(options && options.headers ? options.headers : {})
        };
        if (token) headers.Authorization = 'Bearer ' + token;
        const res = await fetch('https://api.github.com' + path, { ...options, headers });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            markRateLimitFromResponse(res, errText);
            throw new Error(formatGitHubError(res.status, errText));
        }
        rateLimitNotified = false;
        return res.json();
    }

    async function gitlabFetch(path, options) {
        const token = getProviderToken('gitlab');
        const headers = {
            ...(options && options.headers ? options.headers : {})
        };
        if (token) headers['PRIVATE-TOKEN'] = token;
        const res = await fetch('https://gitlab.com/api/v4' + path, { ...options, headers });
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

    async function gitlabFetchText(path) {
        const token = getProviderToken('gitlab');
        const headers = {};
        if (token) headers['PRIVATE-TOKEN'] = token;
        const res = await fetch('https://gitlab.com/api/v4' + path, { headers });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error('GitLab: ' + res.status + ' ' + (errText.slice(0, 120) || res.statusText));
        }
        return res.text();
    }

    async function gitlabReadSnippetEnvelope(id) {
        const snippet = await gitlabFetch('/snippets/' + encodeURIComponent(id));
        let content = snippet.content || '';
        if (!content && snippet.files) {
            if (Array.isArray(snippet.files)) {
                content = (snippet.files[0] && snippet.files[0].content) || '';
            } else if (typeof snippet.files === 'object') {
                const first = Object.values(snippet.files)[0];
                content = (first && first.content) || '';
            }
        }
        // GitLab API adesea nu returnează content în GET — folosește /raw
        if (!content || !String(content).trim()) {
            content = await gitlabFetchText('/snippets/' + encodeURIComponent(id) + '/raw');
        }
        if (!content || !String(content).trim()) return null;
        return JSON.parse(content);
    }

    async function remoteReadEnvelope(provider) {
        const id = getProviderRemoteId(provider);
        if (!id) throw missingRemoteIdError();

        if (provider === 'gitlab') {
            return gitlabReadSnippetEnvelope(id);
        }

        const gist = await githubFetch('/gists/' + encodeURIComponent(id));
        const file = gist.files && gist.files[SYNC_FILE_NAME];
        if (!file || !file.content) return null;
        return JSON.parse(file.content);
    }

    async function remoteWriteEnvelope(provider, envelope) {
        const id = getProviderRemoteId(provider);
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
                setProviderRemoteId('gitlab', created.id);
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
            setProviderRemoteId('github', created.id);
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
        const providers = getActiveProvidersForSync().filter((p) => getProviderRemoteId(p));
        if (providers.length === 0) return { ok: false, error: missingRemoteIdError().message };
        pullInFlight = true;
        try {
            const usePin = pin || syncPinCache;
            if (!usePin) return { ok: false, reason: 'no-pin' };

            let bestPayload = null;
            let bestTs = -1;
            let bestProvider = null;
            const errors = [];

            for (const provider of providers) {
                if (provider === 'github' && !force && isRateLimited()) {
                    errors.push('GitHub: limită API (folosește GitLab sau așteaptă)');
                    continue;
                }
                try {
                    const envelope = await remoteReadEnvelope(provider);
                    if (!envelope) {
                        errors.push(provider + ': cloud gol');
                        continue;
                    }
                    const payload = await decryptJson(usePin, envelope);
                    const ts = payload.updatedAt || 0;
                    if (ts >= bestTs) {
                        bestTs = ts;
                        bestPayload = payload;
                        bestProvider = provider;
                    }
                } catch (e) {
                    errors.push(provider + ': ' + (e.message || String(e)));
                }
            }

            if (!bestPayload) {
                return {
                    ok: false,
                    error: errors.join(' | ') || 'Nu s-a putut citi din cloud.'
                };
            }

            const result = await applyRemotePayload(bestPayload, { force: !!force, preferRemote: !!force });
            const applied = !!(result && result.applied);
            return {
                ok: true,
                applied,
                updated: applied,
                summary: result && result.summary ? result.summary : null,
                fromCloud: true,
                fromProvider: bestProvider,
                warnings: errors.length ? errors : null
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
        const providers = getActiveProvidersForSync();
        if (providers.length === 0) return { ok: false, reason: 'not-configured' };
        if (!isSyncConfigured() && !force) return { ok: false, reason: 'not-configured' };
        pushInFlight = true;
        try {
            const usePin = pin || syncPinCache;
            if (!usePin) return { ok: false, reason: 'no-pin' };
            const payload = collectPayload();
            if (!payload) return { ok: false, reason: 'no-deps' };
            const envelope = await encryptJson(usePin, payload);
            const remoteIds = {};
            const errors = [];
            let okCount = 0;

            for (const provider of providers) {
                if (provider === 'github' && !force && isRateLimited()) {
                    errors.push('GitHub: limită API — încărcat doar pe GitLab');
                    continue;
                }
                try {
                    const remoteId = await remoteWriteEnvelope(provider, envelope);
                    remoteIds[provider] = remoteId || getProviderRemoteId(provider);
                    okCount += 1;
                } catch (e) {
                    errors.push(provider + ': ' + (e.message || String(e)));
                }
            }

            if (okCount === 0) {
                return { ok: false, error: errors.join(' | ') || 'Eroare la încărcare' };
            }

            const ts = String(payload.updatedAt || Date.now());
            localStorage.setItem(SYNC_LAST_PUSH_KEY, ts);
            localStorage.setItem(SYNC_LAST_PULL_KEY, ts);
            return {
                ok: true,
                remoteId: remoteIds.github || remoteIds.gitlab || getRemoteId(),
                remoteIds,
                partial: errors.length > 0,
                warnings: errors.length ? errors : null
            };
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
        }, PUSH_DEBOUNCE_MS);
    }

    function warnIfGitHubTokenUnsuitable(token, provider) {
        if (provider !== 'gitlab' && token.startsWith('github_pat_')) {
            throw new Error(
                'Token „fine-grained” (github_pat_…) nu funcționează cu Gist. Folosește token CLASIC (ghp_…) cu scope «gist», ' +
                'sau alege «GitLab Snippet» în Platformă.'
            );
        }
    }

    async function setupCloudSync(options) {
        const opts = options || {};
        const provider = opts.provider || 'github';
        const pin = opts.pin;
        const token = (opts.token || '').trim();
        const githubToken = (opts.githubToken || (provider === 'github' || provider === 'both' ? token : '') || getProviderToken('github')).trim();
        const gitlabToken = (opts.gitlabToken || (provider === 'gitlab' || provider === 'both' ? token : '') || getProviderToken('gitlab')).trim();
        const githubRemoteId = (opts.githubRemoteId || opts.remoteId || getProviderRemoteId('github') || '').trim();
        const gitlabRemoteId = (opts.gitlabRemoteId || opts.remoteId || getProviderRemoteId('gitlab') || '').trim();

        if (!pin || pin.length < 8) throw new Error('PIN-ul trebuie să aibă minim 8 caractere');
        if (provider === 'both') {
            if (!githubToken && !gitlabToken) {
                throw new Error('Pentru modul «Ambele»: lipește token GitHub (ghp_) și/sau GitLab (glpat-).');
            }
        } else if (provider === 'gitlab') {
            if (!gitlabToken) throw new Error('Token GitLab invalid — lipește glpat-…');
        } else if (!githubToken) {
            throw new Error('Token GitHub invalid — lipește ghp_… cu scope «gist».');
        }

        if (githubToken) warnIfGitHubTokenUnsuitable(githubToken, 'github');

        const mode = provider === 'both' ? 'both' : (provider === 'gitlab' ? 'gitlab' : 'github');
        const pinHash = await sha256Hex(pin);
        syncPinCache = pin;
        saveSessionPin(pin);
        localStorage.setItem(SYNC_MODE_KEY, mode);
        localStorage.setItem(SYNC_PROVIDER_KEY, mode === 'both' ? 'both' : mode);
        localStorage.setItem(SYNC_PIN_HASH_KEY, pinHash);
        localStorage.setItem(SYNC_ENABLED_KEY, 'true');

        if (githubToken) setProviderToken('github', githubToken);
        if (gitlabToken) setProviderToken('gitlab', gitlabToken);
        if (githubRemoteId) setProviderRemoteId('github', githubRemoteId);
        if (gitlabRemoteId) setProviderRemoteId('gitlab', gitlabRemoteId);

        // compatibilitate veche
        if (mode === 'gitlab') {
            localStorage.setItem(SYNC_TOKEN_KEY, gitlabToken);
            if (gitlabRemoteId) localStorage.setItem(SYNC_REMOTE_ID_KEY, gitlabRemoteId);
        } else if (mode === 'github') {
            localStorage.setItem(SYNC_TOKEN_KEY, githubToken);
            if (githubRemoteId) localStorage.setItem(SYNC_REMOTE_ID_KEY, githubRemoteId);
        }

        const hadExistingRemote = !!(githubRemoteId || gitlabRemoteId || getProviderRemoteId('github') || getProviderRemoteId('gitlab'));

        if (hadExistingRemote) {
            const pullFirst = await pullFromCloud(pin, true);
            if (!pullFirst.ok && pullFirst.error) {
                console.warn('Pull înainte de activare:', pullFirst.error);
            }
        }

        const pushResult = await pushToCloud(pin, true);
        if (!pushResult.ok) {
            throw new Error(pushResult.error || 'Nu s-a putut încărca în cloud. Verifică token-ul.');
        }

        const ids = getRemoteIds();
        if (!ids.github && !ids.gitlab) {
            throw new Error(
                'Cloud-ul nu a returnat ID profil. Verifică token-ul și încearcă din nou «Activează».'
            );
        }

        if (!hadExistingRemote) {
            const pullResult = await pullFromCloud(pin, true);
            if (!pullResult.ok && pullResult.error && !pullResult.error.includes('Lipsește')) {
                console.warn('Pull după activare:', pullResult.error);
            }
        }

        return {
            remoteId: ids.github || ids.gitlab,
            remoteIds: ids,
            mode,
            warnings: pushResult.warnings || null
        };
    }

    function disableCloudSync() {
        localStorage.removeItem(SYNC_ENABLED_KEY);
        localStorage.removeItem(SYNC_TOKEN_KEY);
        localStorage.removeItem(SYNC_REMOTE_ID_KEY);
        localStorage.removeItem(SYNC_MODE_KEY);
        localStorage.removeItem(SYNC_PROVIDER_KEY);
        localStorage.removeItem(SYNC_GITHUB_TOKEN_KEY);
        localStorage.removeItem(SYNC_GITHUB_REMOTE_ID_KEY);
        localStorage.removeItem(SYNC_GITLAB_TOKEN_KEY);
        localStorage.removeItem(SYNC_GITLAB_REMOTE_ID_KEY);
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
        // Fără pull la refresh — evită suprascrierea favorite locale înainte de push
        tryRestoreSessionPin().then((ok) => {
            if (!ok) return;
        });
        setInterval(() => {
            if (syncPinCache && getActiveProvidersForSync().some((p) => p === 'gitlab' || !isRateLimited())) {
                pullFromCloud();
            }
        }, AUTO_PULL_MS);
        setInterval(() => {
            if (syncPinCache && getActiveProvidersForSync().some((p) => p === 'gitlab' || !isRateLimited())) {
                pushToCloud();
            }
        }, AUTO_PUSH_MS);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && syncPinCache && isSyncConfigured()
                && getActiveProvidersForSync().some((p) => p === 'gitlab' || !isRateLimited())) {
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
        getRemoteIds,
        getSyncProvider,
        getSyncMode,
        getActiveProvidersForSync,
        PASSWORD_HISTORY_MAX
    };
})(typeof window !== 'undefined' ? window : globalThis);
