"""Arquivos que o site lê, em web/public/dados/.

- `locais.json`: os locais no mapa, em colunas (um array por campo), só com o que pinta o mapa.
- `busca.json`: nome, bairro, município e UF de cada local, na mesma ordem (carregado só ao buscar).
- `municipios/<código TSE>.json`: o detalhe de cada local (resultado, comparecimento, entorno),
  carregado só quando alguém clica num local daquele município.
- `exterior.json`: os locais de votação no exterior (fora do mapa).
- `meta.json`: candidatos, totais nacionais, conferências e datas dos dados.
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb

from urnaporurna.config import MANIFEST, ROOT, SILVER

OUT = ROOT / "web" / "public" / "dados"

PROFILE_FIELDS = [
    "populacao_estimada",
    "renda_media_responsavel",
    "pct_alfabetizados_15_mais",
    "pct_15_a_29_anos",
    "pct_30_a_59_anos",
    "pct_60_anos_ou_mais",
    "pct_branca",
    "pct_preta",
    "pct_parda",
    "pct_amarela",
    "pct_indigena",
]


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    for table in ("locais", "resultados_local", "comparecimento_local", "candidatos_turno", "entorno"):
        con.execute(f"CREATE VIEW {table} AS SELECT * FROM '{SILVER / f'{table}.parquet'}'")
    return con


def dump(path: Path, data: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return len(text.encode())


def rows(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    cur = con.execute(sql, params or [])
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r, strict=True)) for r in cur.fetchall()]


def runoff_pair(con: duckdb.DuckDBPyConnection) -> tuple[int, int]:
    nums = [
        r[0] for r in con.execute("SELECT numero FROM candidatos_turno WHERE turno = 2 ORDER BY 1").fetchall()
    ]
    assert len(nums) == 2, nums
    return nums[0], nums[1]


def map_layer(con: duckdb.DuckDBPyConnection, a: int, b: int) -> dict[str, list[Any]]:
    """Locais no mapa: com urna, com coordenada, no Brasil. Uma coluna por campo."""
    data = rows(
        con,
        f"""
        WITH r AS (
            SELECT place_id,
                arg_max(numero, votos) FILTER (turno = 1) AS v1,
                max(pct_validos) FILTER (turno = 1) AS v1pct,
                coalesce(max(pct_validos) FILTER (turno = 1 AND numero = {a}), 0) AS a1,
                coalesce(max(pct_validos) FILTER (turno = 2 AND numero = {a}), 0) AS a2,
                coalesce(max(pct_validos) FILTER (turno = 1 AND numero = {b}), 0) AS b1,
                coalesce(max(pct_validos) FILTER (turno = 2 AND numero = {b}), 0) AS b2
            FROM resultados_local GROUP BY place_id
        ),
        c AS (SELECT * FROM comparecimento_local)
        SELECT l.place_id AS id, round(l.lat, 5) AS lat, round(l.lon, 5) AS lon, l.cd_tse AS mun,
            (l.geo_precisao = 'aproximada')::INT AS aprox, coalesce(c2.aptos, c1.aptos) AS aptos,
            r.v1, r.v1pct, r.a1, r.a2, r.b1, r.b2,
            c1.pct_comparecimento AS comp1, c2.pct_comparecimento AS comp2,
            round(100.0 * (c1.brancos + c1.nulos) / nullif(c1.comparecimento, 0), 2) AS bn1,
            round(100.0 * (c2.brancos + c2.nulos) / nullif(c2.comparecimento, 0), 2) AS bn2
        FROM locais l
        LEFT JOIN c c1 ON c1.place_id = l.place_id AND c1.turno = 1
        LEFT JOIN c c2 ON c2.place_id = l.place_id AND c2.turno = 2
        LEFT JOIN r ON r.place_id = l.place_id
        WHERE l.lat IS NOT NULL AND l.uf <> 'ZZ' AND l.secoes_principais > 0
            AND (c1.place_id IS NOT NULL OR c2.place_id IS NOT NULL)  -- alguns locais só existem num turno
        ORDER BY l.place_id
        """,
    )
    cols: dict[str, list[Any]] = {k: [] for k in data[0]}
    for d in data:
        for k, v in d.items():
            cols[k].append(v)
    return cols


def search_index(con: duckdb.DuckDBPyConnection, ids: list[str]) -> dict[str, list[str]]:
    info = {
        r["place_id"]: r
        for r in rows(
            con,
            "SELECT place_id, nome, bairro, municipio, uf FROM locais WHERE place_id IN (SELECT unnest(?))",
            [ids],
        )
    }
    return {k: [info[i][k] or "" for i in ids] for k in ("nome", "bairro", "municipio", "uf")}


def place_details(con: duckdb.DuckDBPyConnection) -> dict[str, dict[str, Any]]:
    """Detalhe de cada local com urna, agrupado por município."""
    places = rows(
        con,
        f"""
        SELECT l.place_id, l.uf, l.cd_tse, l.municipio, l.zona, l.nome, l.tipo, l.endereco, l.bairro,
            l.secoes_principais AS secoes, l.geo_fonte, l.geo_precisao, e.metodo_entorno,
            {", ".join(f"e.{f}" for f in PROFILE_FIELDS)}
        FROM locais l LEFT JOIN entorno e USING (place_id)
        WHERE l.secoes_principais > 0
        """,
    )
    turnout: dict[str, dict[int, dict[str, Any]]] = defaultdict(dict)
    for r in rows(
        con,
        "SELECT place_id, turno, aptos, comparecimento, abstencoes, validos, brancos, nulos"
        " FROM comparecimento_local",
    ):
        turnout[r.pop("place_id")][r.pop("turno")] = r
    for r in rows(con, "SELECT place_id, turno, numero, votos FROM resultados_local"):
        turnout[r["place_id"]][r["turno"]].setdefault("votos", {})[str(r["numero"])] = r["votos"]

    by_mun: dict[str, dict[str, Any]] = {}
    for p in places:
        mun = by_mun.setdefault(p["cd_tse"], {"municipio": p["municipio"], "uf": p["uf"], "locais": {}})
        entorno = (
            {"metodo": p["metodo_entorno"], **{f: p[f] for f in PROFILE_FIELDS}}
            if p["metodo_entorno"]
            else None
        )
        mun["locais"][p["place_id"]] = {
            "nome": p["nome"],
            "tipo": p["tipo"],
            "endereco": p["endereco"],
            "bairro": p["bairro"],
            "zona": p["zona"],
            "secoes": p["secoes"],
            "localizacao": p["geo_fonte"],
            "precisao": p["geo_precisao"],
            "turnos": {str(t): v for t, v in sorted(turnout.get(p["place_id"], {}).items())},
            "entorno": entorno,
        }
    return by_mun


def meta(con: duckdb.DuckDBPyConnection, n_map: int) -> dict[str, Any]:
    cands = rows(
        con,
        "SELECT turno, numero, nome, partido, situacao FROM candidatos_turno"
        " WHERE valido ORDER BY turno, numero",
    )
    totals = rows(
        con,
        """
        SELECT turno, sum(aptos)::BIGINT AS aptos, sum(comparecimento)::BIGINT AS comparecimento,
            sum(abstencoes)::BIGINT AS abstencoes, sum(validos)::BIGINT AS validos,
            sum(brancos)::BIGINT AS brancos, sum(nulos)::BIGINT AS nulos
        FROM comparecimento_local GROUP BY turno ORDER BY turno
        """,
    )
    votes = rows(
        con,
        "SELECT turno, numero, sum(votos)::BIGINT AS votos FROM resultados_local"
        " GROUP BY ALL ORDER BY 1, 3 DESC",
    )
    for t in totals:
        t["votos"] = {str(v["numero"]): v["votos"] for v in votes if v["turno"] == t["turno"]}
    counts = rows(
        con,
        """
        SELECT count(*) FILTER (secoes_principais > 0) AS locais_com_urna,
            count(*) FILTER (secoes_principais > 0 AND uf = 'ZZ') AS locais_exterior,
            count(*) FILTER (secoes_principais > 0 AND uf <> 'ZZ' AND lat IS NULL) AS locais_sem_ponto
        FROM locais
        """,
    )[0]
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    conferencia = json.loads((SILVER / "conferencia.json").read_text())
    return {
        "eleicao": "Eleição presidencial 2026",
        "gerado_em": datetime.now(UTC).isoformat(timespec="seconds"),
        "candidatos": cands,
        "totais": totals,
        "locais": {**counts, "locais_no_mapa": n_map},
        "conferencia": conferencia,
        "fontes": {k: {"url": v["url"], "atualizado_em": v["last_modified"]} for k, v in manifest.items()},
    }


def run() -> dict[str, int]:
    con = connect()
    a, b = runoff_pair(con)
    if OUT.exists():
        shutil.rmtree(OUT)
    layer = map_layer(con, a, b)
    sizes = {"locais.json": dump(OUT / "locais.json", layer)}
    sizes["busca.json"] = dump(OUT / "busca.json", search_index(con, layer["id"]))
    details = place_details(con)
    abroad = {cd: m for cd, m in details.items() if m["uf"] == "ZZ"}
    sizes["exterior.json"] = dump(OUT / "exterior.json", abroad)
    sizes["municipios/*.json"] = sum(
        dump(OUT / "municipios" / f"{cd}.json", m) for cd, m in details.items() if m["uf"] != "ZZ"
    )
    sizes["meta.json"] = dump(OUT / "meta.json", {**meta(con, len(layer["id"])), "segundo_turno": [a, b]})
    return sizes
