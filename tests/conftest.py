"""Chargement de l'intégration sans Home Assistant.

`api.py` n'importe rien de Home Assistant, mais il fait `from .const import
RELOAD_PORT` : on ne peut donc pas le charger comme un simple fichier isolé. On
construit un paquet synthétique dont `__path__` pointe vers le vrai dossier, ce
qui laisse fonctionner les imports relatifs sans exécuter `__init__.py` (lui
dépend de Home Assistant).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

PACKAGE_DIR = Path(__file__).resolve().parent.parent / "custom_components" / "cookcli"
PACKAGE_NAME = "cookcli_under_test"


@pytest.fixture(scope="session")
def cookcli() -> ModuleType:
    """Le module `api.py` de l'intégration, chargé hors de son package HA."""
    package = ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_DIR)]
    sys.modules[PACKAGE_NAME] = package

    spec = importlib.util.spec_from_file_location(
        f"{PACKAGE_NAME}.api", PACKAGE_DIR / "api.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
