"""Arquivos que o site lê, em web/public/dados/. Pensados para o celular: o mínimo no primeiro acesso.

- `pontos.bin`: o mínimo para pintar o mapa (posição e 2º turno de cada local), ~450 KB com gzip.
- `camadas.bin`: o resto do que o mapa e o gráfico usam, na mesma ordem; baixado logo depois.
  Formato dos dois em `POINT_COLUMNS` e `LAYER_COLUMNS`.
- `municipios.json`: código TSE, nome, UF, se o detalhe é dividido por zona e os votos dos dois candidatos
  no 2º turno, na ordem do índice `mun`.
- `busca.json`: nome e bairro de cada local, na ordem dos .bin (carregado só ao buscar).
- `detalhe/<código TSE>.json` ou `detalhe/<código TSE>-<zona>.json` (municípios grandes): o detalhe de
  cada local (resultado, comparecimento, entorno), num array; `camadas.bin` guarda a posição (`pos`) de
  cada local nesse array.
- `exterior.json`: os locais de votação no exterior (fora do mapa).
- `meta.json`: candidatos, totais nacionais, conferências e datas dos dados.
- `brasil.json` e `mascara.json`: o mapa de fundo de longe e a máscara dos outros países (ver contorno.py).
"""

from __future__ import annotations

import gzip
import json
import shutil
import struct
from array import array
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb

from urnaporurna import contorno
from urnaporurna.config import MANIFEST, ROOT, SILVER

OUT = ROOT / "web" / "public" / "dados"

# Nome de urna como o site mostra: o TSE grava os nomes sem acento. Só para exibição; a base fica igual.
NOME_EXIBIDO = {"FLAVIO BOLSONARO": "FLÁVIO BOLSONARO"}

# Municípios com mais locais que isso têm o detalhe dividido por zona eleitoral.
SPLIT_ABOVE = 300

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

# Os .bin vão já comprimidos com gzip (servidores como o GitHub Pages não comprimem binários); o site
# descomprime no navegador. Dentro: "URN1", N (uint32), depois uma coluna de N valores por vez, nesta
# ordem, little-endian.
# Os locais vão em ordem de curva Z (vizinhos no mapa ficam vizinhos no arquivo) e as colunas de mais
# de um byte vão em planos (todos os primeiros bytes, depois todos os segundos...): comprime bem melhor.
# lon/lat: graus x 100.000, em diferença para o local anterior.
# Percentuais: uint8 em pontos inteiros (0 a 100); 255 = sem dado (nenhum voto válido naquele turno).
# O 2º colocado do 2º turno não vai: é 100 - a2. v1: número do mais votado no 1º turno (0 = sem dado).
# aptos e renda (R$): arredondados de 10 em 10, 0 = sem dado.
POINT_COLUMNS: list[tuple[str, str]] = [
    ("lon", "i"),
    ("lat", "i"),
    ("aprox", "B"),
    ("a2", "B"),
]
LAYER_COLUMNS: list[tuple[str, str]] = [
    ("mun", "H"),
    ("pos", "H"),
    ("zona", "H"),
    ("aptos", "H"),
    ("renda", "H"),
    ("v1", "B"),
    ("v1pct", "B"),
    ("a1", "B"),
    ("b1", "B"),
    ("comp1", "B"),
    ("comp2", "B"),
    ("bn1", "B"),
    ("bn2", "B"),
]
PCT_COLUMNS = {"v1pct", "a1", "a2", "b1", "comp1", "comp2", "bn1", "bn2"}
ROUND_TO_10 = {"aptos", "renda"}


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


def pct_byte(v: float | None) -> int:
    return 255 if v is None else min(100, max(0, round(v)))


def z_order(lon: float, lat: float) -> int:
    """Posição na curva Z (Morton) numa grade de ~11 m: locais próximos ficam próximos na ordem."""
    x, y = int((lon + 75) * 10_000), int((lat + 35) * 10_000)
    z = 0
    for i in range(20):
        z |= ((x >> i) & 1) << (2 * i) | ((y >> i) & 1) << (2 * i + 1)
    return z


def encode_layer(data: list[dict[str, Any]], columns: list[tuple[str, str]]) -> bytes:
    """Empacota as linhas de `map_layer` (já em ordem) nas colunas pedidas."""
    out = bytearray(b"URN1" + struct.pack("<I", len(data)))
    for name, code in columns:
        if name in ("lon", "lat"):
            prev, col = 0, array("i")
            for d in data:
                v = round(d[name] * 100_000)
                col.append(v - prev)
                prev = v
        elif name in PCT_COLUMNS:
            col = array("B", (pct_byte(d[name]) for d in data))
        elif name in ROUND_TO_10:
            col = array(code, (min(round((d[name] or 0) / 10) * 10, 65_530) for d in data))
        else:
            col = array(code, (d[name] or 0 for d in data))
        assert col.itemsize == struct.calcsize(code), name
        raw = col.tobytes()  # o array já está na ordem do processador (little-endian no x86/ARM)
        out += b"".join(raw[i :: col.itemsize] for i in range(col.itemsize))
    return bytes(out)


