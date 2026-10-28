"""Descobertas: os achados que o site mostra em cartões (meta.json, campo `descobertas`).

Tudo calculado aqui a cada publicação, nada digitado à mão. Faixas são quintis do eleitorado (cada uma com
o mesmo número de eleitores aptos), e os percentuais são somas exatas de votos, não médias de locais.
A = candidato de menor número no 2º turno, B = o outro. Tudo é sobre lugares, não sobre pessoas.
"""

from __future__ import annotations

from typing import Any

import duckdb

# Capitais grandes comparadas em "renda dentro da cidade" (nome do município no TSE, UF).
CAPITAIS = [
    ("SÃO PAULO", "SP"),
    ("RIO DE JANEIRO", "RJ"),
    ("BELO HORIZONTE", "MG"),
    ("SALVADOR", "BA"),
    ("FORTALEZA", "CE"),
    ("RECIFE", "PE"),
    ("BRASÍLIA", "DF"),
    ("CURITIBA", "PR"),
    ("PORTO ALEGRE", "RS"),
    ("MANAUS", "AM"),
    ("BELÉM", "PA"),
    ("GOIÂNIA", "GO"),
]
# Candidatos de direita do 1º turno além de B (números de urna de 2026).
DIREITA_1T = (30, 55, 14)  # Zema, Caiado, Renan Santos
MIN_LOCAIS_CIDADE = 100  # "cidades partidas": só cidades com muitos locais
MIN_VOTOS_LOCAL = 100  # extremos de uma cidade: só locais com votos suficientes


def rows(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict[str, Any]]:
    cur = con.execute(sql)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r, strict=True)) for r in cur.fetchall()]


def pct(a: float, b: float) -> float:
    return round(100 * a / b, 1) if b else 0.0


