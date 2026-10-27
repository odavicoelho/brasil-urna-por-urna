# Brasil Urna por Urna

O resultado da eleição presidencial de 2026, nos dois turnos, em cada um dos ~95 mil locais de votação do país, com o perfil do entorno de cada local segundo o Censo 2022 do IBGE.

> Em construção. Hoje o repositório tem o pipeline de dados: baixar os dados públicos, montar os locais de votação com coordenadas conferidas, somar os votos de cada local (conferindo tudo com a totalização oficial do TSE) e montar o perfil do entorno de cada local com o Censo 2022.

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
```

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
