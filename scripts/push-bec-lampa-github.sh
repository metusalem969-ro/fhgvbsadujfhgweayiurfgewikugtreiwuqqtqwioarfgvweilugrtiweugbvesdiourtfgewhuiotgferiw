#!/usr/bin/env bash
# Trimite repo-ul Lampa Bec la GitHub (după ce creezi repo gol bec-lampa).
set -euo pipefail

REPO_DIR="${1:-/tmp/bec-lampa}"
GITHUB_REPO="${GITHUB_REPO:-metusalem969-ro/bec-lampa}"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "Clonează mai întâi de pe GitLab:" >&2
  echo "  git clone https://gitlab.com/Hercules-metusalem969/bec-lampa.git" >&2
  exit 1
fi

cd "${REPO_DIR}"
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Setează GITHUB_TOKEN (sau folosește gh auth login)." >&2
  exit 1
fi

git remote remove github 2>/dev/null || true
git remote add github "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git"
git push -u github main

echo ""
echo "Activează GitHub Pages: Settings → Pages → Source: Deploy from branch → main → / (root)"
echo "Link: https://metusalem969-ro.github.io/bec-lampa/"
