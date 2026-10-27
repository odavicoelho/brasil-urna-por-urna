"""Linha de comando: `urna ingest`, `urna places`, `urna geocode`."""

from __future__ import annotations

from typing import Annotated

import duckdb
import typer

from urnaporurna import geocode as geocode_mod
from urnaporurna import ingest as ingest_mod
from urnaporurna import places as places_mod
from urnaporurna import reconcile as reconcile_mod
from urnaporurna import results as results_mod
from urnaporurna.config import SOURCES

app = typer.Typer(help="Pipeline do Brasil Urna por Urna.", no_args_is_help=True)


@app.command()
def ingest(
    only: Annotated[list[str] | None, typer.Option(help="Fontes a processar (padrão: todas).")] = None,
    force: Annotated[bool, typer.Option(help="Baixa de novo mesmo se o arquivo já existe.")] = False,
) -> None:
    """Baixa as fontes e converte os CSVs para Parquet."""
    for name in only or list(SOURCES):
        source = SOURCES[name]
        typer.echo(f"↓ {name}")
        archive = ingest_mod.download(source, force=force)
        for table, n in ingest_mod.to_bronze(source, archive).items():
            typer.echo(f"  {table}: {n:,} linhas")


@app.command()
def places() -> None:
    """Monta os locais de votação e marca a qualidade de cada coordenada."""
    con = places_mod.run()
    typer.echo("Locais por selo de coordenada:")
    for status, n, voters in con.execute(
        "SELECT geo_status, count(*), sum(eleitores) FROM places_flagged GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall():
        typer.echo(f"  {status:<18} {n:>7,} locais  {voters:>12,} eleitores")
    typer.echo("Municípios TSE->IBGE por método:")
    for metodo, n in con.execute(
        "SELECT metodo, count(*) FROM municipios GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall():
        typer.echo(f"  {metodo or 'sem correspondência'}: {n:,}")
    pending = con.execute(
        "SELECT cd_tse, uf, municipio, cd_ibge, nm_ibge, share_pontos FROM municipios"
        " WHERE metodo IS DISTINCT FROM 'nome' AND metodo IS DISTINCT FROM 'conferido' ORDER BY uf, municipio"
    ).fetchall()
    for r in pending:
        typer.echo(f"  ⚠ conferir: {r[1]} {r[2]} (TSE {r[0]}) -> {r[4]} (IBGE {r[3]}, {r[5]} dos pontos)")
    _report_sources(con)


@app.command()
def geocode(
    limit: Annotated[int | None, typer.Option(help="Processa só os primeiros N locais (teste).")] = None,
    offline: Annotated[bool, typer.Option(help="Usa só o cache, sem requisições novas.")] = False,
) -> None:
    """Geocodifica os locais sem coordenada confiável (Nominatim, 1 req/s, com cache)."""
    stats = geocode_mod.run(limit=limit, offline=offline)
    typer.echo(", ".join(f"{k}: {v:,}" for k, v in stats.items()))
    _report_sources(places_mod.finalize())


@app.command()
def results() -> None:
    """Soma os votos por local de votação e confere com a totalização oficial do TSE."""
    con = results_mod.run()
    checks = reconcile_mod.run(con)
    icons = {"ok": "✓", "falha": "✗", "aguardando": "…"}
    for c in checks:
        turno = f"{c.turno}º turno" if c.turno else ""
        counts = f"{c.comparados:,} comparados, {c.divergentes:,} diferentes"
        typer.echo(f"  {icons[c.status]} {c.nome} · {turno}: {counts}")
        if c.detalhe:
            typer.echo(f"      {c.detalhe}")
    if any(c.status == "falha" for c in checks):
        typer.echo("Conferência falhou: os dados não foram aceitos.", err=True)
        raise typer.Exit(1)


def _report_sources(con: duckdb.DuckDBPyConnection) -> None:
    typer.echo("Fonte da coordenada final:")
    for fonte, n, voters in con.execute(
        "SELECT coalesce(geo_fonte || coalesce(' · ' || geo_consulta, ''),"
        " CASE geo_status WHEN 'exterior' THEN 'exterior (lista à parte)' ELSE 'sem ponto no mapa' END),"
        " count(*), sum(eleitores)::BIGINT"
        " FROM locais GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall():
        typer.echo(f"  {fonte:<28} {n:>7,} locais  {voters:>12,} eleitores")
    row = con.execute(
        "SELECT count(*), sum(eleitores)::BIGINT FROM locais WHERE geo_precisao = 'aproximada'"
    ).fetchone()
    assert row is not None
    typer.echo(f"Coordenada aproximada: {row[0]:,} locais, {row[1]:,} eleitores")


if __name__ == "__main__":
    app()
