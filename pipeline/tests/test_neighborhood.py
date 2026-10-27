"""Perfil do entorno com setores de mentira, desenhados em metros em volta dos locais.

Local P: o círculo de 500 m fica metade no setor A (urbano, 1.000 pessoas brancas) e metade no B
(urbano, 3.000 pessoas pardas), cada um com 2 km². Local Q: dentro de um setor rural de 100 km².
"""

from __future__ import annotations

import math
from pathlib import Path

import duckdb
import pytest

from urnaporurna import neighborhood

P = ("P", -22.5, -43.5)
Q = ("Q", -10.0, -50.0)

CENSUS_COLS = [c for cols in neighborhood.VARIABLES.values() for c in cols]


@pytest.fixture
def con(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> duckdb.DuckDBPyConnection:
    monkeypatch.setattr(neighborhood, "SILVER", tmp_path)
    c = neighborhood.connect()
    c.execute("CREATE TABLE l (place_id VARCHAR, lat DOUBLE, lon DOUBLE, secoes_principais INT)")
    c.executemany("INSERT INTO l VALUES (?, ?, ?, 1)", [P, Q])
    c.execute(f"COPY l TO '{tmp_path / 'locais.parquet'}' (FORMAT parquet)")

    # Setores em metros, desenhados a partir do ponto projetado de cada local.
    pt = neighborhood.to_metric("ST_Point(lon, lat)")
    c.execute(
        f"""
        CREATE TABLE setores AS
        WITH p AS (SELECT place_id, ST_X({pt}) AS x, ST_Y({pt}) AS y FROM l)
        SELECT 'A' AS cd_setor, ST_MakeEnvelope(x - 1000, y - 1000, x, y + 1000) AS geom FROM p WHERE place_id = 'P'
        UNION ALL
        SELECT 'B', ST_MakeEnvelope(x, y - 1000, x + 1000, y + 1000) FROM p WHERE place_id = 'P'
        UNION ALL
        SELECT 'C', ST_MakeEnvelope(x - 5000, y - 5000, x + 5000, y + 5000) FROM p WHERE place_id = 'Q'
        """
    )
    c.execute("ALTER TABLE setores ADD COLUMN area_m2 DOUBLE")
    c.execute("UPDATE setores SET area_m2 = ST_Area(geom)")

    cols = ", ".join(f"{col} DOUBLE" for col in CENSUS_COLS)
    c.execute(f"CREATE TABLE censo (cd_setor VARCHAR, situacao VARCHAR, {cols})")
    rows = {
        "A": ("Urbana", 1000, {"V01317": 1000}),
        "B": ("Urbana", 3000, {"V01320": 3000}),
        "C": ("Rural", 800, {"V01321": 800}),
    }
    for cd, (sit, pop, race) in rows.items():
        values = {col: 0.0 for col in CENSUS_COLS} | {"V0001": pop, "V01006": pop, **race}
        values |= {
            "V00900": pop * 0.9,
            "V00901": pop * 0.1,
            "V06001": pop / 4,
            "V06004": 2000 if cd == "A" else 1000,
        }
        c.execute(
            f"INSERT INTO censo VALUES (?, ?, {', '.join('?' * len(CENSUS_COLS))})",
            [cd, sit, *(values[col] for col in CENSUS_COLS)],
        )
    neighborhood.build_weights(c)
    neighborhood.build_profile(c)
    return c


def profile(con: duckdb.DuckDBPyConnection, place: str) -> dict[str, object]:
    cur = con.execute("SELECT * FROM entorno WHERE place_id = ?", [place])
    names = [d[0] for d in cur.description]
    row = cur.fetchone()
    assert row is not None
    return dict(zip(names, row, strict=True))


def test_circle_split_between_two_tracts(con: duckdb.DuckDBPyConnection) -> None:
    p = profile(con, "P")
    assert p["metodo_entorno"] == "raio_500m"
    assert p["setores"] == 2
    half_circle_share = (math.pi * 500**2 / 2) / 2_000_000  # cada setor tem metade do círculo
    assert p["populacao_estimada"] == pytest.approx(4000 * half_circle_share, rel=0.01)
    assert p["pct_branca"] == pytest.approx(25.0, abs=0.1)  # 1.000 brancas contra 3.000 pardas, mesmo peso
    assert p["pct_parda"] == pytest.approx(75.0, abs=0.1)
    assert p["pct_alfabetizados_15_mais"] == pytest.approx(90.0)


def test_income_weighted_by_household_heads(con: duckdb.DuckDBPyConnection) -> None:
    # A: 250 responsáveis com R$ 2.000; B: 750 com R$ 1.000 -> (250*2000 + 750*1000) / 1000
    assert profile(con, "P")["renda_media_responsavel"] == pytest.approx(1250.0)


def test_large_rural_tract_is_used_whole(con: duckdb.DuckDBPyConnection) -> None:
    q = profile(con, "Q")
    assert q["metodo_entorno"] == "setor_rural"
    assert q["populacao_estimada"] == 800
    assert q["pct_indigena"] == 100.0


def test_confidential_income_leaves_the_average(con: duckdb.DuckDBPyConnection) -> None:
    # Renda sigilosa ("X") no setor B: a média fica só com o A, sem puxar para zero.
    con.execute("UPDATE censo SET V06004 = NULL WHERE cd_setor = 'B'")
    neighborhood.build_profile(con)
    assert profile(con, "P")["renda_media_responsavel"] == pytest.approx(2000.0)
