# Brasil Urna por Urna

O resultado da eleição presidencial de 2026, nos dois turnos, em cada um dos ~95 mil locais de votação do país, com o perfil do entorno de cada local segundo o Censo 2022 do IBGE.

Site: https://brasil-urna-por-urna.pages.dev/

## O que o mapa mostra

- **2º turno:** a vantagem de cada candidato em cada local de votação;
- **1º turno:** quem foi o mais votado em cada local;
- **Quem cresceu:** quem mais ganhou votos do 1º para o 2º turno;
- **Renda do entorno:** a renda média do responsável pelo domicílio num raio de 500 m (Censo 2022);
- **Comparecimento** e **brancos e nulos** no 2º turno;
- **toque num local** para ver o resultado, comparado com o município e o Brasil, e o perfil do entorno; cada local tem o seu link para compartilhar;
- **busca** por escola, bairro ou cidade, e um botão para ir direto aos locais perto de você.

A página **Renda e voto** divide o eleitorado em cinco faixas pela renda do entorno e mostra o 2º turno em cada uma (somas exatas de votos), além de um gráfico com todos os locais. A página **Como foi feito** traz a conferência com os totais oficiais e os votos no exterior.

Lula aparece em vermelho e Flávio Bolsonaro em azul (par de cores conferido para daltonismo).

## De onde vêm os dados

Tudo é público e gratuito:

- **TSE (dadosabertos.tse.jus.br):** votos por seção eleitoral, detalhe da apuração (comparecimento, brancos, nulos), locais de votação com endereço e coordenadas, candidatos e a totalização oficial por município e zona (usada só para conferir).
- **IBGE:** malha municipal 2025 (para conferir se cada ponto cai no município certo), malha de setores censitários do Censo 2022 e as tabelas do Censo por setor (população, idade, alfabetização, cor ou raça e renda do responsável pelo domicílio).
- **OpenStreetMap (Nominatim):** só para localizar os poucos locais sem coordenada confiável. Dados © colaboradores do OpenStreetMap, licença ODbL.

## Como rodar

```bash
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/urna ingest    # baixa as fontes (≈ 650 MB) e converte para Parquet
.venv/bin/urna places    # monta os locais de votação e confere as coordenadas
.venv/bin/urna geocode   # localiza os que ficaram sem coordenada confiável (1 req/s, com cache)
                         # --offline usa só o cache, sem requisições novas
.venv/bin/urna results   # soma os votos por local e confere com a totalização oficial
.venv/bin/urna entorno   # perfil do entorno de cada local (Censo 2022, raio de 500 m)
.venv/bin/urna publish   # arquivos de dados do site em web/public/dados/
```

O site (Vite + TypeScript + MapLibre, mapa de fundo do OpenFreeMap) fica em `web/`:

```bash
cd web
npm ci
npm run dev                      # http://localhost:5173/
npx wrangler login               # só na primeira vez: autoriza a conta do Cloudflare
../scripts/publicar-site.sh      # build + publicação no Cloudflare Pages
```

O site foi feito para abrir rápido no celular e mostra só o Brasil: de longe, o mapa de fundo é o contorno do país e dos estados (`brasil.json`, ~50 KB), sem baixar nada de outros países; de perto entram as ruas do OpenFreeMap, com uma máscara cobrindo os vizinhos. O mapa pinta com um arquivo binário de ~450 KB (posição e 2º turno de cada local), o resto das camadas chega logo depois em outro de ~800 KB, e o detalhe de cada local só é baixado quando alguém toca nele (no máximo ~40 KB; as cidades grandes são divididas por zona eleitoral). O formato está descrito em `pipeline/src/urnaporurna/publish.py`.

O site fica no Cloudflare Pages, que serve arquivos estáticos sem limite de tráfego no plano gratuito. Os dados do site (~80 MB no total) não vão para o `main`: saem do pipeline e vão direto na publicação. O endereço antigo no GitHub Pages só redireciona para o novo (`scripts/redirecionar-github.sh`).

## Conferência

Os números só são aceitos se baterem com o TSE. O comando `urna results` confere:

- **votos de cada candidato em cada UF**, nos dois turnos, contra a totalização oficial: diferença zero;
- **comparecimento, abstenções, válidos, brancos e nulos por UF**, contra a totalização oficial (o 2º turno entra assim que o TSE publicar esse arquivo);
- **cada uma das ~499 mil seções**: os dois arquivos do TSE concordam entre si e as contas fecham (aptos = comparecimento + abstenções; comparecimento = soma dos votos);
- **toda seção tem um local de votação cadastrado.**

Se qualquer conferência falhar, o pipeline para. O resultado fica em `data/silver/conferencia.json`.

Dois detalhes dos dados do TSE que o pipeline trata:

- votos em candidatura anulada contam como **nulo técnico**, igual à totalização oficial;
- alguns arquivos de votação trazem o número antigo de locais que foram renumerados, então cada seção é ligada ao seu local pelo cadastro de locais (município + zona + seção).

## O entorno de cada local

Para cada local de votação, o perfil do entorno vem do Censo 2022 do IBGE:

- **entorno = círculo de 500 m** em volta do local. Cada setor censitário que toca o círculo entra com peso igual à fração da área dele dentro do círculo (supondo a população espalhada por igual no setor);
- **no campo**, se o local fica num setor rural maior que o próprio círculo, vale o setor inteiro (um círculo de 500 m ali pegaria quase ninguém);
- **indicadores:** população estimada, renda média do responsável pelo domicílio, alfabetização (15 anos ou mais), faixas de idade e cor ou raça;
- **sigilo do IBGE:** quando uma contagem é muito pequena, o IBGE publica "X" no lugar do número. Essas contagens entram como zero (o efeito é mínimo). Uma renda média sigilosa não entra na média.

É uma aproximação: o eleitor costuma votar perto de casa, mas nem sempre.

Conferências do `urna entorno`: os setores da malha e das tabelas são os mesmos (472.780), a população somada dos setores é exatamente a do Censo 2022 (203.080.756 pessoas), todo local no mapa tem perfil e nenhum percentual sai de 0 a 100.

## O que fica fora do mapa

Cerca de 1.300 locais com urna (0,6% dos votos) não aparecem no mapa porque a coordenada publicada pelo TSE está vazia ou errada e não foi possível localizá-los com segurança. Os votos deles continuam contando em todos os totais. Locais só com seções agregadas não tiveram urna própria (os eleitores votaram na seção principal) e também não aparecem.

Cada arquivo baixado fica registrado em `data/manifest.json` (URL, tamanho, SHA-256 e data), para qualquer pessoa conferir que usou os mesmos dados.

## Licença

MIT
