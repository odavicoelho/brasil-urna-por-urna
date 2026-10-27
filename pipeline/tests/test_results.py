"""Resultado por local e conferência, numa eleição de mentira com 3 seções em 2 locais.

Casos difíceis cobertos: candidatura anulada (vira nulo técnico), código de município sem zero à
esquerda nos arquivos de votação, número antigo de local renumerado, turno ainda sem totalização oficial.
"""

from __future__ import annotations

import duckdb
import pytest

from urnaporurna import reconcile, results

# (turno, município, zona, seção, local no arquivo de votos, número votado, votos)
VOTOS = [
    (1, "2550", 5, 1, 1010, 13, 100), (1, "2550", 5, 1, 1010, 22, 80), (1, "2550", 5, 1, 1010, 28, 3),
    (1, "2550", 5, 1, 1010, 95, 2), (1, "2550", 5, 1, 1010, 96, 5),
    (1, "2550", 5, 2, 1010, 13, 50), (1, "2550", 5, 2, 1010, 22, 60),
    # seção 3: o arquivo de votos traz o número antigo (9999) do local que hoje é o 1020
    (1, "2550", 5, 3, 9999, 13, 10), (1, "2550", 5, 3, 9999, 22, 30),
    (2, "2550", 5, 1, 1010, 13, 110), (2, "2550", 5, 1, 1010, 22, 75),
    (2, "2550", 5, 2, 1010, 13, 55), (2, "2550", 5, 2, 1010, 22, 58),
    (2, "2550", 5, 3, 9999, 13, 12), (2, "2550", 5, 3, 9999, 22, 29),
]  # fmt: skip

# (seção, local)
LOCAIS = [(1, 1010), (2, 1010), (3, 1020)]


def detail_rows() -> list[tuple[int, int, int, int, int, int, int, int]]:
    """(turno, seção, aptos, comparecimento, abstenções, nominais, brancos, nulos) a partir dos votos."""
    out = []
    for turno in (1, 2):
        for secao, _ in LOCAIS:
            vs = [(n, v) for t, _m, _z, s, _l, n, v in VOTOS if t == turno and s == secao]
            nominais = sum(v for n, v in vs if n not in (95, 96))
            brancos = sum(v for n, v in vs if n == 95)
            nulos = sum(v for n, v in vs if n == 96)
            comp = nominais + brancos + nulos
            out.append((turno, secao, comp + 20, comp, 20, nominais, brancos, nulos))
    return out


@pytest.fixture
def con() -> duckdb.DuckDBPyConnection:
    c = duckdb.connect()
    c.execute(
        """CREATE TABLE votos_secao (NR_TURNO VARCHAR, SG_UF VARCHAR, CD_MUNICIPIO VARCHAR, NR_ZONA VARCHAR,
           NR_SECAO VARCHAR, NR_LOCAL_VOTACAO VARCHAR, NM_LOCAL_VOTACAO VARCHAR, NR_VOTAVEL VARCHAR,
           NM_VOTAVEL VARCHAR, SQ_CANDIDATO VARCHAR, QT_VOTOS VARCHAR)"""
    )
    for t, m, z, s, loc, n, v in VOTOS:
        nome = "ESCOLA ANTIGA" if loc == 9999 else f"ESCOLA {loc}"
        c.execute(
            "INSERT INTO votos_secao VALUES (?, 'RJ', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [str(t), m, str(z), str(s), str(loc), nome, str(n), f"CAND {n}", f"sq{n}", str(v)],
        )
    c.execute(
        """CREATE TABLE detalhe_secao (NR_TURNO VARCHAR, SG_UF VARCHAR, CD_MUNICIPIO VARCHAR, NR_ZONA VARCHAR,
           NR_SECAO VARCHAR, ST_SECAO_INSTALADA VARCHAR, QT_APTOS VARCHAR, QT_COMPARECIMENTO VARCHAR,
           QT_ABSTENCOES VARCHAR, QT_VOTOS_NOMINAIS VARCHAR, QT_VOTOS_BRANCOS VARCHAR, QT_VOTOS_NULOS VARCHAR,
           QT_VOTOS_LEGENDA VARCHAR, QT_VOTOS_ANULADOS_APU_SEP VARCHAR)"""
    )
    for t, s, *nums in detail_rows():
        c.execute(
            "INSERT INTO detalhe_secao VALUES (?, 'RJ', '2550', '5', ?, 'Sim', ?, ?, ?, ?, ?, ?, '0', '0')",
            [str(t), str(s), *map(str, nums)],
        )
    c.execute(
        """CREATE TABLE locais_raw (NR_TURNO VARCHAR, CD_MUNICIPIO VARCHAR, NR_ZONA VARCHAR, NR_SECAO VARCHAR,
           NR_LOCAL_VOTACAO VARCHAR, NM_LOCAL_VOTACAO VARCHAR, NM_LOCAL_VOTACAO_ORIGINAL VARCHAR)"""
    )
    for t in ("1", "2"):
        for s, loc in LOCAIS:
            c.execute(
                "INSERT INTO locais_raw VALUES (?, '02550', '5', ?, ?, ?, 'ESCOLA ANTIGA')",
                [t, str(s), str(loc), f"ESCOLA {loc}"],
            )
    c.execute(
        """CREATE TABLE candidatos AS SELECT * FROM (VALUES
           ('1', '1', 'sq13', 'TREZE', 'P13', '2º TURNO'), ('1', '1', 'sq22', 'VINTE E DOIS', 'P22', '2º TURNO'),
           ('1', '1', 'sq28', 'VINTE E OITO', 'P28', '#NULO'),
           ('2', '1', 'sq13', 'TREZE', 'P13', 'ELEITO'), ('2', '1', 'sq22', 'VINTE E DOIS', 'P22', 'NÃO ELEITO'))
           t(NR_TURNO, CD_CARGO, SQ_CANDIDATO, NM_URNA_CANDIDATO, SG_PARTIDO, DS_SIT_TOT_TURNO)"""
    )
    # Totalização oficial: o 28 não aparece como válido; o detalhe só existe para o 1º turno.
    c.execute(
        """CREATE TABLE totais_votos AS SELECT * FROM (VALUES
           ('1', 'RJ', 'sq13', '13', 'Válido', '160'), ('1', 'RJ', 'sq22', '22', 'Válido', '170'),
           ('2', 'RJ', 'sq13', '13', 'Válido', '177'), ('2', 'RJ', 'sq22', '22', 'Válido', '162'))
           t(NR_TURNO, SG_UF, SQ_CANDIDATO, NR_CANDIDATO, NM_TIPO_DESTINACAO_VOTOS, QT_VOTOS_NOMINAIS_VALIDOS)"""
    )
    c.execute(
        """CREATE TABLE totais_detalhe AS SELECT * FROM (VALUES ('1', 'RJ', '400', '340', '60', '330', '2', '8'))
           t(NR_TURNO, SG_UF, QT_APTOS, QT_COMPARECIMENTO, QT_ABSTENCOES, QT_TOTAL_VOTOS_VALIDOS,
             QT_VOTOS_BRANCOS, QT_TOTAL_VOTOS_NULOS)"""
    )
    results.build_sections(c)
    results.build_candidates(c)
    results.build_results(c)
    return c


