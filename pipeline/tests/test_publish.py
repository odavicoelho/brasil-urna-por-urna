"""Formato binário que o site lê (pontos.bin e camadas.bin) e as faixas de renda.

O teste decodifica o binário do mesmo jeito que web/src/data.ts: cabeçalho, colunas em planos de bytes,
coordenadas em diferenças. Se um lado mudar sem o outro, quebra aqui.
"""

from __future__ import annotations

import gzip
import struct

import duckdb

from urnaporurna import publish

LINHAS = [
    {"lon": -42.53123, "lat": -22.28456, "aprox": 0, "a2": 61.4, "mun": 3, "aptos": 1234.0, "renda": 2537.4},
    {"lon": -42.53001, "lat": -22.28010, "aprox": 1, "a2": None, "mun": 3, "aptos": 17560.0, "renda": None},
    {"lon": -43.20999, "lat": -22.90001, "aprox": 0, "a2": 100.0, "mun": 700, "aptos": 8.0, "renda": 70000.0},
]


def decode(blob: bytes, columns: list[tuple[str, str]]) -> dict[str, list[int]]:
    """Espelho de readColumns (web/src/data.ts)."""
    assert blob[:4] == b"URN1"
    (n,) = struct.unpack("<I", blob[4:8])
    off, out = 8, {}
    for name, code in columns:
        size = struct.calcsize(code)
        planes = [blob[off + k * n : off + (k + 1) * n] for k in range(size)]
        raw = bytes(planes[k][i] for i in range(n) for k in range(size))
        out[name] = list(struct.unpack(f"<{n}{code}", raw))
        off += n * size
    assert off == len(blob)
    return out


def test_pontos_ida_e_volta() -> None:
    cols = decode(publish.encode_layer(LINHAS, publish.POINT_COLUMNS), publish.POINT_COLUMNS)
    lon, lat, x, y = [], [], 0, 0
    for dx, dy in zip(cols["lon"], cols["lat"], strict=True):
        x, y = x + dx, y + dy
        lon.append(x / 100_000)
        lat.append(y / 100_000)
    assert lon == [r["lon"] for r in LINHAS]
    assert lat == [r["lat"] for r in LINHAS]
    assert cols["aprox"] == [0, 1, 0]
    assert cols["a2"] == [61, 255, 100]  # sem dado = 255


def test_camadas_arredonda_e_limita() -> None:
    cols = decode(publish.encode_layer(LINHAS, [("mun", "H"), ("aptos", "H"), ("renda", "H")]),
                  [("mun", "H"), ("aptos", "H"), ("renda", "H")])  # fmt: skip
    assert cols["mun"] == [3, 3, 700]
    assert cols["aptos"] == [1230, 17560, 10]
    assert cols["renda"] == [2540, 0, 65530]  # sem dado = 0; acima do limite do uint16 fica no teto


def test_pct_byte() -> None:
    # meio para cima: 49,5 vira 50 e 50,5 vira 51 (o round do Python daria 50 nos dois)
    assert [publish.pct_byte(v) for v in (None, -1, 0, 49.5, 50.5, 100, 130)] == [255, 0, 0, 50, 51, 100, 100]


def test_curva_z_aproxima_vizinhos() -> None:
    perto = abs(publish.z_order(-42.5300, -22.2800) - publish.z_order(-42.5301, -22.2801))
    longe = abs(publish.z_order(-42.5300, -22.2800) - publish.z_order(-60.0, -3.0))
    assert perto < longe


def test_arquivo_vai_comprimido() -> None:
    blob = gzip.compress(publish.encode_layer(LINHAS, publish.POINT_COLUMNS), compresslevel=9, mtime=0)
    assert blob[:2] == b"\x1f\x8b"  # o site testa estes dois bytes antes de descomprimir


def test_faixas_de_renda_somam_votos_exatos() -> None:
    con = duckdb.connect()
    # 10 locais, 100 aptos cada, renda crescente; A ganha nos pobres, B nos ricos.
    con.execute("""
        CREATE TABLE locais AS SELECT 'p' || i AS place_id, CASE WHEN i < 5 THEN 'RJ' ELSE 'SP' END AS uf
        FROM range(10) t(i)""")
    con.execute(
        "CREATE TABLE entorno AS SELECT 'p' || i AS place_id, 1000.0 + 500 * i AS renda_media_responsavel FROM range(10) t(i)"
    )
    con.execute(
        "CREATE TABLE comparecimento_local AS SELECT 'p' || i AS place_id, 2 AS turno, 100 AS aptos FROM range(10) t(i)"
    )
    con.execute("""
        CREATE TABLE resultados_local AS
        SELECT 'p' || i AS place_id, 2 AS turno, 13 AS numero, 90 - 8 * i AS votos FROM range(10) t(i)
        UNION ALL SELECT 'p' || i, 2, 22, 10 + 8 * i FROM range(10) t(i)""")
    faixas = publish.income_bands(con, 13, 22)
    br = faixas["BR"]
    assert [f["locais"] for f in br] == [2, 2, 2, 2, 2]  # cinco faixas com o mesmo eleitorado
    assert br[0]["votos_a"] == 90 + 82 and br[0]["votos_b"] == 10 + 18
    assert sum(f["votos_a"] + f["votos_b"] for f in br) == 10 * 100
    assert br[0]["renda_min"] == 1000 and br[4]["renda_max"] == 5500
    assert sorted(faixas) == ["BR", "RJ", "SP"]
    assert [f["locais"] for f in faixas["RJ"]] == [1, 1, 1, 1, 1]
