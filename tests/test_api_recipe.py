"""Résolution du détail d'une recette : références par index et valeurs imbriquées."""

from __future__ import annotations

from types import ModuleType
from typing import Any

import pytest

from samples import RECIPE_DETAIL


def test_header_fields(cookcli: ModuleType) -> None:
    recipe = cookcli._resolve_recipe(RECIPE_DETAIL)
    assert recipe["title"] == "Pâtes carbonara"
    assert recipe["image"] == "/api/static/img/carbonara.jpg"
    assert recipe["scale"] == 2
    assert recipe["metadata"]["servings"] == "4"


def test_ingredients_quantities_are_unwrapped(cookcli: ModuleType) -> None:
    ingredients = cookcli._resolve_recipe(RECIPE_DETAIL)["ingredients"]
    assert ingredients[0] == {
        "name": "spaghetti",
        "quantity": {"value": 400.0, "unit": "g"},
        "note": None,
    }
    assert ingredients[1]["note"] == "fumés"
    assert ingredients[2]["quantity"] == {"value": 4.0, "unit": None}


def test_cookware_without_quantity(cookcli: ModuleType) -> None:
    (pan,) = cookcli._resolve_recipe(RECIPE_DETAIL)["cookware"]
    assert pan == {"name": "poêle", "quantity": None, "note": None}


def test_timer_is_resolved_inline_only(cookcli: ModuleType) -> None:
    """Les minuteurs ne sont pas exposés à la racine : ils vivent dans les étapes."""
    recipe = cookcli._resolve_recipe(RECIPE_DETAIL)
    assert "timers" not in recipe
    timer_item = recipe["sections"][0]["steps"][1]["items"][3]
    assert timer_item == {
        "type": "timer",
        "name": "cuisson",
        "duration": 9.0,
        "unit": "minutes",
    }


def test_step_items_resolution(cookcli: ModuleType) -> None:
    sections = cookcli._resolve_recipe(RECIPE_DETAIL)["sections"]
    first_step = sections[0]["steps"][0]
    assert first_step["number"] == 1
    assert first_step["items"] == [
        {"type": "text", "value": "Cuire les "},
        {
            "type": "ingredient",
            "name": "spaghetti",
            "quantity": {"value": 400.0, "unit": "g"},
            "note": None,
        },
        {"type": "text", "value": " dans l'eau bouillante."},
    ]


def test_timer_reference_inside_a_step(cookcli: ModuleType) -> None:
    sections = cookcli._resolve_recipe(RECIPE_DETAIL)["sections"]
    items = sections[0]["steps"][1]["items"]
    assert items[3] == {
        "type": "timer",
        "name": "cuisson",
        "duration": 9.0,
        "unit": "minutes",
    }


def test_cookware_reference_inside_a_step(cookcli: ModuleType) -> None:
    sections = cookcli._resolve_recipe(RECIPE_DETAIL)["sections"]
    assert sections[1]["name"] == "Finition"
    assert sections[1]["steps"][0]["items"][1] == {
        "type": "cookware",
        "name": "poêle",
        "quantity": None,
        "note": None,
    }


def test_section_names_and_step_numbers_are_kept(cookcli: ModuleType) -> None:
    sections = cookcli._resolve_recipe(RECIPE_DETAIL)["sections"]
    assert [s["name"] for s in sections] == [None, "Finition"]
    assert [s["steps"][0]["number"] for s in sections] == [1, 3]


def test_out_of_range_index_yields_empty_object(cookcli: ModuleType) -> None:
    payload = {
        "recipe": {
            "ingredients": [{"name": "sel", "quantity": None, "note": None}],
            "sections": [
                {
                    "content": [
                        {
                            "type": "step",
                            "value": {
                                "number": 1,
                                "items": [{"type": "ingredient", "index": 7}],
                            },
                        }
                    ]
                }
            ],
        }
    }
    items = cookcli._resolve_recipe(payload)["sections"][0]["steps"][0]["items"]
    assert items == [{"type": "ingredient"}]


