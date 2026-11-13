"""Charges utiles reproduisant les formats réels documentés dans `api.py`.

Arborescence de `GET /api/recipes` (nœud = recette si `recipe` non nul) et
détail de `GET /api/recipes/{path}` (références par index dans les étapes,
valeurs numériques imbriquées du parser cooklang-rs).
"""

from __future__ import annotations

from typing import Any

RECIPE_TREE: dict[str, Any] = {
    "name": "recipes",
    "path": "/config/recipes",
    "recipe": None,
    "children": {
        "Chocolat chaud": {
            "name": "Chocolat chaud",
            "path": "/config/recipes/chocolat-chaud.cook",
            "recipe": {"metadata": {"map": {"title": "Chocolat chaud"}}},
            "children": {},
        },
        "example": {
            "name": "example",
            "path": "/config/recipes/example",
            "recipe": None,
            "children": {
                "sauces": {
                    "name": "sauces",
                    "path": "/config/recipes/example/sauces",
                    "recipe": None,
                    "children": {
                        "Hollandaise": {
                            "name": "Hollandaise",
                            "path": "/config/recipes/example/sauces/Hollandaise.cook",
                            "recipe": {"metadata": {"map": {"title": "Hollandaise"}}},
                            "children": {},
                        }
                    },
                }
            },
        },
    },
}


def _number(value: float) -> dict[str, Any]:
    """Objet 'number' tel que sérialisé par cooklang-rs."""
    return {"type": "number", "value": {"type": "regular", "value": value}}


RECIPE_DETAIL: dict[str, Any] = {
    "path": "/config/recipes/pates-carbonara.cook",
    "image": "/api/static/img/carbonara.jpg",
    "scale": 2,
    "recipe": {
        "metadata": {
            "map": {
                "title": "Pâtes carbonara",
                "servings": "4",
                "time": "25 min",
                "tags": ["pâtes", "rapide"],
                "image": "/img/carbonara.jpg",
            }
        },
        "ingredients": [
            {
                "name": "spaghetti",
                "quantity": {"value": _number(400.0), "unit": "g"},
                "note": None,
            },
            {
                "name": "lardons",
                "quantity": {"value": _number(200.0), "unit": "g"},
                "note": "fumés",
            },
            {
                "name": "œufs",
                "quantity": {"value": _number(4.0), "unit": None},
                "note": None,
            },
        ],
        "cookware": [
            {"name": "poêle", "quantity": None, "note": None},
        ],
        "timers": [
            {
                "name": "cuisson",
                "quantity": {"value": _number(9.0), "unit": "minutes"},
            }
        ],
        "sections": [
            {
                "name": None,
                "content": [
                    {
                        "type": "step",
                        "value": {
                            "number": 1,
                            "items": [
                                {"type": "text", "value": "Cuire les "},
                                {"type": "ingredient", "index": 0},
                                {"type": "text", "value": " dans l'eau bouillante."},
                            ],
                        },
                    },
                    {
                        "type": "step",
                        "value": {
                            "number": 2,
                            "items": [
                                {"type": "text", "value": "Faire revenir les "},
                                {"type": "ingredient", "index": 1},
                                {"type": "text", "value": " pendant "},
                                {"type": "timer", "index": 0},
                            ],
                        },
                    },
                ],
            },
            {
                "name": "Finition",
                "content": [
                    {
                        "type": "step",
                        "value": {
                            "number": 3,
                            "items": [
                                {"type": "text", "value": "Sortir la "},
                                {"type": "cookware", "index": 0},
                            ],
                        },
                    }
                ],
            },
        ],
    },
}
