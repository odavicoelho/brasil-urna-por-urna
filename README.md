# Brasil Urna por Urna

O resultado da eleição presidencial de 2026, nos dois turnos, em cada um dos ~95 mil locais de votação do país, com o perfil do entorno de cada local segundo o Censo 2022 do IBGE.

> Em construção. Hoje o repositório tem a primeira etapa do pipeline: baixar os dados públicos e montar os locais de votação com coordenadas conferidas.

## De onde vêm os dados

Tudo é público e gratuito:

- **TSE (dadosabertos.tse.jus.br):** votos por seção eleitoral, detalhe da apuração (comparecimento, brancos, nulos) e locais de votação com endereço e coordenadas.
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
```

Cerca de 1.500 locais (0,5% do eleitorado) não aparecem no mapa porque a coordenada publicada pelo TSE está vazia ou errada e não foi possível localizá-los com segurança. Os votos deles continuam contando nos totais.

Cada arquivo baixado fica registrado em `data/manifest.json` (URL, tamanho, SHA-256 e data), para qualquer pessoa conferir que usou os mesmos dados.

## Licença

MIT
