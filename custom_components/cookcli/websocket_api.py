"""Commandes websocket_api pour exposer les recettes CookCLI au frontend.

Deux commandes :
- cookcli/recipes           -> liste des recettes (depuis le coordinator, en cache)
- cookcli/recipe            -> détail d'une recette (appel direct à l'API, pas de cache)

Si plusieurs serveurs CookCLI sont configurés, `entry_id` permet de préciser
lequel interroger ; sinon, le premier configuré est utilisé.

Les deux commandes ajoutent un champ "image_url" déjà prêt à l'emploi pour
un <img src="...">, qui pointe vers CookCliImageView (voir image_proxy.py) —
le frontend n'a pas besoin de connaître le format brut des chemins d'image
renvoyés par CookCLI.

cookcli/recipe repeuple aussi l'entité todo d'ingrédients (todo.py) avec les
ingrédients de la recette ouverte, et renvoie son entity_id dans
"todo_entity_id" pour que le frontend puisse l'afficher avec la carte
native `todo-list`.

cookcli/recipes inclut "view_path" par recette : le slug utilisé comme path
de vue HA, calculé une seule fois ici (voir _view_path) pour que
cookcli-card.js et la dashboard strategy (cookcli-recipe-strategy.js)
naviguent vers le même identifiant sans dupliquer la logique de slug.
"""

from __future__ import annotations

from datetime import timedelta
import re
from urllib.parse import quote

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.http.auth import async_sign_path
from homeassistant.core import HomeAssistant

from .api import CookCliApiError
from .const import DOMAIN


def _resolve_entry(
    hass: HomeAssistant, entry_id: str | None
) -> tuple[str | None, dict | None]:
    entries = hass.data.get(DOMAIN, {})
    if entry_id is not None:
        return entry_id, entries.get(entry_id)
    if entries:
        first_id, first_data = next(iter(entries.items()))
        return first_id, first_data
    return None, None


def _image_url(hass: HomeAssistant, entry_id: str, image_ref: str | None) -> str | None:
    if not image_ref:
        return None
    raw_path = f"/api/cookcli/image/{entry_id}/{quote(image_ref, safe='/')}"
    return async_sign_path(hass, raw_path, timedelta(hours=1))

def _view_path(recipe_path: str) -> str:
    """Slug utilisé comme path de vue HA pour cette recette.

    Calculé une fois ici et renvoyé au frontend (dans "view_path"), pour que
    cookcli-card.js et la dashboard strategy utilisent exactement le même
    identifiant sans dupliquer cette logique en JS des deux côtés.
    Ne gère pas les collisions entre deux recettes qui se slugifieraient
    pareil (rare en pratique, mais à garder en tête).
    """
    base = re.sub(r"\.cook$", "", recipe_path, flags=re.IGNORECASE)
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    return slug or "recette"


def _ingredient_summaries(ingredients: list[dict]) -> list[str]:
    """Formate chaque ingrédient en une ligne lisible pour la checklist."""
    summaries = []
    for ingredient in ingredients:
        quantity = ingredient.get("quantity") or {}
        value = quantity.get("value")
        unit = quantity.get("unit")
        prefix = " ".join(
            str(part) for part in (value, unit) if part not in (None, "")
        )
        name = ingredient.get("name", "")
        summaries.append(f"{prefix} {name}".strip() if prefix else name)
    return summaries


@websocket_api.websocket_command(
    {
        vol.Required("type"): "cookcli/recipes",
        vol.Optional("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_list_recipes(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    entry_id, entry_data = _resolve_entry(hass, msg.get("entry_id"))
    if entry_data is None:
        connection.send_error(msg["id"], "not_found", "Aucune intégration CookCLI configurée")
        return

    coordinator = entry_data["coordinator"]
    recipes = []
    for r in coordinator.data or []:
        metadata = ((r.raw or {}).get("recipe") or {}).get("metadata") or {}
        recipes.append(
            {
                "path": r.path,
                "view_path": _view_path(r.path),
                "name": r.name,
                "time": metadata.get("time"),
                "servings": metadata.get("servings"),
                "tags": metadata.get("tags", []),
                "image_url": _image_url(hass, entry_id, metadata.get("image")),
            }
        )
    connection.send_result(msg["id"], {"recipes": recipes})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "cookcli/recipe",
        vol.Required("path"): str,
        vol.Optional("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_get_recipe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    entry_id, entry_data = _resolve_entry(hass, msg.get("entry_id"))
    if entry_data is None:
        connection.send_error(msg["id"], "not_found", "Aucune intégration CookCLI configurée")
        return

    client = entry_data["client"]
    try:
        recipe = await client.async_get_recipe(msg["path"])
    except CookCliApiError as err:
        connection.send_error(msg["id"], "cannot_connect", str(err))
        return

    recipe["image_url"] = _image_url(hass, entry_id, recipe.get("image"))

    todo_entity = entry_data.get("todo_entity")
    if todo_entity is not None:
        todo_entity.set_ingredients(_ingredient_summaries(recipe.get("ingredients", [])))
        recipe["todo_entity_id"] = todo_entity.entity_id

    connection.send_result(msg["id"], recipe)


def async_setup_websocket_api(hass: HomeAssistant) -> None:
    """Enregistre les commandes websocket. À appeler une seule fois."""
    websocket_api.async_register_command(hass, ws_list_recipes)
    websocket_api.async_register_command(hass, ws_get_recipe)
