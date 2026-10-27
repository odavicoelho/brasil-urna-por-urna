"""Caminhos e fontes de dados."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA = Path(os.environ.get("URNA_DATA", ROOT / "data"))
RAW = DATA / "raw"  # arquivos baixados, sem alteração
BRONZE = DATA / "bronze"  # tabelas brutas em Parquet, todas as colunas como texto
SILVER = DATA / "silver"  # tabelas limpas e tipadas
MANIFEST = DATA / "manifest.json"
GEOCODE_CACHE = DATA / "geocode_cache.jsonl"

USER_AGENT = "brasil-urna-por-urna/0.1 (+https://github.com/odavicoelho/brasil-urna-por-urna)"

TSE = "https://cdn.tse.jus.br/estatistica/sead/odsele"
IBGE_GEO = "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais"


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    # CSV dentro do zip (regex) -> nome da tabela bronze. Vazio para arquivos lidos direto (ex.: shapefile).
    members: dict[str, str]


SOURCES: dict[str, Source] = {
    s.name: s
    for s in [
        Source(
            "votos_secao",
            f"{TSE}/votacao_secao/votacao_secao_2026_BR.zip",
            {r"votacao_secao_2026_BR\.csv$": "votos_secao"},
        ),
        Source(
            "detalhe_secao",
            f"{TSE}/detalhe_votacao_secao/detalhe_votacao_secao_2026.zip",
            # _BR = eleição federal (presidente); _BRASIL = eleições estaduais
            {r"detalhe_votacao_secao_2026_BR\.csv$": "detalhe_secao"},
        ),
        Source(
            "locais",
            f"{TSE}/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip",
            {r"eleitorado_local_votacao_2026_BRASIL\.csv$": "locais"},
        ),
        Source(
            "municipios_ibge",
            f"{IBGE_GEO}/malhas_municipais/municipio_2025/Brasil/BR_Municipios_2025.zip",
            {},
        ),
    ]
}
