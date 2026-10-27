"""Download das fontes e conversão dos CSVs para Parquet (camada bronze).

Cada arquivo baixado fica registrado no manifesto (URL, tamanho, SHA-256, data do download,
Last-Modified do servidor), para que qualquer pessoa confira que usamos os mesmos dados.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Any

import duckdb
import httpx

from urnaporurna.config import BRONZE, MANIFEST, RAW, USER_AGENT, Source

CHUNK = 1 << 20


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(CHUNK):
            h.update(block)
    return h.hexdigest()


def load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}


def save_manifest(manifest: dict[str, Any]) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


def download(source: Source, force: bool = False) -> Path:
    """Baixa o arquivo da fonte para data/raw/. Pula se já existe (a não ser com force)."""
    dest = RAW / source.url.rsplit("/", 1)[-1]
    if dest.exists() and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    headers = {"User-Agent": USER_AGENT}
    with httpx.stream("GET", source.url, headers=headers, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        last_modified = r.headers.get("last-modified")
        with part.open("wb") as f:
            for block in r.iter_bytes(CHUNK):
                f.write(block)
    part.rename(dest)

    manifest = load_manifest()
    manifest[source.name] = {
        "url": source.url,
        "file": dest.name,
        "bytes": dest.stat().st_size,
        "sha256": sha256(dest),
        "last_modified": last_modified,
        "downloaded_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    save_manifest(manifest)
    return dest


def csv_to_parquet(csv: Path, parquet: Path, encoding: str = "latin-1") -> int:
    """Converte um CSV (separador ';') em Parquet, mantendo tudo como texto."""
    parquet.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(
        f"""
        COPY (
            SELECT * FROM read_csv('{csv}', delim=';', quote='"', encoding='{encoding}',
                                   header=true, all_varchar=true)
        ) TO '{parquet}' (FORMAT parquet, COMPRESSION zstd)
        """
    )
    row = con.execute(f"SELECT count(*) FROM '{parquet}'").fetchone()
    con.close()
    return int(row[0]) if row else 0


def extract(src: IO[bytes], dest: Path, encoding: str) -> str:
    """Copia o CSV do zip. O DuckDB só lê UTF-8 e Latin-1: outras codificações viram UTF-8 aqui."""
    if encoding in ("latin-1", "utf-8"):
        with dest.open("wb") as dst:
            shutil.copyfileobj(src, dst, CHUNK)
        return encoding
    with (
        io.TextIOWrapper(src, encoding=encoding, newline="") as text,
        dest.open("w", encoding="utf-8", newline="") as dst,
    ):
        shutil.copyfileobj(text, dst, CHUNK)
    return "utf-8"


def to_bronze(source: Source, archive: Path) -> dict[str, int]:
    """Extrai os CSVs escolhidos do zip e grava cada um como Parquet em data/bronze/."""
    rows: dict[str, int] = {}
    if not source.members:  # arquivo lido direto (shapefile, GeoPackage)
        return rows
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        for pattern, table in source.members.items():
            matches = [n for n in names if re.search(pattern, n)]
            if len(matches) != 1:
                raise ValueError(f"{source.name}: esperava 1 arquivo para {pattern!r}, achei {matches}")
            with tempfile.TemporaryDirectory(dir=RAW) as tmp:
                csv = Path(tmp) / Path(matches[0]).name
                with z.open(matches[0]) as src:
                    encoding = extract(src, csv, source.encoding)
                rows[table] = csv_to_parquet(csv, BRONZE / f"{table}.parquet", encoding)
    return rows
