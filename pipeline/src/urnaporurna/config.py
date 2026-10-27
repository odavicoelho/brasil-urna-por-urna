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
CENSO = "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022"
CENSO_SETOR = f"{CENSO}/Agregados_por_Setores_Censitarios/Agregados_por_Setor_csv"


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    # CSV dentro do zip (regex) -> nome da tabela bronze. Vazio para arquivos lidos direto (ex.: shapefile).
    members: dict[str, str]
    # TSE usa Latin-1; o IBGE usa Windows-1252 (aspas e travessões que o Latin-1 não tem).
    encoding: str = "latin-1"


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
        # Totalização oficial por município e zona: usada para conferir as somas por seção.
        Source(
            "totais_votos",
            f"{TSE}/votacao_candidato_munzona/votacao_candidato_munzona_2026.zip",
            {r"votacao_candidato_munzona_2026_BR\.csv$": "totais_votos"},
        ),
        Source(
            "totais_detalhe",
            f"{TSE}/detalhe_votacao_munzona/detalhe_votacao_munzona_2026.zip",
            {r"detalhe_votacao_munzona_2026_BR\.csv$": "totais_detalhe"},
        ),
        # Só número, nome de urna e partido saem daqui; o arquivo bruto tem dados pessoais e não é publicado.
        Source(
            "candidatos",
            f"{TSE}/consulta_cand/consulta_cand_2026.zip",
            {r"consulta_cand_2026_BR\.csv$": "candidatos"},
        ),
        Source(
            "municipios_ibge",
            f"{IBGE_GEO}/malhas_municipais/municipio_2025/Brasil/BR_Municipios_2025.zip",
            {},
        ),
        # Censo 2022 por setor censitário: a malha (polígonos) e as tabelas usadas no perfil do entorno.
        Source(
            "setores_ibge",
            f"{IBGE_GEO}/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/gpkg/BR/"
            "BR_setores_CD2022.gpkg",
            {},
        ),
        Source(
            "censo_basico",
            f"{CENSO_SETOR}/Agregados_por_setores_basico_BR_20260520.zip",
            {r"\.csv$": "censo_basico"},
            encoding="cp1252",
        ),
        Source(
            "censo_demografia",
            f"{CENSO_SETOR}/Agregados_por_setores_demografia_BR.zip",
            {r"\.csv$": "censo_demografia"},
            encoding="cp1252",
        ),
        Source(
            "censo_alfabetizacao",
            f"{CENSO_SETOR}/Agregados_por_setores_alfabetizacao_BR.zip",
            {r"\.csv$": "censo_alfabetizacao"},
            encoding="cp1252",
        ),
        Source(
            "censo_cor_raca",
            f"{CENSO_SETOR}/Agregados_por_setores_cor_ou_raca_BR.zip",
            {r"\.csv$": "censo_cor_raca"},
            encoding="cp1252",
        ),
        Source(
            "censo_renda",
            f"{CENSO}/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/"
            "Agregados_por_setores_renda_responsavel_BR_20260508_csv.zip",
            {r"\.csv$": "censo_renda"},
            encoding="cp1252",
        ),
    ]
}
