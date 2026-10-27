"""Consultas, cache e a regra de só aceitar ponto dentro do município certo."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from urnaporurna import geocode
from urnaporurna.geocode import Place

PLACE = Place("10001-1-100", "RJ", "NOVA FRIBURGO", "3303401", "ESCOLA ESTADUAL X", "RUA A, 10", "28600000")


def test_queries_in_order_of_precision() -> None:
    kinds = [(k, p) for k, p in geocode.queries(PLACE)]
    assert [k for k, _ in kinds] == ["endereco", "nome", "cep"]
    assert kinds[0][1]["street"] == "Rua A, 10"
    assert kinds[0][1]["state"] == "Rio de Janeiro"
    assert kinds[2][1]["postalcode"] == "28600-000"


def test_no_cep_query_without_valid_cep() -> None:
    p = Place("x", "RJ", "NITERÓI", None, "ESCOLA", None, "00000000")
    assert [k for k, _ in geocode.queries(p)] == ["nome"]


def test_cache_survives_reload(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(geocode, "GEOCODE_CACHE", tmp_path / "cache.jsonl")
    geocode.Cache().put({"q": "a"}, {"lat": 1.0, "lon": 2.0, "label": "A"})
    geocode.Cache().put({"q": "b"}, None)  # "não achou" também fica em cache
    cache = geocode.Cache()
    assert cache.get({"q": "a"}) == {"key": '{"q": "a"}', "result": {"lat": 1.0, "lon": 2.0, "label": "A"}}
    assert cache.get({"q": "b"}) == {"key": '{"q": "b"}', "result": None}


class FakeApi:
    def __init__(self, answers: dict[str, dict[str, Any] | None]) -> None:
        self.answers = answers

    def search(self, params: dict[str, str]) -> dict[str, Any] | None:
        kind = "endereco" if "street" in params else "cep" if "postalcode" in params else "nome"
        return self.answers.get(kind)


def test_resolve_skips_answers_outside_the_municipality(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(geocode, "inside", lambda _con, _cd, lat, _lon: lat < 0)
    api = FakeApi({"endereco": {"lat": 5.0, "lon": 0.0}, "nome": {"lat": -22.0, "lon": -42.0}})
    assert geocode.resolve(None, api, PLACE) == ("nome", -22.0, -42.0)  # type: ignore[arg-type]


def test_resolve_gives_up_when_nothing_fits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(geocode, "inside", lambda *_: False)
    api = FakeApi({"cep": {"lat": -22.0, "lon": -42.0}})
    assert geocode.resolve(None, api, PLACE) is None  # type: ignore[arg-type]


def test_offline_uses_only_the_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(geocode, "GEOCODE_CACHE", tmp_path / "cache.jsonl")
    cache = geocode.Cache()
    cache.put({"q": "a"}, {"lat": 1.0, "lon": 2.0, "label": "A"})
    api = geocode.Nominatim(cache, offline=True)
    assert api.search({"q": "a"}) == {"lat": 1.0, "lon": 2.0, "label": "A"}
    assert api.search({"q": "nunca perguntado"}) is None
    assert api.requests == 0
