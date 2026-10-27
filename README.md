# Brasil Urna por Urna

O resultado da eleição presidencial de 2026, nos dois turnos, em cada um dos ~95 mil locais de votação do país, com o perfil do entorno de cada local segundo o Censo 2022 do IBGE.

> Em construção. Hoje o repositório tem o pipeline de dados: baixar os dados públicos, montar os locais de votação com coordenadas conferidas e somar os votos de cada local, conferindo tudo com a totalização oficial do TSE.

## De onde vêm os dados

Tudo é público e gratuito:

- **TSE (dadosabertos.tse.jus.br):** votos por seção eleitoral, detalhe da apuração (comparecimento, brancos, nulos), locais de votação com endereço e coordenadas, candidatos e a totalização oficial por município e zona (usada só para conferir).
- **IBGE:** malha municipal 2025 (para conferir se cada ponto cai no município certo) e, nas próximas etapas, setores censitários e dados do Censo 2022.
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

## O que fica fora do mapa

Cerca de 1.300 locais com urna (0,6% dos votos) não aparecem no mapa porque a coordenada publicada pelo TSE está vazia ou errada e não foi possível localizá-los com segurança. Os votos deles continuam contando em todos os totais. Locais só com seções agregadas não tiveram urna própria (os eleitores votaram na seção principal) e também não aparecem.

Cada arquivo baixado fica registrado em `data/manifest.json` (URL, tamanho, SHA-256 e data), para qualquer pessoa conferir que usou os mesmos dados.

## Licença

MIT
