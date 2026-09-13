"""Intégration CookCLI pour Home Assistant."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import CookCliApiClient, CookCliApiError
from .const import CONF_HOST, CONF_PORT, DOMAIN, PLATFORMS
from .coordinator import CookCliCoordinator
from .websocket_api import async_setup_websocket_api

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Initialise CookCLI à partir d'une entrée de configuration."""
    session = async_get_clientsession(hass)
    client = CookCliApiClient(
        session, entry.data[CONF_HOST], entry.data[CONF_PORT]
    )

    coordinator = CookCliCoordinator(hass, client)

    try:
        await coordinator.async_config_entry_first_refresh()
    except CookCliApiError as err:
        _LOGGER.warning("CookCLI injoignable au démarrage: %s", err)
        raise

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "client": client,
        "coordinator": coordinator,
    }

    # Les commandes websocket sont globales au domaine, on ne les enregistre
    # qu'une seule fois même si plusieurs serveurs CookCLI sont configurés.
    if len(hass.data[DOMAIN]) == 1:
        async_setup_websocket_api(hass)

    if PLATFORMS:
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Décharge une entrée de configuration CookCLI."""
    unload_ok = True
    if PLATFORMS:
        unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Recharge l'entrée si ses options changent (host/port modifiés)."""
    await hass.config_entries.async_reload(entry.entry_id)
