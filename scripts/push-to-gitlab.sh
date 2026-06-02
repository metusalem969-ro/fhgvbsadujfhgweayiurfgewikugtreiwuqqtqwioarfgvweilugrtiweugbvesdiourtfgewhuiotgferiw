#!/usr/bin/env bash
# Trimite branch-ul curent (sau argumentul) la GitLab — același flux ca push pe GitHub.
# Necesită: GITLAB_TOKEN (+ opțional GITLAB_PROJECT).
set -euo pipefail

PROJECT="${GITLAB_PROJECT:-Hercules-metusalem969/dashboard}"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
TARGET_BRANCH="${2:-main}"

if [[ -z "${GITLAB_TOKEN:-}" ]]; then
  echo "Eroare: lipsește variabila GITLAB_TOKEN." >&2
  echo "Creează un token GitLab (write_repository, api) și adaugă-l în Cursor → Secrets sau exportă în shell." >&2
  echo "Ghid complet: GITLAB-PAS-CU-PAS.md" >&2
  exit 1
fi

REMOTE_URL="https://oauth2:${GITLAB_TOKEN}@gitlab.com/${PROJECT}.git"

git remote remove gitlab 2>/dev/null || true
git remote add gitlab "${REMOTE_URL}"

echo "Push ${BRANCH} → gitlab:${TARGET_BRANCH} (${PROJECT})"
git push gitlab "${BRANCH}:${TARGET_BRANCH}" -u

echo ""
echo "Gata. În GitLab: Build → Pipelines (verde), apoi Deploy → Pages."
