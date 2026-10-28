"""Pacote de dados abertos para o release no GitHub (data/release/).

Cada tabela vai em CSV comprimido (abre no Excel, no Google Planilhas, em qualquer linguagem) e em Parquet
(para quem trabalha com dados), junto com o dicionário (LEIAME.md), a conferência e a lista das fontes
com a data e o SHA-256 de cada arquivo baixado. Tudo também num .zip único.
"""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path
from typing import Any

import duckdb

from urnaporurna.config import DATA, MANIFEST, SILVER

OUT = DATA / "release"
ZIP = "brasil-urna-por-urna-dados-2026.zip"

# Nome do arquivo -> consulta. Só colunas públicas e úteis; nada de colunas internas de trabalho.
TABELAS: dict[str, str] = {
    "locais_votacao_2026": """
        SELECT place_id AS id_local, uf, cd_tse AS cod_municipio_tse, cd_ibge AS cod_municipio_ibge,
            municipio, zona, nr_local AS numero_local, nome, tipo, endereco, bairro, cep,
            secoes, secoes_principais, round(lat, 6) AS latitude, round(lon, 6) AS longitude,
            geo_fonte AS fonte_coordenada, geo_precisao AS precisao_coordenada
        FROM locais WHERE secoes_principais > 0 ORDER BY place_id
    """,
    "votos_por_local_2026": """
        SELECT place_id AS id_local, turno, numero AS numero_candidato, votos
        FROM resultados_local ORDER BY place_id, turno, numero
    """,
    "comparecimento_por_local_2026": """
        SELECT place_id AS id_local, turno, secoes, aptos, comparecimento, abstencoes, validos, brancos, nulos
        FROM comparecimento_local ORDER BY place_id, turno
    """,
    "entorno_censo2022_por_local": """
        SELECT place_id AS id_local, metodo_entorno, setores AS setores_censitarios,
            round(populacao_estimada) AS populacao_estimada,
            round(renda_media_responsavel, 2) AS renda_media_responsavel,
            round(pct_alfabetizados_15_mais, 2) AS pct_alfabetizados_15_mais,
            round(pct_15_a_29_anos, 2) AS pct_15_a_29_anos, round(pct_30_a_59_anos, 2) AS pct_30_a_59_anos,
            round(pct_60_anos_ou_mais, 2) AS pct_60_anos_ou_mais, round(pct_branca, 2) AS pct_branca,
            round(pct_preta, 2) AS pct_preta, round(pct_parda, 2) AS pct_parda,
            round(pct_amarela, 2) AS pct_amarela, round(pct_indigena, 2) AS pct_indigena
        FROM entorno ORDER BY place_id
    """,
    "candidatos_2026": """
        SELECT turno, numero AS numero_candidato, nome AS nome_urna, partido, situacao, valido
        FROM candidatos_turno ORDER BY turno, numero
    """,
}

