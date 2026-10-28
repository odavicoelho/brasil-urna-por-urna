#!/usr/bin/env bash
# Publica o site no Cloudflare Pages: gera o build (código + dados) e envia com o Wrangler.
# Antes: rodar o pipeline até `urna publish`, para os dados estarem em web/public/dados/.
# Na primeira vez: `cd web && npx wrangler login` (abre o navegador para autorizar a conta do Cloudflare).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJETO=brasil-urna-por-urna
test -f web/public/dados/meta.json || { echo "Faltam os dados: rode 'urna publish' antes." >&2; exit 1; }

cd web
npm ci --silent
npm run build
npx wrangler pages deploy dist --project-name "$PROJETO" --branch main --commit-dirty=true
