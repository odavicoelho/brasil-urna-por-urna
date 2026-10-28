"""Descobertas: faixas com o mesmo eleitorado e a fatia do crescimento de cada candidato."""

from __future__ import annotations

import duckdb

from urnaporurna import descobertas


def base(con: duckdb.DuckDBPyConnection) -> None:
    # 10 locais com 100 aptos; quanto maior x, mais votos de direita no 1º turno e mais B cresce.
    con.execute(
        """
        CREATE TEMP TABLE desc_base AS
        SELECT 'p' || i AS place_id, 'SP' AS uf, i * 1.0 AS x, 100 AS aptos,
            40 AS a1, 40 AS b1, 100 AS t1, 2 * i AS dir1,
            40 + (20 - i) AS a2, 40 + i AS b2
        FROM range(10) t(i)
        """
    )


def test_quintis_tem_o_mesmo_eleitorado() -> None:
    con = duckdb.connect()
    base(con)
    q = descobertas.quintis(con, "x")
    assert len(q) == 5
    assert [f["x_min"] for f in q] == [0, 2, 4, 6, 8]  # 2 locais (200 aptos) por faixa
    assert sum(f["a2"] + f["b2"] for f in q) == sum(80 + 20 for _ in range(10))


def test_direita_fatia_do_crescimento() -> None:
    con = duckdb.connect()
    base(con)
    d = descobertas.direita(con)
    # faixa mais fraca: locais 0 e 1 -> A cresceu 20+19, B cresceu 0+1
    assert d[0]["b_do_crescimento"] == descobertas.pct(1, 40)
    assert d[-1]["b_do_crescimento"] > d[0]["b_do_crescimento"]