def map_layer(con: duckdb.DuckDBPyConnection, a: int, b: int) -> list[dict[str, Any]]:
    """Locais no mapa: com urna, com coordenada, no Brasil, em ordem de place_id."""
    return rows(
        con,
        f"""
        WITH r AS (
            SELECT place_id,
                arg_max(numero, votos) FILTER (turno = 1) AS v1,
                max(pct_validos) FILTER (turno = 1) AS v1pct,
                coalesce(max(pct_validos) FILTER (turno = 1 AND numero = {a}), 0) AS a1,
                coalesce(max(pct_validos) FILTER (turno = 2 AND numero = {a}), 0) AS a2,
                coalesce(max(pct_validos) FILTER (turno = 1 AND numero = {b}), 0) AS b1
            FROM resultados_local GROUP BY place_id
        ),
        c AS (SELECT * FROM comparecimento_local)
        SELECT l.place_id AS id, l.cd_tse, l.zona, l.lat, l.lon,
            (l.geo_precisao = 'aproximada')::INT AS aprox, coalesce(c2.aptos, c1.aptos) AS aptos,
            e.renda_media_responsavel AS renda,
            r.v1, r.v1pct,
            CASE WHEN c1.validos > 0 THEN r.a1 END AS a1, CASE WHEN c2.validos > 0 THEN r.a2 END AS a2,
            CASE WHEN c1.validos > 0 THEN r.b1 END AS b1,
            c1.pct_comparecimento AS comp1, c2.pct_comparecimento AS comp2,
            100.0 * (c1.brancos + c1.nulos) / nullif(c1.comparecimento, 0) AS bn1,
            100.0 * (c2.brancos + c2.nulos) / nullif(c2.comparecimento, 0) AS bn2
        FROM locais l
        LEFT JOIN c c1 ON c1.place_id = l.place_id AND c1.turno = 1
        LEFT JOIN c c2 ON c2.place_id = l.place_id AND c2.turno = 2
        LEFT JOIN r ON r.place_id = l.place_id
        LEFT JOIN entorno e ON e.place_id = l.place_id
        WHERE l.lat IS NOT NULL AND l.uf <> 'ZZ' AND l.secoes_principais > 0
            AND (c1.place_id IS NOT NULL OR c2.place_id IS NOT NULL)  -- alguns locais só existem num turno
        ORDER BY l.place_id
        """,
    )


def search_index(con: duckdb.DuckDBPyConnection, ids: list[str]) -> dict[str, list[str]]:
    info = {
        r["place_id"]: r
        for r in rows(
            con, "SELECT place_id, nome, bairro FROM locais WHERE place_id IN (SELECT unnest(?))", [ids]
        )
    }
    return {k: [info[i][k] or "" for i in ids] for k in ("nome", "bairro")}


