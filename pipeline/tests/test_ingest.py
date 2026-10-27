"""Download com manifesto e conversão CSV (Latin-1, ';') -> Parquet."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import duckdb
import httpx
import pytest
import respx

from urnaporurna import ingest
from urnaporurna.config import Source

CSV = 'NR_TURNO;NM_MUNICIPIO;QT_VOTOS\n"1";"SÃO JOÃO DE MERITI";"0012"\n"2";"NITERÓI";"7"\n'


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(ingest, "RAW", tmp_path / "raw")
    monkeypatch.setattr(ingest, "BRONZE", tmp_path / "bronze")
    monkeypatch.setattr(ingest, "MANIFEST", tmp_path / "manifest.json")
    (tmp_path / "raw").mkdir()
    return tmp_path


def make_zip(path: Path, members: dict[str, str]) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        for name, text in members.items():
            z.writestr(name, text.encode("latin-1"))
    return path


def test_csv_keeps_text_and_accents(data_dir: Path) -> None:
    archive = make_zip(data_dir / "raw" / "v.zip", {"votos_BR.csv": CSV, "leiame.pdf": ""})
    source = Source("v", "https://x/v.zip", {r"votos_BR\.csv$": "votos"})
    assert ingest.to_bronze(source, archive) == {"votos": 2}
    rows = duckdb.sql(f"SELECT * FROM '{data_dir / 'bronze' / 'votos.parquet'}' ORDER BY 1").fetchall()
    assert rows[0] == ("1", "SÃO JOÃO DE MERITI", "0012")  # zeros à esquerda preservados


def test_ambiguous_member_fails(data_dir: Path) -> None:
    archive = make_zip(data_dir / "raw" / "v.zip", {"a_BR.csv": CSV, "a_BRASIL.csv": CSV})
    with pytest.raises(ValueError, match="esperava 1 arquivo"):
        ingest.to_bronze(Source("v", "https://x/v.zip", {r"a_BR": "a"}), archive)


@respx.mock
def test_download_records_manifest(data_dir: Path) -> None:
    respx.get("https://x/v.zip").mock(
        return_value=httpx.Response(200, content=b"abc", headers={"last-modified": "Mon, 26 Oct 2026"})
    )
    path = ingest.download(Source("v", "https://x/v.zip", {}))
    assert path.read_bytes() == b"abc"
    entry = json.loads((data_dir / "manifest.json").read_text())["v"]
    assert entry["bytes"] == 3
    assert entry["sha256"] == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert entry["last_modified"] == "Mon, 26 Oct 2026"
