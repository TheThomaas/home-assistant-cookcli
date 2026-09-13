"""Client API pour le serveur CookCLI.

Endpoints CookCLI utilisés :
- GET /api/recipes        -> arborescence complète des recettes
- GET /api/recipes/{path} -> détail d'une recette (ingredients, steps, metadata)

Format réel confirmé pour GET /api/recipes (arborescence récursive) :

    {
      "name": "recipes", "path": "/config/recipes", "recipe": null,
      "children": {
        "Chocolat chaud": {
          "name": "Chocolat chaud",
          "path": "/config/recipes/chocolat-chaud.cook",
          "recipe": {"metadata": {...}, "source": {...}},
          "children": {}
        },
        "example": {
          "name": "example", "path": "/config/recipes/example", "recipe": null,
          "children": { ... sous-dossiers/recettes imbriqués ... }
        }
      }
    }

Un nœud est une recette si sa clé "recipe" n'est pas null ; sinon c'est un
dossier à parcourir récursivement via "children". `_normalize_recipe_list`
aplatit cette arborescence en une liste de `RecipeSummary`, avec un `path`
relatif au dossier racine (ex: "chocolat-chaud.cook",
"example/sauces/Hollandaise.cook") pour correspondre à ce qu'attend
GET /api/recipes/{path}.

Hypothèse à vérifier : ce path relatif inclut l'extension ".cook", ce qui
correspond au path filesystem brut renvoyé par le serveur. Si
GET /api/recipes/{path} attend un format différent (sans extension, slugifié,
etc.), ajuste `async_get_recipe` en conséquence.

Format réel confirmé pour GET /api/recipes/{path} (détail d'une recette) :
la réponse encapsule un objet `recipe` du parser cooklang-rs, où les listes
`ingredients`/`cookware`/`timers` sont à plat, et les étapes
(`recipe.sections[].content[].value.items[]`) référencent ces objets **par
index** plutôt que de les inclure directement (ex: `{"type": "ingredient",
"index": 0}`). `async_get_recipe` résout ces références côté intégration
avant de renvoyer les données, pour éviter que la carte Lovelace (ou tout
autre consommateur) ait à recroiser les index elle-même.

Les valeurs numériques suivent aussi un format imbriqué
(`{"type": "number", "value": {"type": "regular", "value": 1.0}}`). Seul le
sous-type "regular" a été observé en pratique ; les sous-types "fraction" ou
similaires (non confirmés) sont retournés bruts par `_resolve_value` en cas
de format inconnu, plutôt que de faire planter la résolution.
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
        """Récupère le détail d'une recette, avec étapes déjà résolues.

        La réponse brute de CookCLI référence les ingrédients/ustensiles/
        minuteurs par index dans les étapes ; ce qui est renvoyé ici a déjà
        remplacé ces index par les objets correspondants (voir
        `_resolve_recipe`).
        """
        data = await self._request("GET", f"/recipes/{path}")
        return _resolve_recipe(data)

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
        """Aplatit l'arborescence renvoyée par GET /api/recipes en liste plate."""
        if not isinstance(data, dict):
            _LOGGER.warning(
                "Format de /api/recipes inattendu (attendu un objet, reçu %s)",
                type(data),
            )
            return []

        root_path = data.get("path", "")
        summaries: list[RecipeSummary] = []
        CookCliApiClient._walk_recipe_tree(data, root_path, summaries)
        return summaries

    @staticmethod
    def _walk_recipe_tree(
        node: dict[str, Any], root_path: str, out: list[RecipeSummary]
    ) -> None:
        """Parcourt récursivement un nœud de l'arborescence de recettes."""
        recipe = node.get("recipe")
        if recipe is not None:
            abs_path = node.get("path", "")
            rel_path = abs_path
            if root_path and abs_path.startswith(root_path):
                rel_path = abs_path[len(root_path) :].lstrip("/")
            name = node.get("name") or _name_from_path(rel_path)
            out.append(RecipeSummary(path=rel_path, name=name, raw=node))

        for child in (node.get("children") or {}).values():
            CookCliApiClient._walk_recipe_tree(child, root_path, out)


def _name_from_path(path: str) -> str:
    """Dérive un nom lisible depuis un chemin de fichier .cook."""
    return path.rsplit("/", 1)[-1].removesuffix(".cook")


# ---------------------------------------------------------------------------
# Résolution du détail d'une recette : remplace les références par index
# (ingredient/cookware/timer) par les objets correspondants, et aplatit les
# valeurs numériques imbriquées du parser cooklang-rs.
# ---------------------------------------------------------------------------