def test_item_without_index_yields_empty_object(cookcli: ModuleType) -> None:
    payload = {
        "recipe": {
            "ingredients": [{"name": "sel"}],
            "sections": [
                {"content": [{"type": "step", "value": {"items": [{"type": "ingredient"}]}}]}
            ],
        }
    }
    items = cookcli._resolve_recipe(payload)["sections"][0]["steps"][0]["items"]
    assert items == [{"type": "ingredient"}]


def test_negative_index_is_rejected(cookcli: ModuleType) -> None:
    """Un index négatif ne doit pas se comporter comme un accès Python depuis la fin."""
    payload = {
        "recipe": {
            "ingredients": [{"name": "sel"}, {"name": "poivre"}],
            "sections": [
                {
                    "content": [
                        {
                            "type": "step",
                            "value": {"number": 1, "items": [{"type": "ingredient", "index": -1}]},
                        }
                    ]
                }
            ],
        }
    }
    items = cookcli._resolve_recipe(payload)["sections"][0]["steps"][0]["items"]
    assert items == [{"type": "ingredient"}]


def test_unknown_item_type_is_kept_raw(cookcli: ModuleType) -> None:
    payload = {
        "recipe": {
            "sections": [
                {
                    "content": [
                        {
                            "type": "step",
                            "value": {
                                "number": 1,
                                "items": [{"type": "note", "value": "à part"}],
                            },
                        }
                    ]
                }
            ]
        }
    }
    items = cookcli._resolve_recipe(payload)["sections"][0]["steps"][0]["items"]
    assert items == [{"type": "note", "raw": {"type": "note", "value": "à part"}}]


def test_non_step_section_content_is_ignored(cookcli: ModuleType) -> None:
    payload = {
        "recipe": {
            "sections": [
                {
                    "name": None,
                    "content": [
                        {"type": "text", "value": "blabla"},
                        {"type": "step", "value": {"number": 1, "items": []}},
                    ],
                }
            ]
        }
    }
    steps = cookcli._resolve_recipe(payload)["sections"][0]["steps"]
    assert len(steps) == 1


def test_text_item_without_value_defaults_to_empty(cookcli: ModuleType) -> None:
    payload = {
        "recipe": {
            "sections": [
                {"content": [{"type": "step", "value": {"items": [{"type": "text"}]}}]}
            ]
        }
    }
    items = cookcli._resolve_recipe(payload)["sections"][0]["steps"][0]["items"]
    assert items == [{"type": "text", "value": ""}]


def test_empty_payload(cookcli: ModuleType) -> None:
    recipe = cookcli._resolve_recipe({})
    assert recipe == {
        "title": None,
        "image": None,
        "scale": None,
        "metadata": {},
        "ingredients": [],
        "cookware": [],
        "sections": [],
    }


@pytest.mark.parametrize(
    "number",
    [
        {"type": "regular", "value": 1.5},
        {"type": "fraction", "num": 1, "den": 3},
        {"value": 2.0},
    ],
)
def test_number_subtypes(cookcli: ModuleType, number: dict[str, Any]) -> None:
    """Seul "regular" est déplié ; les autres formes restent brutes."""
    result = cookcli._resolve_number(number)
    if number.get("type") == "regular":
        assert result == number["value"]
    else:
        assert result == number


def test_resolve_number_passthrough_for_non_dict(cookcli: ModuleType) -> None:
    assert cookcli._resolve_number(3) == 3


def test_resolve_value_unknown_type(cookcli: ModuleType) -> None:
    assert cookcli._resolve_value({"type": "inconnu", "value": "x"}) == "x"
    assert cookcli._resolve_value({"type": "inconnu"}) == {"type": "inconnu"}
    assert cookcli._resolve_value("brut") == "brut"


def test_resolve_value_text(cookcli: ModuleType) -> None:
    assert cookcli._resolve_value({"type": "text", "value": "deux"}) == "deux"


def test_resolve_quantity_non_dict(cookcli: ModuleType) -> None:
    assert cookcli._resolve_quantity(None) is None
    assert cookcli._resolve_quantity("2 g") is None


def test_timer_without_quantity(cookcli: ModuleType) -> None:
    assert cookcli._resolve_timer({"name": "repos"}) == {
        "name": "repos",
        "duration": None,
        "unit": None,
    }