LEIAME = """# Brasil Urna por Urna: dados abertos da eleição presidencial de 2026

O resultado dos dois turnos em cada local de votação do Brasil e do exterior, com o perfil do entorno de
cada local segundo o Censo 2022. Gerado pelo pipeline em https://github.com/odavicoelho/brasil-urna-por-urna
a partir dos dados abertos do TSE e do IBGE. Mapa: https://brasil-urna-por-urna.pages.dev/

Cada tabela vem em `.csv.gz` (separador vírgula, UTF-8, ponto decimal) e em `.parquet`. A chave que liga
tudo é `id_local` (código TSE do município, zona e número do local: `58670-222-1422`).

{contagens}

## locais_votacao_2026

Um local de votação por linha (só os que tiveram urna própria).

| coluna | o que é |
|---|---|
| id_local | município TSE + zona + número do local |
| uf | sigla da UF (`ZZ` = exterior) |
| cod_municipio_tse, cod_municipio_ibge | código do município no TSE e no IBGE |
| municipio, zona, numero_local | como no cadastro do TSE |
| nome, tipo, endereco, bairro, cep | como no cadastro do TSE |
| secoes | seções do local; `secoes_principais` = as que tiveram urna (as agregadas votam na principal) |
| latitude, longitude | coordenada final (vazia quando não deu para localizar com segurança) |
| fonte_coordenada | `tse` (a do cadastro, conferida) ou `geocodificado` (OpenStreetMap/Nominatim) |
| precisao_coordenada | `exata` ou `aproximada` (posta pelo CEP) |

## votos_por_local_2026

Votos de cada candidato em cada local, por turno (formato longo). Só votos válidos: brancos e nulos estão em
`comparecimento_por_local_2026`. Votos em candidatura anulada contam como nulos, como na totalização oficial.

## comparecimento_por_local_2026

Por local e turno: seções, eleitores aptos, comparecimento, abstenções, votos válidos, brancos e nulos.
Sempre vale: aptos = comparecimento + abstenções; comparecimento = válidos + brancos + nulos.

## entorno_censo2022_por_local

Perfil de quem mora em volta de cada local no mapa, pelo Censo 2022 (IBGE). `metodo_entorno` =
`raio_500m` (setores censitários num círculo de 500 m, cada um pesado pela fração da área dentro do círculo)
ou `setor_rural` (o setor rural onde fica o local, quando ele é maior que o círculo). Renda: média do
responsável pelo domicílio, em R$. Percentuais de 0 a 100. É uma aproximação: o eleitor costuma votar perto de
casa, mas nem sempre. Os dados descrevem lugares, não pessoas.

## candidatos_2026

Número, nome de urna, partido e situação de cada candidato em cada turno, como no TSE.

## conferencia.json e fontes.json

`conferencia.json`: o resultado de cada conferência contra a totalização oficial do TSE (o pipeline para se
alguma falha). `fontes.json`: cada arquivo baixado do TSE e do IBGE, com URL, data de publicação informada
pelo servidor, tamanho e SHA-256, para conferir que os dados são os mesmos.

## Licença e créditos

Dados de origem: TSE e IBGE (dados abertos). Coordenadas geocodificadas: © colaboradores do OpenStreetMap,
licença ODbL. Código: MIT.
"""


def run() -> dict[str, int]:
    con = duckdb.connect()
    for t in ("locais", "resultados_local", "comparecimento_local", "entorno", "candidatos_turno"):
        con.execute(f"CREATE VIEW {t} AS SELECT * FROM '{SILVER / f'{t}.parquet'}'")
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    sizes: dict[str, int] = {}
    contagens = []
    for nome, sql in TABELAS.items():
        con.execute(f"CREATE OR REPLACE TEMP TABLE t AS {sql}")
        n = con.execute("SELECT count(*) FROM t").fetchone()[0]  # type: ignore[index]
        contagens.append(f"- `{nome}`: {n:,} linhas".replace(",", "."))
        parquet, csv = OUT / f"{nome}.parquet", OUT / f"{nome}.csv.gz"
        con.execute(f"COPY t TO '{parquet}' (FORMAT parquet, COMPRESSION zstd)")
        con.execute(f"COPY t TO '{csv}' (HEADER, DELIMITER ',', COMPRESSION gzip)")
        sizes[parquet.name] = parquet.stat().st_size
        sizes[csv.name] = csv.stat().st_size

    shutil.copy(SILVER / "conferencia.json", OUT / "conferencia.json")
    manifest: dict[str, Any] = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    fontes = {
        k: {
            "url": v.get("url"),
            "publicado_em": v.get("last_modified"),
            "bytes": v.get("bytes"),
            "sha256": v.get("sha256"),
        }
        for k, v in manifest.items()
    }
    (OUT / "fontes.json").write_text(json.dumps(fontes, ensure_ascii=False, indent=2))
    (OUT / "LEIAME.md").write_text(LEIAME.replace("{contagens}", "\n".join(contagens)))

    arquivos = sorted(p for p in OUT.iterdir() if p.is_file())
    with zipfile.ZipFile(OUT / ZIP, "w", zipfile.ZIP_STORED) as z:  # tudo já vem comprimido
        for p in arquivos:
            z.write(p, Path("brasil-urna-por-urna-dados-2026") / p.name)
    sizes[ZIP] = (OUT / ZIP).stat().st_size
    return sizes