def _resolve_number(number_obj: Any) -> Any:
    """Résout un objet 'number' cooklang-rs en valeur simple.

    Seul le sous-type "regular" (nombre décimal simple) a été observé en
    pratique. Les autres sous-types (fractions, valeurs mixtes...) ne sont
    pas confirmés : on renvoie l'objet brut plutôt que de deviner un format.
    """
    if not isinstance(number_obj, dict):
        return number_obj
    if number_obj.get("type") == "regular":
        return number_obj.get("value")
    _LOGGER.debug("Sous-type de nombre non géré, valeur brute conservée: %s", number_obj)
    return number_obj


def _resolve_value(value_obj: Any) -> Any:
    """Résout un objet 'value' générique (nombre, texte...) en valeur simple."""
    if not isinstance(value_obj, dict):
        return value_obj

    value_type = value_obj.get("type")
    inner = value_obj.get("value")

    if value_type == "number":
        return _resolve_number(inner)
    if value_type == "text":
        return inner

    _LOGGER.debug("Type de valeur non géré, valeur brute conservée: %s", value_obj)
    return inner if inner is not None else value_obj


def _resolve_quantity(quantity_obj: Any) -> dict[str, Any] | None:
    """Résout une quantité (ingredient/cookware/timer) en {value, unit}."""
    if not isinstance(quantity_obj, dict):
        return None
    return {
        "value": _resolve_value(quantity_obj.get("value")),
        "unit": quantity_obj.get("unit"),
    }


def _resolve_ingredient(ingredient: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": ingredient.get("name"),
        "quantity": _resolve_quantity(ingredient.get("quantity")),
        "note": ingredient.get("note"),
    }


def _resolve_cookware(cookware: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": cookware.get("name"),
        "quantity": _resolve_quantity(cookware.get("quantity")),
        "note": cookware.get("note"),
    }


def _resolve_timer(timer: dict[str, Any]) -> dict[str, Any]:
    quantity = timer.get("quantity") or {}
    return {
        "name": timer.get("name"),
        "duration": _resolve_value(quantity.get("value")),
        "unit": quantity.get("unit"),
    }


def _resolve_step_item(
    item: dict[str, Any],
    ingredients: list[dict[str, Any]],
    cookware: list[dict[str, Any]],
    timers: list[dict[str, Any]],
) -> dict[str, Any]:
    """Remplace un item d'étape référencé par index par l'objet résolu."""
    item_type = item.get("type")

    if item_type == "text":
        return {"type": "text", "value": item.get("value", "")}

    lookup = {"ingredient": ingredients, "cookware": cookware, "timer": timers}
    if item_type in lookup:
        index = item.get("index")
        objects = lookup[item_type]
        resolved = objects[index] if index is not None and 0 <= index < len(objects) else {}
        if not resolved:
            _LOGGER.debug(
                "Index %s introuvable pour un item de type %s", index, item_type
            )
        return {"type": item_type, **resolved}

    _LOGGER.debug("Type d'item d'étape non géré, conservé brut: %s", item_type)
    return {"type": item_type, "raw": item}


def _resolve_recipe(data: dict[str, Any]) -> dict[str, Any]:
    """Transforme la réponse brute de GET /api/recipes/{path} en structure
    directement exploitable (titre, ingrédients, étapes avec items résolus).
    """
    recipe = data.get("recipe") or {}
    metadata = (recipe.get("metadata") or {}).get("map") or {}

    ingredients = [_resolve_ingredient(i) for i in recipe.get("ingredients", [])]
    cookware = [_resolve_cookware(c) for c in recipe.get("cookware", [])]
    timers = [_resolve_timer(t) for t in recipe.get("timers", [])]

    sections: list[dict[str, Any]] = []
    for section in recipe.get("sections", []):
        steps: list[dict[str, Any]] = []
        for content_item in section.get("content", []):
            if content_item.get("type") != "step":
                _LOGGER.debug(
                    "Type de contenu de section ignoré: %s", content_item.get("type")
                )
                continue
            step_value = content_item.get("value") or {}
            items = [
                _resolve_step_item(it, ingredients, cookware, timers)
                for it in step_value.get("items", [])
            ]
            steps.append({"number": step_value.get("number"), "items": items})
        sections.append({"name": section.get("name"), "steps": steps})

    return {
        "title": metadata.get("title"),
        "image": data.get("image"),
        "scale": data.get("scale"),
        "metadata": metadata,
        "ingredients": ingredients,
        "cookware": cookware,
        "sections": sections,
    }