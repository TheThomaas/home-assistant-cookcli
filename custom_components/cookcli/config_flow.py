"""Config flow pour CookCLI.

Deux chemins d'entrée possibles :
- async_step_hassio : déclenché automatiquement quand l'add-on pousse sa
  découverte via `bashio::discovery.set` (voir README du custom_component).
- async_step_user : saisie manuelle host/port, utile si CookCLI tourne en
  dehors du Supervisor (ex: conteneur Docker autonome sur le réseau local).
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import CookCliApiClient, CookCliApiError
from .const import CONF_HOST, CONF_PORT, DEFAULT_PORT, DOMAIN

_LOGGER = logging.getLogger(__name__)

USER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST): str,
        vol.Required(CONF_PORT, default=DEFAULT_PORT): int,
    }
)


class CookCliConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Gère la création d'une entrée de configuration CookCLI."""

    VERSION = 1

    def __init__(self) -> None:
        self._discovered_config: dict[str, Any] = {}

    async def _async_validate(self, host: str, port: int) -> str | None:
        """Teste la connexion. Retourne un code d'erreur ou None si OK."""
        session = async_get_clientsession(self.hass)
        client = CookCliApiClient(session, host, port)
        try:
            await client.async_test_connection()
        except CookCliApiError:
            _LOGGER.debug("Échec de connexion à CookCLI sur %s:%s", host, port, exc_info=True)
            return "cannot_connect"
        return None

    # ---- Découverte automatique via le Supervisor ----

    async def async_step_hassio(self, discovery_info: Any) -> FlowResult:
        """Point d'entrée quand le Supervisor annonce l'add-on CookCLI."""
        config = discovery_info.config
        host = config["host"]
        port = config.get("port", DEFAULT_PORT)

        await self.async_set_unique_id(f"{host}:{port}")
        self._abort_if_unique_id_configured()

        self._discovered_config = {CONF_HOST: host, CONF_PORT: port}
        self.context["title_placeholders"] = {"host": host}
        return await self.async_step_hassio_confirm()

    async def async_step_hassio_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Demande une confirmation avant de créer l'entrée découverte."""
        if user_input is not None:
            error = await self._async_validate(
                self._discovered_config[CONF_HOST], self._discovered_config[CONF_PORT]
            )
            if error is None:
                return self.async_create_entry(
                    title="CookCLI (add-on)", data=self._discovered_config
                )
            return self.async_show_form(
                step_id="hassio_confirm", errors={"base": error}
            )

        return self.async_show_form(
            step_id="hassio_confirm",
            description_placeholders={
                "host": self._discovered_config.get(CONF_HOST, "")
            },
        )

    # ---- Saisie manuelle ----

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST]
            port = user_input[CONF_PORT]

            await self.async_set_unique_id(f"{host}:{port}")
            self._abort_if_unique_id_configured()

            error = await self._async_validate(host, port)
            if error is None:
                return self.async_create_entry(title=f"CookCLI ({host})", data=user_input)
            errors["base"] = error

        return self.async_show_form(
            step_id="user", data_schema=USER_SCHEMA, errors=errors
        )
