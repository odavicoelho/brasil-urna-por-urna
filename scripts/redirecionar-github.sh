#!/usr/bin/env bash
# Troca o site do GitHub Pages (branch gh-pages) por um redirecionamento para o endereço novo,
# mantendo o que vem depois do # (link de um local ou de uma descoberta). Rodar só depois que o site
# novo estiver no ar.
set -euo pipefail
cd "$(dirname "$0")/.."

NOVO=$(grep -E '^VITE_SITE_URL=' web/.env | cut -d= -f2-)
test -n "$NOVO" || { echo "VITE_SITE_URL não encontrado em web/.env" >&2; exit 1; }
remoto=$(git remote get-url origin)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/index.html" <<HTML
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brasil Urna por Urna</title>
<link rel="canonical" href="$NOVO">
<meta property="og:title" content="Como votou a sua escola? A eleição de 2026, local por local">
<meta property="og:description" content="O 2º turno em cada um dos 92 mil locais de votação do Brasil, com a renda do entorno pelo Censo 2022.">
<meta property="og:url" content="$NOVO">
<meta property="og:image" content="${NOVO}compartilhar.jpg">
<meta name="twitter:card" content="summary_large_image">
<script>location.replace("$NOVO" + location.hash);</script>
<meta http-equiv="refresh" content="1; url=$NOVO">
</head>
<body style="font-family:system-ui,sans-serif;padding:24px">
<p>O Brasil Urna por Urna mudou de endereço: <a href="$NOVO">$NOVO</a></p>
</body>
</html>
HTML
cp "$tmp/index.html" "$tmp/404.html"  # qualquer caminho antigo também redireciona
touch "$tmp/.nojekyll"

git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" commit -q -m "Redireciona para o endereço novo do site"
git -C "$tmp" push -q -f "$remoto" gh-pages
echo "GitHub Pages agora redireciona para $NOVO"
