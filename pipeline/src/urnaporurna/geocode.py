"""Geocodificação dos locais sem coordenada confiável, via Nominatim (OpenStreetMap).

Regras de uso do Nominatim: no máximo 1 requisição por segundo, User-Agent identificado,
resultados em cache (cada consulta é feita uma vez só). Dados © colaboradores do OpenStreetMap (ODbL).

Uma resposta só é aceita se o ponto cair dentro do município certo. Se nenhuma consulta passar,
o local fica no centro do município (um ponto dentro do polígono) e é marcado como aproximado.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import duckdb
import httpx

from urnaporurna.config import GEOCODE_CACHE, SILVER, USER_AGENT
from urnaporurna.places import connect, municipalities_path

NOMINATIM = "https://nominatim.openstreetmap.org/search"
MIN_INTERVAL = 1.1  # segundos entre requisições

TO_GEOCODE = ("sem_coordenada", "compartilhada", "fora_do_municipio")

STATES = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará",
    "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão",
    "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais", "PA": "Pará",
    "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte", "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima",
    "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins",
}  # fmt: skip


@dataclass(frozen=True)
class Place:
    place_id: str
    uf: str
    municipio: str
    cd_ibge: str | None
    nome: str
    endereco: str | None
    cep: str | None


def queries(p: Place) -> Iterator[tuple[str, dict[str, str]]]:
    """Consultas em ordem de precisão: endereço, nome do local, CEP."""
    base = {"city": p.municipio.title(), "state": STATES[p.uf], "country": "Brasil"}
    cep = f"{p.cep[:5]}-{p.cep[5:]}" if p.cep and len(p.cep) == 8 and p.cep != "00000000" else None
    if p.endereco:
        yield "endereco", {**base, "street": p.endereco.title()}
    yield "nome", {"q": f"{p.nome.title()}, {p.municipio.title()}, {STATES[p.uf]}, Brasil"}
    if cep:
        yield "cep", {**base, "postalcode": cep}


class Cache:
    def __init__(self) -> None:
        self.entries: dict[str, dict[str, Any]] = {}
        if GEOCODE_CACHE.exists():
            for line in GEOCODE_CACHE.read_text().splitlines():
                e = json.loads(line)
                self.entries[e["key"]] = e

    @staticmethod
    def key(params: dict[str, str]) -> str:
        return json.dumps(params, sort_keys=True, ensure_ascii=False)

    def get(self, params: dict[str, str]) -> dict[str, Any] | None:
        return self.entries.get(self.key(params))

    def put(self, params: dict[str, str], result: dict[str, Any] | None) -> dict[str, Any]:
        key = self.key(params)
        e: dict[str, Any] = {"key": key, "result": result}
        self.entries[key] = e
        GEOCODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        with GEOCODE_CACHE.open("a") as f:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
        return e


class Nominatim:
    def __init__(self, cache: Cache) -> None:
        self.cache = cache
        self.client = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30)
        self.last = 0.0
        self.requests = 0

    def search(self, params: dict[str, str]) -> dict[str, Any] | None:
        hit = self.cache.get(params)
        if hit is not None:
            result: dict[str, Any] | None = hit["result"]
            return result
        wait = MIN_INTERVAL - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        r = self.client.get(
            NOMINATIM, params={**params, "format": "jsonv2", "limit": "1", "countrycodes": "br"}
        )
        self.last = time.monotonic()
        self.requests += 1
        r.raise_for_status()
        rows = r.json()
        found = (
            {"lat": float(rows[0]["lat"]), "lon": float(rows[0]["lon"]), "label": rows[0]["display_name"]}
            if rows
            else None
        )
        self.cache.put(params, found)
        return found


def inside(con: duckdb.DuckDBPyConnection, cd_ibge: str | None, lat: float, lon: float) -> bool:
    if cd_ibge is None:
        return False
    row = con.execute(
        "SELECT ST_Intersects(ST_Point(?, ?), geom) FROM mun WHERE cd_ibge = ?", [lon, lat, cd_ibge]
    ).fetchone()
    return bool(row and row[0])


def candidates(con: duckdb.DuckDBPyConnection) -> list[Place]:
    rows = con.execute(
        f"""
        SELECT place_id, uf, municipio, cd_ibge, nome, endereco, cep
        FROM '{SILVER / "locais_base.parquet"}'
        WHERE geo_status IN {TO_GEOCODE}
        ORDER BY place_id
        """
    ).fetchall()
    return [Place(*r) for r in rows]


def open_con() -> duckdb.DuckDBPyConnection:
    con = connect()
    con.execute(f"CREATE TABLE mun AS SELECT CD_MUN AS cd_ibge, geom FROM ST_Read('{municipalities_path()}')")
    return con


def resolve(con: duckdb.DuckDBPyConnection, api: Nominatim, p: Place) -> tuple[str, float, float] | None:
    """Primeira resposta que cai dentro do município certo: (tipo de consulta, lat, lon)."""
    for kind, params in queries(p):
        found = api.search(params)
        if found and inside(con, p.cd_ibge, found["lat"], found["lon"]):
            return kind, found["lat"], found["lon"]
    return None


def run(limit: int | None = None, progress: bool = True) -> dict[str, int]:
    """Geocodifica os candidatos e grava data/silver/geocodificados.parquet."""
    con = open_con()
    api = Nominatim(Cache())
    places = candidates(con)[:limit]
    rows: list[tuple[str, str, float, float]] = []
    for i, p in enumerate(places, 1):
        hit = resolve(con, api, p)
        if hit:
            rows.append((p.place_id, hit[0], hit[1], hit[2]))
        if progress and i % 50 == 0:
            print(f"  {i}/{len(places)} locais, {api.requests} requisições novas", flush=True)
    con.execute("CREATE TABLE geo (place_id VARCHAR, consulta VARCHAR, lat DOUBLE, lon DOUBLE)")
    if rows:
        con.executemany("INSERT INTO geo VALUES (?, ?, ?, ?)", rows)
    con.execute(f"COPY geo TO '{SILVER / 'geocodificados.parquet'}' (FORMAT parquet)")
    return {"candidatos": len(places), "geocodificados": len(rows), "requisicoes": api.requests}