def criar_base(con: duckdb.DuckDBPyConnection, a: int, b: int) -> None:
    direita = ", ".join(str(n) for n in DIREITA_1T)
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE desc_base AS
        WITH v AS (
            SELECT place_id,
                coalesce(sum(votos) FILTER (turno = 1 AND numero = {a}), 0) AS a1,
                coalesce(sum(votos) FILTER (turno = 1 AND numero = {b}), 0) AS b1,
                coalesce(sum(votos) FILTER (turno = 1), 0) AS t1,
                coalesce(sum(votos) FILTER (turno = 1 AND numero IN ({direita})), 0) AS dir1,
                coalesce(sum(votos) FILTER (turno = 2 AND numero = {a}), 0) AS a2,
                coalesce(sum(votos) FILTER (turno = 2 AND numero = {b}), 0) AS b2
            FROM resultados_local GROUP BY 1
        )
        SELECT v.*, l.uf, l.cd_tse, l.municipio, l.nome, l.lat IS NOT NULL AS no_mapa,
            c2.aptos, c1.comparecimento AS comp1, c2.comparecimento AS comp2,
            e.renda_media_responsavel AS renda, e.pct_alfabetizados_15_mais AS alf,
            e.pct_60_anos_ou_mais AS idosos, e.pct_preta + e.pct_parda AS pretos_pardos
        FROM v JOIN locais l USING (place_id)
        JOIN comparecimento_local c1 ON c1.place_id = v.place_id AND c1.turno = 1
        JOIN comparecimento_local c2 ON c2.place_id = v.place_id AND c2.turno = 2
        LEFT JOIN entorno e ON e.place_id = v.place_id
        WHERE l.secoes_principais > 0
        """
    )


def quintis(
    con: duckdb.DuckDBPyConnection, x: str, onde: str = "true", grupo: str = "'BR'"
) -> list[dict[str, Any]]:
    """Cinco faixas com o mesmo eleitorado, ordenadas por `x`, com os votos somados de cada uma."""
    return rows(
        con,
        f"""
        WITH f AS (
            SELECT *, {grupo} AS g, least(4, floor(5 * (sum(aptos) OVER (PARTITION BY {grupo} ORDER BY {x}
                ROWS UNBOUNDED PRECEDING) - aptos) / sum(aptos) OVER (PARTITION BY {grupo})))::INT AS faixa
            FROM desc_base WHERE {x} IS NOT NULL AND uf <> 'ZZ' AND {onde}
        )
        SELECT g, faixa, min({x}) AS x_min, max({x}) AS x_max, sum(a1) a1, sum(b1) b1, sum(t1) t1,
            sum(a2) a2, sum(b2) b2
        FROM f GROUP BY ALL ORDER BY g, faixa
        """,
    )


def virada(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    n = rows(
        con,
        """
        WITH m AS (
            SELECT *, (a2 - b2) / (a2 + b2) - (a1 - b1) / t1 AS dm FROM desc_base
            WHERE uf <> 'ZZ' AND t1 > 0 AND a2 + b2 > 0
        )
        SELECT sum(a1) a1, sum(b1) b1, sum(t1) t1, sum(a2) a2, sum(b2) b2, count(*) locais,
            count(*) FILTER (dm > 0) locais_a, sum(aptos) aptos, sum(aptos) FILTER (dm > 0) aptos_a,
            count(*) FILTER (b2 < b1) locais_b_perdeu
        FROM m
        """,
    )[0]
    ufs = rows(
        con,
        """
        SELECT uf, 100 * (sum(a1) - sum(b1)) / sum(t1) AS m1, 100 * (sum(a2) - sum(b2)) / sum(a2 + b2) AS m2
        FROM desc_base WHERE uf <> 'ZZ' AND t1 > 0 GROUP BY 1 ORDER BY 3 DESC
        """,
    )
    return {
        "turno1": {
            "a": pct(n["a1"], n["t1"]),
            "b": pct(n["b1"], n["t1"]),
            "outros": pct(n["t1"] - n["a1"] - n["b1"], n["t1"]),
        },
        "turno2": {"a": pct(n["a2"], n["a2"] + n["b2"]), "b": pct(n["b2"], n["a2"] + n["b2"])},
        "pct_locais": pct(n["locais_a"], n["locais"]),
        "pct_eleitores": pct(n["aptos_a"], n["aptos"]),
        "locais_b_perdeu_votos": n["locais_b_perdeu"],
        "ufs": [{"uf": u["uf"], "m1": round(u["m1"], 1), "m2": round(u["m2"], 1)} for u in ufs],
        "ufs_para_a": sum(1 for u in ufs if u["m2"] > u["m1"]),
        "total_ufs": len(ufs),
    }


# Perfil do entorno: (campo, rótulo, ponta de baixo, ponta de cima)
PERFIS = [
    ("renda", "Renda", "mais pobres", "mais ricos"),
    ("alf", "Alfabetização", "menos alfabetizados", "mais alfabetizados"),
    ("pretos_pardos", "Pretos e pardos", "menos moradores", "mais moradores"),
    ("idosos", "60 anos ou mais", "menos moradores", "mais moradores"),
]


def entorno(con: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    """Votos de A no 2º turno nos 20% do eleitorado com a menor e a maior medida de cada perfil."""
    out = []
    for campo, rotulo, baixo, alto in PERFIS:
        q = quintis(con, campo)
        out.append(
            {
                "id": campo,
                "rotulo": rotulo,
                "baixo": baixo,
                "alto": alto,
                "serie": [pct(f["a2"], f["a2"] + f["b2"]) for f in q],
            }
        )
    return out


def capitais(con: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    nomes = " OR ".join(f"(municipio = '{m}' AND uf = '{u}')" for m, u in CAPITAIS)
    q = quintis(con, "renda", onde=f"({nomes})", grupo="cd_tse")
    info = {
        r["cd_tse"]: r
        for r in rows(con, f"SELECT DISTINCT cd_tse, municipio, uf FROM desc_base WHERE {nomes}")
    }
    total = {
        r["cd_tse"]: pct(r["a2"], r["a2"] + r["b2"])
        for r in rows(con, f"SELECT cd_tse, sum(a2) a2, sum(b2) b2 FROM desc_base WHERE {nomes} GROUP BY 1")
    }
    out = []
    for cd in info:
        f = [x for x in q if x["g"] == cd]
        out.append(
            {
                "cd": cd,
                "municipio": info[cd]["municipio"],
                "uf": info[cd]["uf"],
                "a_mais_pobres": pct(f[0]["a2"], f[0]["a2"] + f[0]["b2"]),
                "a_mais_ricos": pct(f[-1]["a2"], f[-1]["a2"] + f[-1]["b2"]),
                "a_cidade": total[cd],
            }
        )
    return sorted(out, key=lambda c: c["a_mais_ricos"] - c["a_mais_pobres"], reverse=True)


def cidades_partidas(con: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    cidades = rows(
        con,
        f"""
        WITH p AS (SELECT *, 100.0 * a2 / (a2 + b2) AS pa FROM desc_base
                   WHERE uf <> 'ZZ' AND a2 + b2 >= {MIN_VOTOS_LOCAL} AND no_mapa)
        SELECT cd_tse AS cd, any_value(municipio) municipio, any_value(uf) uf, count(*) locais,
            stddev(pa) desvio, min(pa) pa_min, max(pa) pa_max,
            arg_min(nome, pa) nome_min, arg_max(nome, pa) nome_max,
            arg_min(place_id, pa) id_min, arg_max(place_id, pa) id_max
        FROM p GROUP BY 1 HAVING count(*) >= {MIN_LOCAIS_CIDADE} ORDER BY desvio DESC LIMIT 5
        """,
    )
    return [{k: round(v, 1) if isinstance(v, float) else v for k, v in c.items()} for c in cidades]


def direita(con: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    q = quintis(con, "dir1 / t1", onde="t1 > 0")
    return [
        {
            "dir_min": round(100 * f["x_min"], 1),
            "dir_max": round(100 * f["x_max"], 1),
            "b_do_crescimento": pct(f["b2"] - f["b1"], (f["a2"] - f["a1"]) + (f["b2"] - f["b1"])),
        }
        for f in q
    ]


def curiosidades(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    maior = rows(
        con,
        """
        SELECT place_id AS id, nome, municipio, uf, aptos, 100.0 * a2 / (a2 + b2) AS pa
        FROM desc_base WHERE uf <> 'ZZ' AND no_mapa ORDER BY aptos DESC LIMIT 1
        """,
    )[0]
    ext = rows(
        con,
        "SELECT sum(aptos) aptos, sum(comp2) comp, sum(a2) a2, sum(b2) b2 FROM desc_base WHERE uf = 'ZZ'",
    )[0]
    unanimes = rows(
        con,
        """
        SELECT count(*) FILTER (b2 = 0 AND a2 >= 50) so_a, count(*) FILTER (a2 = 0 AND b2 >= 50) so_b,
            count(*) FILTER (a2 = b2 AND a2 > 0) empates
        FROM desc_base WHERE uf <> 'ZZ'
        """,
    )[0]
    return {
        "maior_local": {**maior, "pa": round(maior["pa"], 1), "aptos": int(maior["aptos"])},
        "exterior": {
            "comparecimento": pct(ext["comp"], ext["aptos"]),
            "a": pct(ext["a2"], ext["a2"] + ext["b2"]),
        },
        "locais_so_a": unanimes["so_a"],
        "locais_so_b": unanimes["so_b"],
        "empates": unanimes["empates"],
    }


def run(con: duckdb.DuckDBPyConnection, a: int, b: int) -> dict[str, Any]:
    criar_base(con, a, b)
    return {
        "virada": virada(con),
        "entorno": entorno(con),
        "capitais": capitais(con),
        "cidades_partidas": cidades_partidas(con),
        "direita": direita(con),
        "curiosidades": curiosidades(con),
    }
