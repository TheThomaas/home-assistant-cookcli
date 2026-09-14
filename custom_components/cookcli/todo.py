"""Plateforme to-do : une checklist d'ingrédients par entrée CookCLI.

Une seule entité par serveur CookCLI configuré (pas une par recette) : elle
est repeuplée avec les ingrédients de la recette qu'on vient d'ouvrir à
chaque appel de `cookcli/recipe` (voir websocket_api.py), et affichée dans
la vue générée par la view strategy avec la carte native `todo-list`.

Seule la case à cocher est éditable par l'utilisateur (UPDATE_TODO_ITEM) —
pas d'ajout/suppression manuel, la liste est entièrement dérivée de la
recette ouverte.
"""

from __future__ import annotations

import logging

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Crée l'entité todo pour cette entrée de configuration."""
    entity = CookCliIngredientsTodoListEntity(entry)
    hass.data[DOMAIN][entry.entry_id]["todo_entity"] = entity
    async_add_entities([entity])


class CookCliIngredientsTodoListEntity(TodoListEntity):
    """Checklist des ingrédients de la recette actuellement affichée."""

    _attr_has_entity_name = True
    _attr_name = "Ingrédients à rassembler"
    _attr_supported_features = TodoListEntityFeature.UPDATE_TODO_ITEM

    def __init__(self, entry: ConfigEntry) -> None:
        self._attr_unique_id = f"{entry.entry_id}_ingredients"
        self._attr_todo_items: list[TodoItem] = []

    async def async_update_todo_item(self, item: TodoItem) -> None:
        """Coche/décoche un ingrédient — seule modification permise ici."""
        items = list(self._attr_todo_items or [])
        for index, existing in enumerate(items):
            if existing.uid == item.uid:
                items[index] = item
                break
        self._attr_todo_items = items
        self.async_write_ha_state()

    def set_ingredients(self, summaries: list[str]) -> None:
        """Remplace toute la liste par les ingrédients de la recette ouverte.

        Appelé depuis websocket_api.py à chaque `cookcli/recipe` — pas partie
        de l'API TodoListEntity standard, c'est notre propre point d'entrée.
        """
        self._attr_todo_items = [
            TodoItem(uid=str(i), summary=summary, status=TodoItemStatus.NEEDS_ACTION)
            for i, summary in enumerate(summaries)
        ]
        self.async_write_ha_state()
