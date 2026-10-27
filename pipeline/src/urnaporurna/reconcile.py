"""Conferência: as somas por seção precisam bater com a totalização oficial do TSE.

1. Oficial, votos: por turno x UF x candidato, contra `votacao_candidato_munzona`.
2. Oficial, comparecimento: aptos, comparecimento, abstenções, válidos, brancos e nulos por turno x UF,
   contra `detalhe_votacao_munzona`. Turno que o TSE ainda não publicou fica como "aguardando".
3. Interna, seção por seção: os dois arquivos por seção concordam entre si e as contas fecham.
4. Cobertura: todo voto tem um local de votação cadastrado.

Uma falha em qualquer conferência para o pipeline.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any

import duckdb

from urnaporurna.config import SILVER
from urnaporurna.results import SECTION_KEY


@dataclass
class Check:
    nome: str
    turno: int | None
    status: str  # ok | falha | aguardando
    comparados: int
    divergentes: int
    detalhe: str = ""


def official_votes(con: duckdb.DuckDBPyConnection) -> list[Check]:
    rows = con.execute(
        """
        WITH s AS (
            SELECT turno, uf, numero, sum(votos) AS v FROM votos_classificados
            WHERE tipo = 'valido' GROUP BY ALL
        ),
        o AS (
            SELECT NR_TURNO::INT AS turno, SG_UF AS uf, NR_CANDIDATO::INT AS numero,
                sum(QT_VOTOS_NOMINAIS_VALIDOS::BIGINT) AS v
            FROM totais_votos WHERE NM_TIPO_DESTINACAO_VOTOS = 'Válido' GROUP BY ALL
        )
        SELECT turno, count(*), count(*) FILTER (s.v IS DISTINCT FROM o.v),
            sum(coalesce(s.v, 0)) - sum(coalesce(o.v, 0))
        FROM s FULL JOIN o USING (turno, uf, numero)
        GROUP BY turno ORDER BY turno
        """
    ).fetchall()
    return [
        Check(
            "votos por candidato x UF (oficial)",
            t,
            "ok" if bad == 0 else "falha",
            n,
            bad,
            f"diferença total: {diff}",
        )
        for t, n, bad, diff in rows
    ]


TURNOUT_FIELDS = ("aptos", "comparecimento", "abstencoes", "validos", "brancos", "nulos")


def official_turnout(con: duckdb.DuckDBPyConnection) -> list[Check]:
    con.execute(
        """
        CREATE OR REPLACE TEMP TABLE ours AS
        WITH d AS (
            SELECT NR_TURNO::INT AS turno, SG_UF AS uf, sum(QT_APTOS::BIGINT) AS aptos,
                sum(QT_COMPARECIMENTO::BIGINT) AS comparecimento, sum(QT_ABSTENCOES::BIGINT) AS abstencoes
            FROM detalhe_secao GROUP BY ALL
        ),
        v AS (
            SELECT turno, uf,
                sum(votos) FILTER (tipo = 'valido') AS validos,
                sum(votos) FILTER (tipo = 'branco') AS brancos,
                sum(votos) FILTER (tipo IN ('nulo', 'nulo_tecnico')) AS nulos
            FROM votos_classificados GROUP BY ALL
        )
        SELECT * FROM d JOIN v USING (turno, uf)
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TEMP TABLE official AS
        SELECT NR_TURNO::INT AS turno, SG_UF AS uf, sum(QT_APTOS::BIGINT) AS aptos,
            sum(QT_COMPARECIMENTO::BIGINT) AS comparecimento, sum(QT_ABSTENCOES::BIGINT) AS abstencoes,
            sum(QT_TOTAL_VOTOS_VALIDOS::BIGINT) AS validos, sum(QT_VOTOS_BRANCOS::BIGINT) AS brancos,
            sum(QT_TOTAL_VOTOS_NULOS::BIGINT) AS nulos
        FROM totais_detalhe GROUP BY ALL
        """
    )
    published = {r[0] for r in con.execute("SELECT DISTINCT turno FROM official").fetchall()}
    checks = []
    for (turno,) in con.execute("SELECT DISTINCT turno FROM ours ORDER BY 1").fetchall():
        if turno not in published:
            checks.append(
                Check(
                    "comparecimento, brancos e nulos x UF (oficial)",
                    turno,
                    "aguardando",
                    0,
                    0,
                    "o TSE ainda não publicou a totalização deste turno",
                )
            )
            continue
        differs = " OR ".join(f"o.{f} IS DISTINCT FROM s.{f}" for f in TURNOUT_FIELDS)
        row = con.execute(
            f"""
            SELECT count(*), count(*) FILTER ({differs})
            FROM ours s FULL JOIN official o USING (turno, uf) WHERE turno = ?
            """,
            [turno],
        ).fetchone()
        assert row is not None
        checks.append(
            Check(
                "comparecimento, brancos e nulos x UF (oficial)",
                turno,
                "ok" if row[1] == 0 else "falha",
                row[0],
                row[1],
                "campos: " + ", ".join(TURNOUT_FIELDS),
            )
        )
    return checks


def internal_sections(con: duckdb.DuckDBPyConnection) -> list[Check]:
    rows = con.execute(
        f"""
        WITH v AS (
            SELECT turno, mun, zona, secao,
                sum(votos) FILTER (tipo IN ('valido', 'nulo_tecnico')) AS nominais,
                sum(votos) FILTER (tipo = 'branco') AS brancos,
                sum(votos) FILTER (tipo = 'nulo') AS nulos
            FROM votos_classificados GROUP BY ALL
        ),
        d AS (
            SELECT NR_TURNO::INT AS turno, {SECTION_KEY.format(p="")}, QT_APTOS::BIGINT AS aptos,
                QT_COMPARECIMENTO::BIGINT AS comp, QT_ABSTENCOES::BIGINT AS abst,
                QT_VOTOS_NOMINAIS::BIGINT AS nominais, QT_VOTOS_BRANCOS::BIGINT AS brancos,
                QT_VOTOS_NULOS::BIGINT AS nulos, QT_VOTOS_LEGENDA::BIGINT AS legenda,
                QT_VOTOS_ANULADOS_APU_SEP::BIGINT AS anulados
            FROM detalhe_secao WHERE ST_SECAO_INSTALADA = 'Sim'
        )
        SELECT d.turno, count(*),
            count(*) FILTER (coalesce(v.nominais, 0) <> d.nominais OR coalesce(v.brancos, 0) <> d.brancos
                             OR coalesce(v.nulos, 0) <> d.nulos),
            count(*) FILTER (d.aptos <> d.comp + d.abst),
            count(*) FILTER (d.comp <> d.nominais + d.brancos + d.nulos + d.legenda + d.anulados)
        FROM d LEFT JOIN v USING (turno, mun, zona, secao)
        GROUP BY 1 ORDER BY 1
        """
    ).fetchall()
    checks = []
    for turno, n, files, apt, comp in rows:
        checks += [
            Check(
                "seção: arquivo de votos = arquivo de detalhe",
                turno,
                "ok" if files == 0 else "falha",
                n,
                files,
            ),
            Check("seção: aptos = comparecimento + abstenções", turno, "ok" if apt == 0 else "falha", n, apt),
            Check("seção: comparecimento = soma dos votos", turno, "ok" if comp == 0 else "falha", n, comp),
        ]
    return checks


def coverage(con: duckdb.DuckDBPyConnection) -> list[Check]:
    rows = con.execute(
        """
        SELECT turno, count(DISTINCT (mun, zona, secao)),
            count(DISTINCT (mun, zona, secao)) FILTER (place_id IS NULL),
            count(DISTINCT (mun, zona, secao)) FILTER (nome_local_votos <> nome_local
                                                       AND nome_local_votos = nome_local_original)
        FROM votos_classificados LEFT JOIN secao_local USING (turno, mun, zona, secao, place_id)
        GROUP BY 1 ORDER BY 1
        """
    ).fetchall()
    return [
        Check(
            "seções com local de votação cadastrado",
            t,
            "ok" if missing == 0 else "falha",
            n,
            missing,
            f"{old} seções trazem o nome antigo do local no arquivo de votos (informativo)",
        )
        for t, n, missing, old in rows
    ]


def run(con: duckdb.DuckDBPyConnection) -> list[Check]:
    checks = official_votes(con) + official_turnout(con) + internal_sections(con) + coverage(con)
    report: dict[str, Any] = {
        "ok": all(c.status != "falha" for c in checks),
        "conferencias": [asdict(c) for c in checks],
    }
    (SILVER / "conferencia.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return checks
