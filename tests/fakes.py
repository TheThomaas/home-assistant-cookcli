"""Doublures minimales de `aiohttp.ClientSession` : ni serveur, ni Home Assistant."""

from __future__ import annotations

from typing import Any


class FakeResponse:
    """Réponse aiohttp réduite à ce que `api.py` consomme."""

    def __init__(
        self,
        *,
        status: int = 200,
        payload: Any = None,
        body: bytes = b"",
        headers: dict[str, str] | None = None,
        json_error: Exception | None = None,
    ) -> None:
        self.status = status
        self.headers = headers or {}
        self._payload = payload
        self._body = body
        self._json_error = json_error

    async def json(self) -> Any:
        if self._json_error is not None:
            raise self._json_error
        return self._payload

    async def read(self) -> bytes:
        return self._body


class _RequestContext:
    """Ce que renvoie `session.request(...)`, utilisé en `async with`."""

    def __init__(
        self, response: FakeResponse | None, error: Exception | None
    ) -> None:
        self._response = response
        self._error = error

    async def __aenter__(self) -> FakeResponse:
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response

    async def __aexit__(self, *exc_info: object) -> bool:
        return False


class FakeSession:
    """Session factice : enregistre les appels, renvoie une réponse ou lève une erreur."""

    def __init__(
        self,
        *,
        response: FakeResponse | None = None,
        error: Exception | None = None,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self._response = response if response is not None else FakeResponse(payload={})
        self._error = error

    def request(self, method: str, url: str, **kwargs: Any) -> _RequestContext:
        self.calls.append({"method": method, "url": url, **kwargs})
        return _RequestContext(self._response, self._error)
