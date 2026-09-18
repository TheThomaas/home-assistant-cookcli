"""Proxy HTTP pour les images statiques de CookCLI.

Le navigateur ne peut pas atteindre le serveur CookCLI directement (ni le
port ingress 9080, restreint à l'IP du Supervisor par nginx, ni le port
direct 9081, non publié sur le LAN). Seul le backend Home Assistant, sur le
même réseau Docker interne que l'add-on, peut le faire. Cette vue relaie
donc les octets de l'image en passant par ce backend.
"""

from __future__ import annotations

import logging

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .api import CookCliApiError
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class CookCliImageView(HomeAssistantView):
    """GET /api/cookcli/image/{entry_id}/{image_ref}?authSig=... -> octets de l'image."""

    url = "/api/cookcli/image/{entry_id}{image_ref:.*}"
    name = "api:cookcli:image"
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(
        self, request: web.Request, entry_id: str, image_ref: str
    ) -> web.Response:
        entry_data = self.hass.data.get(DOMAIN, {}).get(entry_id)
        if entry_data is None:
            return web.Response(status=404, text="Intégration CookCLI introuvable")

        client = entry_data["client"]
        try:
            data, content_type = await client.async_get_image(image_ref)
        except CookCliApiError as err:
            _LOGGER.debug("Échec de récupération de l'image %s: %s", image_ref, err)
            return web.Response(status=502, text="Impossible de récupérer l'image")

        return web.Response(
            body=data,
            content_type=content_type or "application/octet-stream",
            headers={"Cache-Control": "max-age=3600"},
        )
