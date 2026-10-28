#!/usr/bin/env bash
# Publica o site no Cloudflare Pages: gera o build (código + dados) e envia com o Wrangler.
# Antes: rodar o pipeline até `urna publish`, para os dados estarem em web/public/dados/.
# Na primeira vez: `cd web && npx wrangler login --scopes account:read user:read pages:write`
# (abre o navegador para autorizar a conta do Cloudflare só com o necessário para o Pages).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJETO=brasil-urna-por-urna
test -f web/public/dados/meta.json || { echo "Faltam os dados: rode 'urna publish' antes." >&2; exit 1; }

WEB=$PWD/web
(cd "$WEB" && npm ci --silent && npm run build)

# O Wrangler roda de uma pasta vazia: dentro de web/ ele detecta o Vite e tenta mexer na configuração.
neutra=$(mktemp -d)
trap 'rm -rf "$neutra"' EXIT
(cd "$neutra" && "$WEB/node_modules/.bin/wrangler" pages deploy "$WEB/dist" \
  --project-name "$PROJETO" --branch main --commit-dirty=true)
