"""Intégration CookCLI pour Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path
import voluptuous as vol

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED

from .api import CookCliApiClient, CookCliApiError
from .const import CONF_HOST, CONF_PORT, DOMAIN
# from .const import CONF_HOST, CONF_PORT, DOMAIN, PLATFORMS
from .coordinator import CookCliCoordinator
from .image_proxy import CookCliImageView
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

    # Les commandes websocket, la vue de proxy d'images et les chemins
    # statiques sont globaux au domaine : on ne les enregistre qu'une
    # seule fois, même si plusieurs serveurs CookCLI sont configurés.
    if len(hass.data[DOMAIN]) == 1:
        async_setup_websocket_api(hass)
        hass.http.register_view(CookCliImageView(hass))

        www_path = Path(__file__).parent / "www"
        card_file = www_path / "cookcli-card.js"
        strategy_file = www_path / "cookcli-recipe-strategy.js"

        await hass.http.async_register_static_paths([
            StaticPathConfig(
                f"/api/{DOMAIN}/cookcli-card.js",
                str(card_file),
                cache_headers=False,
            ),
            StaticPathConfig(
                f"/api/{DOMAIN}/cookcli-recipe-strategy.js",
                str(strategy_file),
                cache_headers=False,
            ),
        ])

    # if PLATFORMS:
    #     await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    return True


async def async_setup(hass: HomeAssistant, config) -> bool:
    """Enregistrement global, appelé une seule fois au démarrage de HA."""

    async def _register_card_resources(event=None):
        """Enregistre la carte et la stratégie comme ressources Lovelace."""
        lovelace = hass.data.get("lovelace")
        if not lovelace or not hasattr(lovelace, "resources"):
            _LOGGER.warning(
                "Lovelace resources indisponibles, carte CookCLI non enregistrée"
            )
            return

        resources = lovelace.resources
        base_url = f"/api/{DOMAIN}"

        urls_to_register = [
            f"{base_url}/cookcli-card.js",
            f"{base_url}/cookcli-recipe-strategy.js",
        ]

        existing_urls = {r.get("url", "") for r in resources.async_items()}

        for url in urls_to_register:
            if url not in existing_urls:
                await resources.async_create_item({
                    "url": url,
                    "res_type": "module",
                })
                _LOGGER.info("Ressource Lovelace CookCLI enregistrée: %s", url)

    hass.bus.async_listen_once(
        EVENT_HOMEASSISTANT_STARTED, _register_card_resources
    )

    async def _handle_reload(call: ServiceCall) -> None:
        """cookcli.reload : resynchronise l'add-on puis rafraîchit la liste."""
        entries = hass.data.get(DOMAIN, {})
        requested = call.data.get("entry_id")

        if requested is not None:
            if requested not in entries:
                raise ServiceValidationError(f"Serveur CookCLI inconnu : {requested}")
            targets = {requested: entries[requested]}
        else:
            targets = dict(entries)

        for entry_id, data in targets.items():
            try:
                await data["client"].async_reload()
            except CookCliApiError as err:
                raise HomeAssistantError(f"Reload CookCLI impossible : {err}") from err
            await data["coordinator"].async_refresh()
            # Les cartes ouvertes écoutent cet événement pour recharger leur liste.
            hass.bus.async_fire(f"{DOMAIN}_reloaded", {"entry_id": entry_id})

    hass.services.async_register(
        DOMAIN,
        "reload",
        _handle_reload,
        schema=vol.Schema({vol.Optional("entry_id"): str}),
    )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Décharge une entrée de configuration CookCLI."""
    unload_ok = True
    # if PLATFORMS:
    #     unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Recharge l'entrée si ses options changent (host/port modifiés)."""
    await hass.config_entries.async_reload(entry.entry_id)