"""Coordinator pour l'intégration CookCLI."""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import CookCliApiClient, CookCliApiError, RecipeSummary
from .const import DOMAIN, UPDATE_INTERVAL_MINUTES

_LOGGER = logging.getLogger(__name__)


class CookCliCoordinator(DataUpdateCoordinator[list[RecipeSummary]]):
    """Maintient la liste des recettes à jour."""

    def __init__(self, hass: HomeAssistant, client: CookCliApiClient) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=UPDATE_INTERVAL_MINUTES),
        )
        self.client = client

    async def _async_update_data(self) -> list[RecipeSummary]:
        try:
            return await self.client.async_list_recipes()
        except CookCliApiError as err:
            raise UpdateFailed(f"Erreur en récupérant les recettes CookCLI: {err}") from err
