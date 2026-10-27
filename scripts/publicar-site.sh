#!/usr/bin/env bash
# Publica o site no GitHub Pages: gera o build (código + dados) e substitui o branch gh-pages.
# O branch gh-pages não guarda histórico: cada publicação troca tudo de uma vez.
# Antes: rodar o pipeline até `urna publish`, para os dados estarem em web/public/dados/.
set -euo pipefail
cd "$(dirname "$0")/.."

test -f web/public/dados/meta.json || { echo "Faltam os dados: rode 'urna publish' antes." >&2; exit 1; }
remoto=$(git remote get-url origin)

(cd web && npm ci --silent && npm run build)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -r web/dist/. "$tmp"
touch "$tmp/.nojekyll"  # sem isso o GitHub Pages ignora pastas e arquivos especiais

git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" commit -q -m "Publica o site"
git -C "$tmp" push -q -f "$remoto" gh-pages
echo "Publicado: https://odavicoelho.github.io/brasil-urna-por-urna/"
