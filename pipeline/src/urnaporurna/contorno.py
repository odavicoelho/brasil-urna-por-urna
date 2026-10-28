"""Contorno do Brasil e dos estados para o mapa de fundo do site.

O site desenha só o Brasil. De longe, `brasil.json` é o mapa inteiro (país, divisas e siglas dos estados,
simplificados em ~2 km, coordenadas com 2 casas). De perto, as ruas do OpenFreeMap aparecem e
`mascara.json` (um retângulo com o Brasil vazado) cobre os outros países; ele só é baixado quando alguém
aproxima o mapa. A máscara usa o Brasil com 1 km de folga e simplificação menor que a folga, para nunca
cobrir território brasileiro.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from urnaporurna.places import connect, municipalities_path

TOLERANCIA = 0.02  # graus, ~2 km: o contorno só aparece de longe (zoom < 8)
FOLGA_MASCARA = 0.01  # graus
TOLERANCIA_MASCARA = 0.004
# Retângulo da máscara: bem maior que o Brasil, para cobrir a tela inteira em qualquer zoom permitido.
CAIXA = (-115.0, -75.0, 5.0, 40.0)


def arredonda(coords: Any, casas: int) -> Any:
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], casas), round(coords[1], casas)]
    return [arredonda(c, casas) for c in coords]


def feature(geojson: str, props: dict[str, Any], casas: int = 2) -> dict[str, Any]:
    g = json.loads(geojson)
    g["coordinates"] = arredonda(g["coordinates"], casas)
    return {"type": "Feature", "properties": props, "geometry": g}


def dump(path: Path, feats: list[dict[str, Any]]) -> int:
    text = json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return len(text)


def run(out: Path) -> dict[str, int]:
    con = connect()
    con.execute(
        f"""
        CREATE TABLE uf AS
        SELECT SIGLA_UF AS uf, ST_Union_Agg(geom) AS geom FROM ST_Read('{municipalities_path()}') GROUP BY 1
        """
    )
    con.execute("CREATE TABLE pais AS SELECT ST_Union_Agg(geom) AS geom FROM uf")
    feats: list[dict[str, Any]] = []
    simplificado = f"ST_SimplifyPreserveTopology(geom, {TOLERANCIA})"
    (pais,) = con.execute(f"SELECT ST_AsGeoJSON({simplificado}) FROM pais").fetchone()  # type: ignore[misc]
    feats.append(feature(pais, {"tipo": "pais"}))
    x0, y0, x1, y1 = CAIXA
    (mascara,) = con.execute(  # type: ignore[misc]
        f"""
        SELECT ST_AsGeoJSON(ST_Difference(ST_MakeEnvelope({x0}, {y0}, {x1}, {y1}),
            ST_SimplifyPreserveTopology(ST_Buffer(geom, {FOLGA_MASCARA}), {TOLERANCIA_MASCARA})))
        FROM pais
        """
    ).fetchone()
    mascara_feats = [feature(mascara, {"tipo": "mascara"}, casas=3)]
    for uf, contorno, ponto in con.execute(
        f"""
        SELECT uf, ST_AsGeoJSON(ST_Boundary(ST_SimplifyPreserveTopology(geom, {TOLERANCIA}))),
            ST_AsGeoJSON(ST_PointOnSurface(geom))
        FROM uf ORDER BY uf
        """
    ).fetchall():
        feats.append(feature(contorno, {"tipo": "divisa", "uf": uf}))
        feats.append(feature(ponto, {"tipo": "sigla", "uf": uf}))
    return {
        "brasil.json": dump(out / "brasil.json", feats),
        "mascara.json": dump(out / "mascara.json", mascara_feats),
    }
