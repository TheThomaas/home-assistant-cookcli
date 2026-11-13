"""Aplatissement de l'arborescence `GET /api/recipes` en liste de recettes."""

from __future__ import annotations

from types import ModuleType
from typing import Any

import pytest

from samples import RECIPE_TREE


def test_flat_paths_are_relative_to_root(cookcli: ModuleType) -> None:
    summaries = cookcli.CookCliApiClient._normalize_recipe_list(RECIPE_TREE)
    assert [s.path for s in summaries] == [
        "chocolat-chaud.cook",
        "example/sauces/Hollandaise.cook",
    ]


def test_names_come_from_the_node(cookcli: ModuleType) -> None:
    summaries = cookcli.CookCliApiClient._normalize_recipe_list(RECIPE_TREE)
    assert [s.name for s in summaries] == ["Chocolat chaud", "Hollandaise"]


def test_name_falls_back_to_file_stem(cookcli: ModuleType) -> None:
    tree = {
        "path": "/config/recipes",
        "recipe": None,
        "children": {
            "sans-nom": {
                "path": "/config/recipes/tarte-aux-pommes.cook",
                "recipe": {"metadata": {}},
                "children": {},
            }
        },
    }
    (summary,) = cookcli.CookCliApiClient._normalize_recipe_list(tree)
    assert summary.name == "tarte-aux-pommes"
    assert summary.path == "tarte-aux-pommes.cook"


def test_folders_without_recipe_are_not_listed(cookcli: ModuleType) -> None:
    tree = {
        "path": "/config/recipes",
        "recipe": None,
        "children": {
            "vide": {"path": "/config/recipes/vide", "recipe": None, "children": {}}
        },
    }
    assert cookcli.CookCliApiClient._normalize_recipe_list(tree) == []


def test_missing_or_empty_children(cookcli: ModuleType) -> None:
    without_children = {"path": "/config/recipes", "recipe": None}
    assert cookcli.CookCliApiClient._normalize_recipe_list(without_children) == []

    empty_children = {"path": "/config/recipes", "recipe": None, "children": None}
    assert cookcli.CookCliApiClient._normalize_recipe_list(empty_children) == []


def test_root_node_can_be_a_recipe(cookcli: ModuleType) -> None:
    """Le dossier racine lui-même peut porter une recette (path vide après strip)."""
    tree = {"path": "/config/recipes", "recipe": {"metadata": {}}, "children": {}}
    (summary,) = cookcli.CookCliApiClient._normalize_recipe_list(tree)
    assert summary.path == ""


def test_keeps_path_when_root_is_unknown(cookcli: ModuleType) -> None:
    tree = {
        "recipe": None,
        "children": {
            "x": {"path": "/config/recipes/x.cook", "recipe": {"metadata": {}}}
        },
    }
    (summary,) = cookcli.CookCliApiClient._normalize_recipe_list(tree)
    assert summary.path == "/config/recipes/x.cook"


def test_keeps_path_outside_root(cookcli: ModuleType) -> None:
    tree = {
        "path": "/config/recipes",
        "recipe": None,
        "children": {
            "ailleurs": {"path": "/autre/dossier/x.cook", "recipe": {"metadata": {}}}
        },
    }
    (summary,) = cookcli.CookCliApiClient._normalize_recipe_list(tree)
    assert summary.path == "/autre/dossier/x.cook"


def test_raw_node_is_kept(cookcli: ModuleType) -> None:
    """`raw` sert ensuite à lire metadata.image côté websocket_api."""
    summaries = cookcli.CookCliApiClient._normalize_recipe_list(RECIPE_TREE)
    assert summaries[0].raw["recipe"]["metadata"]["map"]["title"] == "Chocolat chaud"


@pytest.mark.parametrize("payload", [None, [], "recipes", 42, [{"path": "/x"}]])
def test_non_dict_payload_yields_empty_list(cookcli: ModuleType, payload: Any) -> None:
    assert cookcli.CookCliApiClient._normalize_recipe_list(payload) == []


def test_recipe_summary_defaults(cookcli: ModuleType) -> None:
    summary = cookcli.RecipeSummary(path="a.cook", name="A")
    assert summary.raw == {}
