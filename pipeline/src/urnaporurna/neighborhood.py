"""Perfil do entorno de cada local de votação, a partir do Censo 2022 por setor censitário.

Entorno = círculo de 500 m em volta do local. Cada setor que toca o círculo entra com peso igual à
fração da área dele que fica dentro do círculo (supõe a população espalhada por igual no setor).
Exceção rural: se o local está num setor rural maior que o próprio círculo, usa o setor inteiro,
porque um círculo de 500 m no campo pegaria quase ninguém.

É uma aproximação: o eleitor costuma votar perto de casa, mas nem sempre.
Distâncias e áreas em metros, na projeção policônica do Brasil (SIRGAS 2000, EPSG:5880).
"""

from __future__ import annotations

import math

import duckdb

from urnaporurna.config import BRONZE, RAW, SILVER, SOURCES
from urnaporurna.places import connect

RADIUS_M = 500
CIRCLE_KM2 = math.pi * (RADIUS_M / 1000) ** 2
METRIC = "EPSG:5880"
GEOGRAPHIC = "EPSG:4674"  # SIRGAS 2000, o sistema da malha do IBGE

# Indicadores: nome -> (numerador, denominador), somas das variáveis do Censo ponderadas pelo peso.
RATIOS = {
    "pct_alfabetizados_15_mais": ("V00900", "V00900 + V00901"),
    "pct_15_a_29_anos": ("V01034 + V01035 + V01036", "V01006"),
    "pct_30_a_59_anos": ("V01037 + V01038 + V01039", "V01006"),
    "pct_60_anos_ou_mais": ("V01040 + V01041", "V01006"),
    "pct_branca": ("V01317", "V01317 + V01318 + V01319 + V01320 + V01321"),
    "pct_preta": ("V01318", "V01317 + V01318 + V01319 + V01320 + V01321"),
    "pct_parda": ("V01320", "V01317 + V01318 + V01319 + V01320 + V01321"),
    "pct_amarela": ("V01319", "V01317 + V01318 + V01319 + V01320 + V01321"),
    "pct_indigena": ("V01321", "V01317 + V01318 + V01319 + V01320 + V01321"),
}

# Variáveis numéricas por tabela. O IBGE publica "X" no lugar de contagens muito pequenas (sigilo).
# Contagem sigilosa conta como zero: o viés é mínimo e nenhum percentual passa de 100.
# Média sigilosa (renda) não pode virar zero: o setor sai da média.
VARIABLES = {
    "censo_basico": ["V0001"],
    "censo_demografia": ["V01006", *(f"V010{n}" for n in range(34, 42))],
    "censo_alfabetizacao": ["V00900", "V00901"],
    "censo_cor_raca": ["V01317", "V01318", "V01319", "V01320", "V01321"],
    "censo_renda": ["V06001", "V06004"],
}
MEANS = {"V06004"}


def to_metric(expr: str) -> str:
    return f"ST_Transform({expr}, '{GEOGRAPHIC}', '{METRIC}', always_xy := true)"


def load_census(con: duckdb.DuckDBPyConnection) -> None:
    """Uma linha por setor com as variáveis usadas, já numéricas."""
    selects = []
    for table, cols in VARIABLES.items():
        casts = ", ".join(
            f"try_cast({c} AS DOUBLE) AS {c}"
            if c in MEANS
            else f"coalesce(try_cast({c} AS DOUBLE), 0) AS {c}"
            for c in cols
        )
        selects.append(
            f"(SELECT CD_SETOR AS cd_setor, {casts} FROM '{BRONZE / f'{table}.parquet'}') AS {table}"
        )
    first, *rest = selects
    joins = " ".join(f"LEFT JOIN {s} USING (cd_setor)" for s in rest)
    con.execute(
        f"""
        CREATE OR REPLACE TABLE censo AS
        SELECT b.cd_setor, b.SITUACAO AS situacao, * EXCLUDE (cd_setor, SITUACAO)
        FROM (SELECT CD_SETOR AS cd_setor, SITUACAO FROM '{BRONZE / "censo_basico.parquet"}') b
        LEFT JOIN {first} USING (cd_setor) {joins}
        """
    )


def load_tracts(con: duckdb.DuckDBPyConnection) -> None:
    gpkg = RAW / SOURCES["setores_ibge"].url.rsplit("/", 1)[-1]
    con.execute(
        f"""
        CREATE OR REPLACE TABLE setores AS
        SELECT CD_SETOR AS cd_setor, {to_metric("geom")} AS geom
        FROM ST_Read('{gpkg}')
        """
    )
    con.execute("ALTER TABLE setores ADD COLUMN area_m2 DOUBLE")
    con.execute("UPDATE setores SET area_m2 = ST_Area(geom)")