def place_details(con: duckdb.DuckDBPyConnection) -> dict[str, dict[str, Any]]:
    """Detalhe de cada local com urna, agrupado por município, em ordem de place_id."""
    places = rows(
        con,
        f"""
        SELECT l.place_id, l.uf, l.cd_tse, l.municipio, l.zona, l.nome, l.tipo, l.endereco, l.bairro,
            l.secoes_principais AS secoes, l.geo_fonte, l.geo_precisao, e.metodo_entorno,
            {", ".join(f"e.{f}" for f in PROFILE_FIELDS)}
        FROM locais l LEFT JOIN entorno e USING (place_id)
        WHERE l.secoes_principais > 0
        ORDER BY l.place_id
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
        mun = by_mun.setdefault(p["cd_tse"], {"municipio": p["municipio"], "uf": p["uf"], "locais": []})
        entorno = (
            {"metodo": p["metodo_entorno"], **{f: p[f] for f in PROFILE_FIELDS}}
            if p["metodo_entorno"]
            else None
        )
        mun["locais"].append(
            {
                "id": p["place_id"],
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
        )
    return by_mun


def shard_of(mun: dict[str, Any], cd: str, zona: int) -> str:
    return f"{cd}-{zona}" if len(mun["locais"]) > SPLIT_ABOVE else cd


def shards(details: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Um arquivo por município, ou por município e zona nos grandes. Cada um com os locais em ordem."""
    out: dict[str, dict[str, Any]] = {}
    for cd, mun in details.items():
        for loc in mun["locais"]:
            key = shard_of(mun, cd, loc["zona"])
            out.setdefault(key, {"municipio": mun["municipio"], "uf": mun["uf"], "locais": []})
            out[key]["locais"].append(loc)
    return out


def income_bands(con: duckdb.DuckDBPyConnection, a: int, b: int) -> dict[str, list[dict[str, Any]]]:
    """Votos do 2º turno por faixa de renda do entorno: cinco faixas com o mesmo número de eleitores
    aptos cada, no Brasil e em cada UF. Contagens exatas (soma dos votos), não médias de percentuais."""
    sql = f"""
        WITH base AS (
            SELECT l.uf, e.renda_media_responsavel AS renda, c.aptos,
                sum(r.votos) FILTER (r.numero = {a}) AS va, sum(r.votos) FILTER (r.numero = {b}) AS vb
            FROM locais l
            JOIN entorno e USING (place_id)
            JOIN comparecimento_local c ON c.place_id = l.place_id AND c.turno = 2
            JOIN resultados_local r ON r.place_id = l.place_id AND r.turno = 2
            WHERE e.renda_media_responsavel IS NOT NULL AND l.uf <> 'ZZ'
            GROUP BY ALL
        ),
        escopo AS (SELECT 'BR' AS escopo, * FROM base UNION ALL SELECT uf, * FROM base),
        faixas AS (
            SELECT *, least(4, floor(5 * (sum(aptos) OVER (PARTITION BY escopo ORDER BY renda
                ROWS UNBOUNDED PRECEDING) - aptos) / sum(aptos) OVER (PARTITION BY escopo)))::INT AS faixa
            FROM escopo
        )
        SELECT escopo, faixa, count(*) AS locais, min(renda) AS renda_min, max(renda) AS renda_max,
            sum(aptos)::BIGINT AS aptos, coalesce(sum(va), 0)::BIGINT AS votos_a,
            coalesce(sum(vb), 0)::BIGINT AS votos_b
        FROM faixas GROUP BY ALL ORDER BY escopo, faixa
    """
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows(con, sql):
        out[r.pop("escopo")].append({k: round(v) if isinstance(v, float) else v for k, v in r.items()})
    return dict(out)


def meta(con: duckdb.DuckDBPyConnection, n_map: int) -> dict[str, Any]:
    cands = rows(
        con,
        "SELECT turno, numero, nome, partido, situacao FROM candidatos_turno"
        " WHERE valido ORDER BY turno, numero",
    )
    for c in cands:
        c["nome"] = NOME_EXIBIDO.get(c["nome"], c["nome"])
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
            count(*) FILTER (secoes_principais > 0 AND uf <> 'ZZ' AND lat IS NULL) AS locais_sem_ponto,
            sum(secoes_principais) FILTER (uf <> 'ZZ' AND lat IS NULL) AS secoes_sem_ponto
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
    details = place_details(con)
    layer = sorted(map_layer(con, a, b), key=lambda d: z_order(d["lon"], d["lat"]))

    # Índice dos municípios (os do Brasil, em ordem de código) e a posição de cada local no seu arquivo.
    brasil = sorted(cd for cd, m in details.items() if m["uf"] != "ZZ")
    mun_index = {cd: i for i, cd in enumerate(brasil)}
    position = {loc["id"]: i for shard in shards(details).values() for i, loc in enumerate(shard["locais"])}
    for d in layer:
        d["mun"] = mun_index[d["cd_tse"]]
        d["pos"] = position[d["id"]]

    OUT.mkdir(parents=True)
    sizes: dict[str, int] = {}
    for name, columns in (("pontos.bin", POINT_COLUMNS), ("camadas.bin", LAYER_COLUMNS)):
        blob = gzip.compress(encode_layer(layer, columns), compresslevel=9, mtime=0)
        (OUT / name).write_bytes(blob)
        sizes[name] = len(blob)
    runoff = {
        cd: (va, vb)
        for cd, va, vb in con.execute(
            f"""
            SELECT l.cd_tse, coalesce(sum(r.votos) FILTER (r.numero = {a}), 0)::BIGINT,
                coalesce(sum(r.votos) FILTER (r.numero = {b}), 0)::BIGINT
            FROM resultados_local r JOIN locais l USING (place_id) WHERE r.turno = 2 GROUP BY 1
            """
        ).fetchall()
    }
    sizes["municipios.json"] = dump(
        OUT / "municipios.json",
        [
            [
                cd,
                details[cd]["municipio"],
                details[cd]["uf"],
                int(len(details[cd]["locais"]) > SPLIT_ABOVE),
                *runoff.get(cd, (0, 0)),
            ]
            for cd in brasil
        ],
    )
    sizes["busca.json"] = dump(OUT / "busca.json", search_index(con, [d["id"] for d in layer]))
    abroad = {cd: m for cd, m in details.items() if m["uf"] == "ZZ"}
    sizes["exterior.json"] = dump(OUT / "exterior.json", abroad)
    sizes["detalhe/*.json"] = sum(
        dump(OUT / "detalhe" / f"{key}.json", s) for key, s in shards(details).items() if s["uf"] != "ZZ"
    )
    sizes.update(contorno.run(OUT))
    sizes["meta.json"] = dump(
        OUT / "meta.json",
        {**meta(con, len(layer)), "segundo_turno": [a, b], "faixas_renda": income_bands(con, a, b)},
    )
    return sizes
