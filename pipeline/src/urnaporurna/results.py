"""Resultado da eleição presidencial por local de votação e turno.

Quais candidatos têm votos válidos vem da totalização oficial (`NM_TIPO_DESTINACAO_VOTOS = 'Válido'`).
Voto em número sem candidatura válida (ex.: candidatura anulada depois da impressão da urna) conta
como nulo técnico, igual ao TSE. 95 = branco, 96 = nulo.

Cada seção é ligada ao seu local pelo cadastro de locais do mesmo turno (município + zona + seção).
O número do local que vem nos arquivos de votação às vezes é o número antigo de um local renumerado,
então não é usado. Os arquivos de votação escrevem o código do município sem zeros à esquerda.
"""

from __future__ import annotations

import duckdb

from urnaporurna.config import BRONZE, SILVER

BRANCO = "95"
NULO = "96"


SECTION_KEY = "lpad({p}CD_MUNICIPIO, 5, '0') AS mun, {p}NR_ZONA::INT AS zona, {p}NR_SECAO::INT AS secao"


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    for table in ("votos_secao", "detalhe_secao", "candidatos", "totais_votos", "totais_detalhe"):
        con.execute(f"CREATE OR REPLACE VIEW {table} AS SELECT * FROM '{BRONZE / f'{table}.parquet'}'")
    con.execute(f"CREATE OR REPLACE VIEW locais AS SELECT * FROM '{SILVER / 'locais.parquet'}'")
    con.execute(f"CREATE OR REPLACE VIEW locais_raw AS SELECT * FROM '{BRONZE / 'locais.parquet'}'")
    return con


def build_sections(con: duckdb.DuckDBPyConnection) -> None:
    """Seção -> local de votação, por turno, segundo o cadastro de locais do TSE."""
    con.execute(
        f"""
        CREATE OR REPLACE TABLE secao_local AS
        SELECT DISTINCT NR_TURNO::INT AS turno, {SECTION_KEY.format(p="")},
            CD_MUNICIPIO || '-' || NR_ZONA || '-' || NR_LOCAL_VOTACAO AS place_id,
            NM_LOCAL_VOTACAO AS nome_local, NM_LOCAL_VOTACAO_ORIGINAL AS nome_local_original
        FROM locais_raw
        """
    )


def build_candidates(con: duckdb.DuckDBPyConnection) -> None:
    """Uma linha por candidato e turno: número, nome de urna, partido e se os votos são válidos."""
    con.execute(
        """
        CREATE OR REPLACE TABLE candidatos_turno AS
        WITH votados AS (
            SELECT DISTINCT NR_TURNO::INT AS turno, SQ_CANDIDATO AS sq, NR_VOTAVEL AS numero,
                NM_VOTAVEL AS nome_completo
            FROM votos_secao WHERE NR_VOTAVEL NOT IN ('95', '96')
        ),
        validos AS (
            SELECT DISTINCT NR_TURNO::INT AS turno, SQ_CANDIDATO AS sq
            FROM totais_votos WHERE NM_TIPO_DESTINACAO_VOTOS = 'Válido'
        ),
        cand AS (
            SELECT DISTINCT NR_TURNO::INT AS turno, SQ_CANDIDATO AS sq, NM_URNA_CANDIDATO AS nome,
                SG_PARTIDO AS partido, DS_SIT_TOT_TURNO AS situacao
            FROM candidatos WHERE CD_CARGO = '1'
        )
        SELECT v.turno, v.numero::INT AS numero, coalesce(c.nome, v.nome_completo) AS nome, c.partido,
            c.situacao, va.sq IS NOT NULL AS valido
        FROM votados v
        LEFT JOIN cand c USING (turno, sq)
        LEFT JOIN validos va USING (turno, sq)
        """
    )


def build_results(con: duckdb.DuckDBPyConnection) -> None:
    """Votos por local (candidatos válidos) e o quadro de comparecimento por local."""
    con.execute(
        f"""
        CREATE OR REPLACE TABLE votos_classificados AS
        WITH v AS (SELECT *, NR_TURNO::INT AS turno, {SECTION_KEY.format(p="")} FROM votos_secao)
        SELECT sl.place_id, v.SG_UF AS uf, v.turno, v.mun, v.zona, v.secao, v.NR_VOTAVEL::INT AS numero,
            v.QT_VOTOS::BIGINT AS votos, v.NM_LOCAL_VOTACAO AS nome_local_votos,
            CASE WHEN v.NR_VOTAVEL = '{BRANCO}' THEN 'branco'
                 WHEN v.NR_VOTAVEL = '{NULO}' THEN 'nulo'
                 WHEN c.valido THEN 'valido'
                 ELSE 'nulo_tecnico' END AS tipo
        FROM v
        LEFT JOIN secao_local sl USING (turno, mun, zona, secao)
        LEFT JOIN candidatos_turno c ON c.turno = v.turno AND c.numero = v.NR_VOTAVEL::INT
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE resultados_local AS
        SELECT place_id, turno, numero, sum(votos) AS votos,
            round(100.0 * sum(votos) / sum(sum(votos)) OVER (PARTITION BY place_id, turno), 2) AS pct_validos
        FROM votos_classificados WHERE tipo = 'valido'
        GROUP BY place_id, turno, numero
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE comparecimento_local AS
        WITH d AS (
            SELECT sl.place_id, dt.turno,
                count(*) FILTER (dt.ST_SECAO_INSTALADA = 'Sim') AS secoes,
                sum(dt.QT_APTOS::BIGINT) AS aptos, sum(dt.QT_COMPARECIMENTO::BIGINT) AS comparecimento,
                sum(dt.QT_ABSTENCOES::BIGINT) AS abstencoes
            FROM (SELECT *, NR_TURNO::INT AS turno, {SECTION_KEY.format(p="")} FROM detalhe_secao) dt
            LEFT JOIN secao_local sl USING (turno, mun, zona, secao)
            GROUP BY sl.place_id, dt.turno
        ),
        v AS (
            SELECT place_id, turno,
                sum(votos) FILTER (tipo = 'valido') AS validos,
                sum(votos) FILTER (tipo = 'branco') AS brancos,
                sum(votos) FILTER (tipo IN ('nulo', 'nulo_tecnico')) AS nulos
            FROM votos_classificados GROUP BY ALL
        )
        SELECT d.*, coalesce(v.validos, 0) AS validos, coalesce(v.brancos, 0) AS brancos,
            coalesce(v.nulos, 0) AS nulos,
            round(100.0 * d.comparecimento / nullif(d.aptos, 0), 2) AS pct_comparecimento
        FROM d LEFT JOIN v USING (place_id, turno)
        """
    )


def write(con: duckdb.DuckDBPyConnection) -> None:
    SILVER.mkdir(parents=True, exist_ok=True)
    for table, order in (
        ("candidatos_turno", "turno, numero"),
        ("resultados_local", "place_id, turno, numero"),
        ("comparecimento_local", "place_id, turno"),
    ):
        con.execute(
            f"COPY (SELECT * FROM {table} ORDER BY {order}) TO '{SILVER / table}.parquet' (FORMAT parquet)"
        )


def run() -> duckdb.DuckDBPyConnection:
    con = connect()
    build_sections(con)
    build_candidates(con)
    build_results(con)
    write(con)
    return con
