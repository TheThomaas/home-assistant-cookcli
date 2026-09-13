"""Client API pour le serveur CookCLI.

Endpoints CookCLI utilisés :
- GET /api/recipes        -> liste/arborescence des recettes
- GET /api/recipes/{path} -> détail d'une recette (ingredients, steps, metadata)

Le endpoint de liste n'a pas pu être vérifié à 100% depuis les sources au
moment de l'écriture de ce client : le format exact (liste plate vs
arborescence de dossiers) doit être confirmé avec un `curl` réel contre le
serveur, ex :

    curl http://<ip-addon>:9081/api/recipes | jq

`_normalize_recipe_list` ci-dessous encaisse les deux formes les plus
probables ; ajuste-le si le format réel diffère.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

DEFAULT_TIMEOUT = aiohttp.ClientTimeout(total=10)


class CookCliApiError(Exception):
    """Erreur générique lors d'un appel à l'API CookCLI."""


class CookCliConnectionError(CookCliApiError):
    """Le serveur CookCLI est injoignable."""


class CookCliResponseError(CookCliApiError):
    """Le serveur a répondu avec un statut d'erreur ou un contenu invalide."""


@dataclass
class RecipeSummary:
    """Représentation minimale d'une recette pour la liste navigable."""

    path: str
    name: str
    raw: dict[str, Any] = field(default_factory=dict)


class CookCliApiClient:
    """Wrapper HTTP autour de l'API CookCLI."""

    def __init__(self, session: aiohttp.ClientSession, host: str, port: int) -> None:
        self._session = session
        self._base_url = f"http://{host}:{port}/api"

    async def async_test_connection(self) -> None:
        """Vérifie que le serveur répond, utilisé par le config_flow."""
        await self.async_list_recipes()

    async def async_list_recipes(self) -> list[RecipeSummary]:
        """Récupère la liste des recettes disponibles."""
        data = await self._request("GET", "/recipes")
        return self._normalize_recipe_list(data)

    async def async_get_recipe(self, path: str) -> dict[str, Any]:
        """Récupère le détail complet d'une recette (ingredients + steps)."""
        return await self._request("GET", f"/recipes/{path}")

    async def _request(self, method: str, endpoint: str) -> Any:
        url = f"{self._base_url}{endpoint}"
        try:
            async with self._session.request(
                method, url, timeout=DEFAULT_TIMEOUT
            ) as resp:
                if resp.status >= 400:
                    raise CookCliResponseError(
                        f"CookCLI a répondu {resp.status} pour {url}"
                    )
                try:
                    return await resp.json()
                except (aiohttp.ContentTypeError, ValueError) as err:
                    raise CookCliResponseError(
                        f"Réponse non-JSON de CookCLI pour {url}"
                    ) from err
        except asyncio.TimeoutError as err:
            raise CookCliConnectionError(f"Timeout en contactant {url}") from err
        except aiohttp.ClientError as err:
            raise CookCliConnectionError(f"Impossible de joindre {url}: {err}") from err

    @staticmethod
    def _normalize_recipe_list(data: Any) -> list[RecipeSummary]:
        """Normalise la réponse de listing en une liste plate de RecipeSummary.

        Encaisse plusieurs formes possibles :
        - une liste de chemins/objets directement
        - un dict avec une clé "recipes" ou "index"
        - une arborescence imbriquée par dossier
        """
        items: list[Any]
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("recipes") or data.get("index") or []
        else:
            items = []

        summaries: list[RecipeSummary] = []
        for item in items:
            if isinstance(item, str):
                summaries.append(RecipeSummary(path=item, name=_name_from_path(item)))
            elif isinstance(item, dict):
                path = item.get("path") or item.get("slug") or item.get("name", "")
                name = item.get("name") or _name_from_path(path)
                summaries.append(RecipeSummary(path=path, name=name, raw=item))
            else:
                _LOGGER.debug("Entrée de recette ignorée (format inattendu): %s", item)

        return summaries


def _name_from_path(path: str) -> str:
    """Dérive un nom lisible depuis un chemin de fichier .cook."""
    return path.rsplit("/", 1)[-1].removesuffix(".cook")
