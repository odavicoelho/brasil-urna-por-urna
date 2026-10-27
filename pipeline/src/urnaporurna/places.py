"""Locais de votação: uma linha por local, com coordenada limpa e um selo de qualidade.

Selo `geo_status` antes da geocodificação:
- `ok`: coordenada do TSE dentro do próprio município
- `sem_coordenada`: vazia, -1 ou fora do Brasil
- `compartilhada`: o mesmo ponto usado por 4+ locais diferentes (provável coordenada provisória)
- `borda`: até 1 km fora do município (diferença de traçado da divisa); a coordenada fica
- `fora_do_municipio`: mais de 1 km fora do município
- `exterior`: votação no exterior (fora do mapa)

Os municípios do TSE têm código próprio. A tabela de correspondência TSE -> IBGE é montada
pelos próprios pontos (o município do IBGE que contém a maioria dos locais) e conferida pelo nome.
"""

from __future__ import annotations

import duckdb

from urnaporurna.config import BRONZE, RAW, SILVER, SOURCES

SHARED_MIN_PLACES = 4
# Até 1 km fora do município é diferença de traçado da divisa: a coordenada do TSE fica.
BORDER_TOLERANCE_KM = 1.0
KM_PER_DEGREE = 111.32  # aproximação suficiente para medir distância à divisa

# Municípios cujo nome no TSE difere do IBGE (grafia antiga ou nome anterior), conferidos à mão.
# código TSE -> código IBGE
ALIASES: dict[str, str] = {
    "92690": "5203500",  # GO Bom Jesus -> Bom Jesus de Goiás
    "41092": "3105509",  # MG Barão de Monte Alto -> Barão do Monte Alto
    "44571": "3122900",  # MG Dona Eusébia -> Dona Euzébia
    "53031": "3165206",  # MG São Thomé das Letras -> São Tomé das Letras
    "91553": "5107800",  # MT Santo Antônio do Leverger -> Santo Antônio de Leverger
    "04120": "1502954",  # PA Eldorado dos Carajás -> Eldorado do Carajás
    "77119": "4116307",  # PR Munhoz de Mello -> Munhoz de Melo
    "17035": "2405306",  # RN Boa Saúde -> Januário Cicco (nome atual)
    "00337": "1100346",  # RO Alvorada do Oeste -> Alvorada D'Oeste
    "00256": "1100098",  # RO Espigão do Oeste -> Espigão D'Oeste
    "03158": "1400605",  # RR São Luiz -> São Luiz do Anauá
    "31011": "2800100",  # SE Amparo de São Francisco -> Amparo do São Francisco
    "71013": "3550001",  # SP São Luís do Paraitinga -> São Luiz do Paraitinga
}

NORMALIZE = "regexp_replace(strip_accents(upper({})), '[^A-Z0-9]', '', 'g')"


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    return con


def municipalities_path() -> str:
    archive = RAW / SOURCES["municipios_ibge"].url.rsplit("/", 1)[-1]
    return f"/vsizip/{archive}/{archive.stem}.shp"


