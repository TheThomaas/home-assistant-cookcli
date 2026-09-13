"""Commandes websocket_api pour exposer les recettes CookCLI au frontend.

Deux commandes :
- cookcli/recipes           -> liste des recettes (depuis le coordinator, en cache)
- cookcli/recipe            -> détail d'une recette (appel direct à l'API, pas de cache)

Si plusieurs serveurs CookCLI sont configurés, `entry_id` permet de préciser
lequel interroger ; sinon, le premier configuré est utilisé.
"""

from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .api import CookCliApiError
from .const import DOMAIN


def _resolve_entry_data(hass: HomeAssistant, entry_id: str | None) -> dict | None:
    entries = hass.data.get(DOMAIN, {})
    if entry_id is not None:
        return entries.get(entry_id)
    if entries:
        return next(iter(entries.values()))
    return None


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
    entry_data = _resolve_entry_data(hass, msg.get("entry_id"))
    if entry_data is None:
        connection.send_error(msg["id"], "not_found", "Aucune intégration CookCLI configurée")
        return

    coordinator = entry_data["coordinator"]
    connection.send_result(
        msg["id"],
        {
            "recipes": [
                {"path": r.path, "name": r.name} for r in coordinator.data or []
            ]
        },
    )


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
    entry_data = _resolve_entry_data(hass, msg.get("entry_id"))
    if entry_data is None:
        connection.send_error(msg["id"], "not_found", "Aucune intégration CookCLI configurée")
        return

    client = entry_data["client"]
    try:
        recipe = await client.async_get_recipe(msg["path"])
    except CookCliApiError as err:
        connection.send_error(msg["id"], "cannot_connect", str(err))
        return

    connection.send_result(msg["id"], recipe)


def async_setup_websocket_api(hass: HomeAssistant) -> None:
    """Enregistre les commandes websocket. À appeler une seule fois."""
    websocket_api.async_register_command(hass, ws_list_recipes)
    websocket_api.async_register_command(hass, ws_get_recipe)
