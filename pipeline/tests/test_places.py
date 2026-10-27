"""Selos de coordenada e correspondência de municípios, com dois municípios quadrados de mentira."""

from __future__ import annotations

import duckdb
import pytest

from urnaporurna import places

# Município A: quadrado lon -44..-43, lat -23..-22. Município B: logo a leste, lon -43..-42.
MUNICIPIOS = [
    ("3300001", "Cidade Alfa", "RJ", "POLYGON((-44 -23, -43 -23, -43 -22, -44 -22, -44 -23))"),
    ("3300002", "Cidade Beta", "RJ", "POLYGON((-43 -23, -42 -23, -42 -22, -43 -22, -43 -23))"),
]

# (município TSE, nome TSE, zona, local, seção, lat, lon, eleitores)
SECOES = [
    ("10001", "CIDADE ALFA", "1", "100", "1", "-22,5", "-43,5", "300"),  # ok
    ("10001", "CIDADE ALFA", "1", "100", "2", "-22,5", "-43,5", "200"),  # mesma escola, outra seção
    ("10001", "CIDADE ALFA", "1", "101", "3", "-1", "-1", "250"),  # sem coordenada
    ("10001", "CIDADE ALFA", "1", "102", "4", "-22,5", "-42,995", "100"),  # ~0,5 km depois da divisa
    ("10001", "CIDADE ALFA", "1", "103", "5", "-22,5", "-42,5", "100"),  # bem dentro de Beta
    ("10002", "CIDADE BETA", "2", "200", "6", "-22,2", "-42,2", "100"),  # 4 locais no mesmo ponto
    ("10002", "CIDADE BETA", "2", "201", "7", "-22,2", "-42,2", "100"),
    ("10002", "CIDADE BETA", "2", "202", "8", "-22,2", "-42,2", "100"),
    ("10002", "CIDADE BETA", "2", "203", "9", "-22,2", "-42,2", "100"),
    ("10002", "CIDADE BETA", "2", "204", "10", "-22,6", "-42,6", "100"),  # ok
]


@pytest.fixture
def con() -> duckdb.DuckDBPyConnection:
    c = places.connect()
    c.execute("CREATE TABLE mun_ibge (cd_ibge VARCHAR, nm_ibge VARCHAR, uf VARCHAR, geom GEOMETRY)")
    for cd, nm, uf, wkt in MUNICIPIOS:
        c.execute("INSERT INTO mun_ibge VALUES (?, ?, ?, ST_GeomFromText(?))", [cd, nm, uf, wkt])
    c.execute(
        """
        CREATE TABLE locais_raw (NR_TURNO VARCHAR, SG_UF VARCHAR, CD_MUNICIPIO VARCHAR, NM_MUNICIPIO VARCHAR,
            NR_ZONA VARCHAR, NR_LOCAL_VOTACAO VARCHAR, NR_SECAO VARCHAR, NR_LATITUDE VARCHAR,
            NR_LONGITUDE VARCHAR, QT_ELEITOR_SECAO VARCHAR, NM_LOCAL_VOTACAO VARCHAR, DS_TIPO_LOCAL VARCHAR,
            DS_ENDERECO VARCHAR, NM_BAIRRO VARCHAR, NR_CEP VARCHAR)
        """
    )
    for mun, nome, zona, local, secao, lat, lon, n in SECOES:
        for turno in ("1", "2"):
            c.execute(
                "INSERT INTO locais_raw VALUES"
                " (?, 'RJ', ?, ?, ?, ?, ?, ?, ?, ?, 'ESCOLA', 'Escola', 'RUA', 'CENTRO', '')",
                [turno, mun, nome, zona, local, secao, lat, lon, n],
            )
    places.build_places(c)
    places.flag_places(c)
    return c


def status(con: duckdb.DuckDBPyConnection) -> dict[str, str]:
    return dict(con.execute("SELECT place_id, geo_status FROM places_flagged").fetchall())


def test_sections_become_one_place_per_school(con: duckdb.DuckDBPyConnection) -> None:
    row = con.execute("SELECT secoes, eleitores FROM places WHERE place_id = '10001-1-100'").fetchone()
    assert row == (2, 500)  # só o 1º turno conta, sem duplicar


def test_geo_status(con: duckdb.DuckDBPyConnection) -> None:
    s = status(con)
    assert s["10001-1-100"] == "ok"
    assert s["10001-1-101"] == "sem_coordenada"
    assert s["10001-1-102"] == "borda"
    assert s["10001-1-103"] == "fora_do_municipio"
    assert {s[f"10002-2-{n}"] for n in (200, 201, 202, 203)} == {"compartilhada"}
    assert s["10002-2-204"] == "ok"


def test_municipalities_match_by_name(con: duckdb.DuckDBPyConnection) -> None:
    rows = con.execute("SELECT cd_tse, cd_ibge, metodo FROM municipios ORDER BY 1").fetchall()
    assert rows == [("10001", "3300001", "nome"), ("10002", "3300002", "nome")]