def load_inputs(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(f"CREATE OR REPLACE VIEW locais_raw AS SELECT * FROM '{BRONZE / 'locais.parquet'}'")
    con.execute(
        f"""
        CREATE OR REPLACE TABLE mun_ibge AS
        SELECT CD_MUN AS cd_ibge, NM_MUN AS nm_ibge, SIGLA_UF AS uf, geom
        FROM ST_Read('{municipalities_path()}')
        """
    )


def build_places(con: duckdb.DuckDBPyConnection) -> None:
    """Agrega as seções em locais e converte as coordenadas (vírgula decimal)."""
    con.execute(
        """
        CREATE OR REPLACE TABLE places AS
        WITH s AS (
            SELECT *,
                try_cast(replace(NR_LATITUDE, ',', '.') AS DOUBLE) AS lat_tse,
                try_cast(replace(NR_LONGITUDE, ',', '.') AS DOUBLE) AS lon_tse
            FROM locais_raw
            WHERE NR_TURNO = '1'
        )
        SELECT
            CD_MUNICIPIO || '-' || NR_ZONA || '-' || NR_LOCAL_VOTACAO AS place_id,
            any_value(SG_UF) AS uf,
            CD_MUNICIPIO AS cd_tse,
            any_value(NM_MUNICIPIO) AS municipio,
            NR_ZONA::INT AS zona,
            NR_LOCAL_VOTACAO::INT AS nr_local,
            any_value(NM_LOCAL_VOTACAO) AS nome,
            any_value(DS_TIPO_LOCAL) AS tipo,
            any_value(DS_ENDERECO) AS endereco,
            any_value(NM_BAIRRO) AS bairro,
            any_value(NR_CEP) AS cep,
            any_value(lat_tse) AS lat_tse,
            any_value(lon_tse) AS lon_tse,
            count(DISTINCT NR_SECAO) AS secoes,
            sum(QT_ELEITOR_SECAO::INT) AS eleitores
        FROM s
        GROUP BY CD_MUNICIPIO, NR_ZONA, NR_LOCAL_VOTACAO
        """
    )


def flag_places(con: duckdb.DuckDBPyConnection) -> None:
    """Marca coordenadas ausentes, compartilhadas e fora do município."""
    con.execute(
        """
        CREATE OR REPLACE TABLE valid AS
        SELECT *,
            uf <> 'ZZ' AND lat_tse BETWEEN -34 AND 6 AND lon_tse BETWEEN -74 AND -28
                AND lat_tse <> -1 AS has_coord
        FROM places
        """
    )
    # Junção espacial simples (ponto x polígono), para o DuckDB usar o índice espacial.
    con.execute(
        """
        CREATE OR REPLACE TABLE point_mun AS
        WITH pts AS (SELECT place_id, ST_Point(lon_tse, lat_tse) AS geom FROM valid WHERE has_coord)
        SELECT pts.place_id, any_value(m.cd_ibge) AS cd_ibge
        FROM pts JOIN mun_ibge m ON ST_Intersects(pts.geom, m.geom)
        GROUP BY pts.place_id
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE places_geo AS
        WITH shared AS (
            SELECT round(lat_tse, 5) AS rlat, round(lon_tse, 5) AS rlon
            FROM valid WHERE has_coord
            GROUP BY ALL HAVING count(*) >= {SHARED_MIN_PLACES}
        )
        SELECT v.*,
            v.has_coord AND s.rlat IS NOT NULL AS is_shared,
            pm.cd_ibge AS cd_ibge_ponto
        FROM valid v
        LEFT JOIN shared s ON round(v.lat_tse, 5) = s.rlat AND round(v.lon_tse, 5) = s.rlon
        LEFT JOIN point_mun pm USING (place_id)
        """
    )
    # Correspondência TSE -> IBGE. 1º pelo nome dentro da UF (sem acento e pontuação);
    # 2º pela tabela de nomes conferidos à mão; 3º pela maioria dos pontos (só como último recurso).
    aliases = ", ".join(f"('{tse}', '{ibge}')" for tse, ibge in ALIASES.items()) or "(NULL, NULL)"
    con.execute(
        f"""
        CREATE OR REPLACE TABLE municipios AS
        WITH tse AS (
            SELECT cd_tse, any_value(uf) AS uf, any_value(municipio) AS municipio
            FROM places_geo WHERE uf <> 'ZZ' GROUP BY cd_tse
        ),
        by_name AS (
            SELECT t.cd_tse, m.cd_ibge
            FROM tse t JOIN mun_ibge m
              ON t.uf = m.uf AND {NORMALIZE.format("t.municipio")} = {NORMALIZE.format("m.nm_ibge")}
        ),
        by_alias AS (SELECT * FROM (VALUES {aliases}) a(cd_tse, cd_ibge) WHERE cd_tse IS NOT NULL),
        votes AS (
            SELECT cd_tse, cd_ibge_ponto AS cd_ibge, count(*) AS n
            FROM places_geo
            WHERE has_coord AND NOT is_shared AND cd_ibge_ponto IS NOT NULL
            GROUP BY ALL
        ),
        by_points AS (
            SELECT cd_tse, cd_ibge, round(n / sum(n) OVER (PARTITION BY cd_tse), 3) AS share
            FROM votes QUALIFY row_number() OVER (PARTITION BY cd_tse ORDER BY n DESC) = 1
        )
        SELECT t.cd_tse, t.uf, t.municipio,
            coalesce(n.cd_ibge, a.cd_ibge, p.cd_ibge) AS cd_ibge,
            m.nm_ibge,
            CASE WHEN n.cd_ibge IS NOT NULL THEN 'nome'
                 WHEN a.cd_ibge IS NOT NULL THEN 'conferido'
                 WHEN p.cd_ibge IS NOT NULL THEN 'pontos' END AS metodo,
            p.share AS share_pontos
        FROM tse t
        LEFT JOIN by_name n USING (cd_tse)
        LEFT JOIN by_alias a USING (cd_tse)
        LEFT JOIN by_points p USING (cd_tse)
        LEFT JOIN mun_ibge m ON m.cd_ibge = coalesce(n.cd_ibge, a.cd_ibge, p.cd_ibge)
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE places_flagged AS
        WITH p AS (
            SELECT p.*, mu.cd_ibge,
                CASE WHEN p.has_coord AND p.cd_ibge_ponto IS DISTINCT FROM mu.cd_ibge
                     THEN ST_Distance(ST_Point(p.lon_tse, p.lat_tse), m.geom) * {KM_PER_DEGREE}
                END AS km_fora
            FROM places_geo p
            LEFT JOIN municipios mu USING (cd_tse)
            LEFT JOIN mun_ibge m ON m.cd_ibge = mu.cd_ibge
        )
        SELECT * EXCLUDE (km_fora), round(km_fora, 2) AS km_fora,
            CASE
                WHEN uf = 'ZZ' THEN 'exterior'
                WHEN NOT has_coord THEN 'sem_coordenada'
                WHEN is_shared THEN 'compartilhada'
                WHEN km_fora > {BORDER_TOLERANCE_KM} THEN 'fora_do_municipio'
                WHEN km_fora IS NOT NULL THEN 'borda'
                ELSE 'ok'
            END AS geo_status
        FROM p
        """
    )


def write(con: duckdb.DuckDBPyConnection) -> None:
    SILVER.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY municipios TO '{SILVER / 'municipios.parquet'}' (FORMAT parquet)")
    con.execute(
        f"""
        COPY (SELECT * EXCLUDE (has_coord, is_shared, cd_ibge_ponto) FROM places_flagged ORDER BY place_id)
        TO '{SILVER / "locais_base.parquet"}' (FORMAT parquet)
        """
    )


def run() -> duckdb.DuckDBPyConnection:
    con = connect()
    load_inputs(con)
    build_places(con)
    flag_places(con)
    write(con)
    return finalize(con)


def finalize(con: duckdb.DuckDBPyConnection | None = None) -> duckdb.DuckDBPyConnection:
    """Grava data/silver/locais.parquet com a coordenada final e a fonte de cada uma.

    `geo_fonte`: `tse` (coordenada original), `geocodificado` (Nominatim, dentro do município certo)
    ou nulo (exterior, ou coordenada do TSE inválida sem localização confiável: fica fora do mapa,
    mas os votos continuam nos totais).
    `geo_precisao`: `exata` ou `aproximada` (resposta pelo CEP, que pode cobrir a cidade inteira).
    """
    if con is None:
        con = connect()
        load_inputs(con)
    geocoded = SILVER / "geocodificados.parquet"
    empty = "SELECT NULL::VARCHAR place_id, NULL::VARCHAR consulta, NULL::DOUBLE lat, NULL::DOUBLE lon"
    geo_src = f"'{geocoded}'" if geocoded.exists() else f"({empty})"
    con.execute(
        f"""
        CREATE OR REPLACE TABLE locais AS
        SELECT b.*,
            CASE WHEN b.geo_status IN ('ok', 'borda') THEN 'tse'
                 WHEN g.place_id IS NOT NULL THEN 'geocodificado' END AS geo_fonte,
            g.consulta AS geo_consulta,
            -- CEP de cidade pequena costuma cobrir o município inteiro: conta como aproximado.
            CASE WHEN geo_fonte = 'tse' OR g.consulta IN ('endereco', 'nome') THEN 'exata'
                 WHEN geo_fonte IS NOT NULL THEN 'aproximada' END AS geo_precisao,
            CASE geo_fonte WHEN 'tse' THEN b.lat_tse WHEN 'geocodificado' THEN g.lat END AS lat,
            CASE geo_fonte WHEN 'tse' THEN b.lon_tse WHEN 'geocodificado' THEN g.lon END AS lon
        FROM '{SILVER / "locais_base.parquet"}' b
        LEFT JOIN {geo_src} g USING (place_id)
        """
    )
    con.execute(
        f"COPY (SELECT * FROM locais ORDER BY place_id) TO '{SILVER / 'locais.parquet'}' (FORMAT parquet)"
    )
    return con