def build_weights(con: duckdb.DuckDBPyConnection) -> None:
    """Peso de cada setor no entorno de cada local."""
    con.execute(
        f"""
        CREATE OR REPLACE TABLE pontos AS
        SELECT place_id, {to_metric("ST_Point(lon, lat)")} AS pt
        FROM '{SILVER / "locais.parquet"}'
        WHERE lat IS NOT NULL AND secoes_principais > 0
        """
    )
    # Setor que contém o local: decide se vale a exceção rural.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE setor_do_local AS
        SELECT p.place_id, any_value(s.cd_setor) AS cd_setor,
            any_value(c.situacao) = 'Rural' AND any_value(s.area_m2) > {CIRCLE_KM2 * 1e6} AS rural_grande
        FROM pontos p
        JOIN setores s ON ST_Intersects(p.pt, s.geom)
        LEFT JOIN censo c ON c.cd_setor = s.cd_setor
        GROUP BY p.place_id
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE pesos AS
        WITH circulos AS (
            SELECT p.place_id, ST_Buffer(p.pt, {RADIUS_M}, 16) AS circ
            FROM pontos p LEFT JOIN setor_do_local sl USING (place_id)
            WHERE NOT coalesce(sl.rural_grande, false)
        )
        SELECT c.place_id, s.cd_setor, ST_Area(ST_Intersection(c.circ, s.geom)) / s.area_m2 AS peso,
            'raio_500m' AS metodo
        FROM circulos c JOIN setores s ON ST_Intersects(c.circ, s.geom)
        UNION ALL
        SELECT place_id, cd_setor, 1.0, 'setor_rural' FROM setor_do_local WHERE rural_grande
        """
    )


def build_profile(con: duckdb.DuckDBPyConnection) -> None:
    def weighted(expr: str) -> str:
        return f"sum(w.peso * ({expr}))"

    ratios = ",\n".join(
        f"round(100 * {weighted(num)} / nullif({weighted(den)}, 0), 1) AS {name}"
        for name, (num, den) in RATIOS.items()
    )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE entorno AS
        SELECT w.place_id, any_value(w.metodo) AS metodo_entorno, count(*) AS setores,
            round({weighted("c.V0001")}) AS populacao_estimada,
            round(
                {weighted("c.V06001 * c.V06004")}
                / nullif(sum(w.peso * c.V06001) FILTER (c.V06004 IS NOT NULL), 0), 2
            ) AS renda_media_responsavel,
            {ratios}
        FROM pesos w JOIN censo c USING (cd_setor)
        GROUP BY w.place_id
        """
    )


def write(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(
        f"COPY (SELECT * FROM entorno ORDER BY place_id) TO '{SILVER / 'entorno.parquet'}' (FORMAT parquet)"
    )


def run() -> duckdb.DuckDBPyConnection:
    con = connect()
    load_census(con)
    load_tracts(con)
    build_weights(con)
    build_profile(con)
    write(con)
    return con


POPULACAO_CENSO_2022 = 203_080_756  # população do Brasil divulgada pelo IBGE


def checks(con: duckdb.DuckDBPyConnection) -> list[tuple[str, bool, str]]:
    """Conferências do perfil do entorno: (descrição, passou, detalhe)."""
    out = []
    row = con.execute(
        """
        SELECT count(*) FILTER (c.cd_setor IS NULL), count(*) FILTER (s.cd_setor IS NULL), count(*)
        FROM setores s FULL JOIN censo c USING (cd_setor)
        """
    ).fetchone()
    assert row is not None
    out.append(
        (
            "setores da malha e das tabelas do Censo são os mesmos",
            row[0] == 0 and row[1] == 0,
            f"{row[2]:,} setores; {row[0]} só na malha, {row[1]} só nas tabelas",
        )
    )
    (pop,) = con.execute("SELECT sum(V0001)::BIGINT FROM censo").fetchone() or (0,)
    out.append(
        (
            "população somada dos setores = população do Censo 2022",
            pop == POPULACAO_CENSO_2022,
            f"{pop:,} (IBGE: {POPULACAO_CENSO_2022:,})",
        )
    )
    row = con.execute(
        "SELECT count(*), count(e.place_id) FROM pontos p LEFT JOIN entorno e USING (place_id)"
    ).fetchone()
    assert row is not None
    out.append(
        ("todo local no mapa tem perfil do entorno", row[0] == row[1], f"{row[1]:,} de {row[0]:,} locais")
    )
    pct_cols = list(RATIOS)
    bad = " OR ".join(f"{c} NOT BETWEEN 0 AND 100" for c in pct_cols)
    (n_bad,) = con.execute(f"SELECT count(*) FROM entorno WHERE {bad}").fetchone() or (0,)
    out.append(("percentuais entre 0 e 100", n_bad == 0, f"{n_bad} locais fora da faixa"))
    return out
