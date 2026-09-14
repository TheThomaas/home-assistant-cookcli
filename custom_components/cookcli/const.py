"""Constantes pour l'intégration CookCLI."""

DOMAIN = "cookcli"

CONF_HOST = "host"
CONF_PORT = "port"

DEFAULT_PORT = 9081

# Nom du service tel que poussé par bashio::discovery.set côté add-on
HASSIO_DISCOVERY_SLUG = "cookcli"

# Intervalle de rafraîchissement de la liste des recettes.
# Les fichiers .cook ne changent qu'après un sync git côté add-on,
# donc pas besoin de poller souvent.
UPDATE_INTERVAL_MINUTES = 15

PLATFORMS: list[str] = ["todo"]