def test_annulled_candidacy_counts_as_technical_null(con: duckdb.DuckDBPyConnection) -> None:
    valid = dict(con.execute("SELECT numero, valido FROM candidatos_turno WHERE turno = 1").fetchall())
    assert valid == {13: True, 22: True, 28: False}
    row = con.execute(
        "SELECT validos, brancos, nulos FROM comparecimento_local WHERE place_id = '02550-5-1010' AND turno = 1"
    ).fetchone()
    assert row == (290, 2, 8)  # nulos = 5 nulos + 3 votos no 28


def test_sections_link_to_current_place_not_old_number(con: duckdb.DuckDBPyConnection) -> None:
    votes = dict(
        con.execute(
            "SELECT numero, votos FROM resultados_local WHERE place_id = '02550-5-1020' AND turno = 1"
        ).fetchall()
    )
    assert votes == {13: 10, 22: 30}
    assert con.execute("SELECT count(*) FROM votos_classificados WHERE place_id IS NULL").fetchone() == (0,)


def test_shares_of_valid_votes(con: duckdb.DuckDBPyConnection) -> None:
    pct = dict(
        con.execute(
            "SELECT numero, pct_validos FROM resultados_local WHERE place_id = '02550-5-1020' AND turno = 2"
        ).fetchall()
    )
    assert pct == {13: 29.27, 22: 70.73}


def test_reconciliation_passes_and_waits_for_round_two(
    con: duckdb.DuckDBPyConnection, tmp_path: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(reconcile, "SILVER", tmp_path)
    status = {(c.nome, c.turno): c.status for c in reconcile.run(con)}
    assert status[("votos por candidato x UF (oficial)", 1)] == "ok"
    assert status[("votos por candidato x UF (oficial)", 2)] == "ok"
    assert status[("comparecimento, brancos e nulos x UF (oficial)", 1)] == "ok"
    assert status[("comparecimento, brancos e nulos x UF (oficial)", 2)] == "aguardando"
    assert {s for (nome, _), s in status.items() if nome.startswith("seção")} == {"ok"}


def test_reconciliation_catches_a_wrong_official_total(
    con: duckdb.DuckDBPyConnection, tmp_path: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(reconcile, "SILVER", tmp_path)
    con.execute(
        "UPDATE totais_votos SET QT_VOTOS_NOMINAIS_VALIDOS = '161' WHERE NR_TURNO = '1' AND NR_CANDIDATO = '13'"
    )
    check = next(c for c in reconcile.official_votes(con) if c.turno == 1)
    assert (check.status, check.divergentes) == ("falha", 1)
