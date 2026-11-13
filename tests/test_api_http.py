"""Couche HTTP du client CookCLI : URLs, statuts et traduction des erreurs."""

from __future__ import annotations

import asyncio
from types import ModuleType

import aiohttp
import pytest

from fakes import FakeResponse, FakeSession
from samples import RECIPE_DETAIL, RECIPE_TREE

HOST = "192.168.1.20"
PORT = 9081


def client(cookcli: ModuleType, session: FakeSession):
    return cookcli.CookCliApiClient(session, HOST, PORT)


def test_list_recipes_hits_the_api_and_flattens(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(payload=RECIPE_TREE))
    summaries = asyncio.run(client(cookcli, session).async_list_recipes())

    assert session.calls[0]["url"] == f"http://{HOST}:{PORT}/api/recipes"
    assert session.calls[0]["method"] == "GET"
    assert [s.path for s in summaries] == [
        "chocolat-chaud.cook",
        "example/sauces/Hollandaise.cook",
    ]


def test_get_recipe_resolves_indexes(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(payload=RECIPE_DETAIL))
    recipe = asyncio.run(
        client(cookcli, session).async_get_recipe("pates-carbonara.cook")
    )

    assert session.calls[0]["url"] == (
        f"http://{HOST}:{PORT}/api/recipes/pates-carbonara.cook"
    )
    assert recipe["title"] == "Pâtes carbonara"
    assert recipe["sections"][0]["steps"][0]["items"][1]["name"] == "spaghetti"


def test_test_connection_goes_through_the_recipe_list(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(payload=RECIPE_TREE))
    asyncio.run(client(cookcli, session).async_test_connection())
    assert session.calls[0]["url"].endswith("/api/recipes")


def test_http_error_status(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(status=404))
    with pytest.raises(cookcli.CookCliResponseError, match="404"):
        asyncio.run(client(cookcli, session).async_list_recipes())


def test_server_error_status(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(status=500))
    with pytest.raises(cookcli.CookCliResponseError):
        asyncio.run(client(cookcli, session).async_get_recipe("x.cook"))


def test_non_json_response(cookcli: ModuleType) -> None:
    session = FakeSession(
        response=FakeResponse(json_error=ValueError("pas du JSON"))
    )
    with pytest.raises(cookcli.CookCliResponseError, match="non-JSON"):
        asyncio.run(client(cookcli, session).async_list_recipes())


def test_client_error_becomes_connection_error(cookcli: ModuleType) -> None:
    session = FakeSession(error=aiohttp.ClientConnectionError("refusé"))
    with pytest.raises(cookcli.CookCliConnectionError):
        asyncio.run(client(cookcli, session).async_list_recipes())


def test_timeout_becomes_connection_error(cookcli: ModuleType) -> None:
    session = FakeSession(error=asyncio.TimeoutError())
    with pytest.raises(cookcli.CookCliConnectionError, match="Timeout"):
        asyncio.run(client(cookcli, session).async_list_recipes())


def test_errors_share_a_common_base(cookcli: ModuleType) -> None:
    assert issubclass(cookcli.CookCliConnectionError, cookcli.CookCliApiError)
    assert issubclass(cookcli.CookCliResponseError, cookcli.CookCliApiError)


def test_default_timeout_is_ten_seconds(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(payload=RECIPE_TREE))
    asyncio.run(client(cookcli, session).async_list_recipes())
    assert session.calls[0]["timeout"].total == 10


def test_reload_posts_to_the_reload_port(cookcli: ModuleType) -> None:
    session = FakeSession()
    asyncio.run(client(cookcli, session).async_reload())

    assert session.calls[0]["method"] == "POST"
    assert session.calls[0]["url"] == f"http://{HOST}:8098/reload"
    assert session.calls[0]["timeout"].total == 120


def test_reload_error_is_translated(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(status=503))
    with pytest.raises(cookcli.CookCliResponseError):
        asyncio.run(client(cookcli, session).async_reload())


@pytest.mark.parametrize(
    ("image_ref", "expected"),
    [
        ("/api/static/img/x.jpg", "/static/img/x.jpg"),
        ("/img/x.jpg", "/static/img/x.jpg"),
        ("img/x.jpg", "/static/img/x.jpg"),
        ("/static/img/x.jpg", "/static/static/img/x.jpg"),
    ],
)
def test_image_endpoint_normalisation(
    cookcli: ModuleType, image_ref: str, expected: str
) -> None:
    assert cookcli.CookCliApiClient._image_endpoint(image_ref) == expected


def test_get_image_returns_bytes_and_content_type(cookcli: ModuleType) -> None:
    session = FakeSession(
        response=FakeResponse(
            body=b"\xff\xd8jpeg", headers={"Content-Type": "image/jpeg"}
        )
    )
    data, content_type = asyncio.run(
        client(cookcli, session).async_get_image("/img/carbonara.jpg")
    )

    assert data == b"\xff\xd8jpeg"
    assert content_type == "image/jpeg"
    # `_get` préfixe l'URL de base, qui inclut déjà `/api`.
    assert session.calls[0]["url"] == (
        f"http://{HOST}:{PORT}/api/static/img/carbonara.jpg"
    )


def test_get_image_without_content_type(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(body=b"png"))
    _, content_type = asyncio.run(
        client(cookcli, session).async_get_image("/api/static/img/x.png")
    )
    assert content_type is None


def test_get_image_error_is_translated(cookcli: ModuleType) -> None:
    session = FakeSession(response=FakeResponse(status=404))
    with pytest.raises(cookcli.CookCliResponseError):
        asyncio.run(client(cookcli, session).async_get_image("/img/absent.jpg"))
