/**
 * Strategies CookCLI pour Home Assistant : une dashboard strategy + une view
 * strategy compagne.
 *
 * IMPORTANT : la view strategy seule ne suffit pas pour une navigation
 * fluide. Une view strategy régénère son contenu au MONTAGE de la vue, pas à
 * chaque changement d'URL — avec une seule vue partagée "recette?path=..."
 * pour toutes les recettes, passer de l'une à l'autre sans recharger la
 * page laissait afficher l'ancienne recette (vue déjà montée, jamais
 * remontée). D'où la dashboard strategy : elle génère une VUE DISTINCTE par
 * recette (un vrai `path` HA différent pour chacune), ce qui force un
 * remontage — donc une régénération — à chaque navigation.
 *
 * Cartes utilisées, toutes tierces ou natives — aucune carte custom pour le
 * rendu du contenu lui-même :
 * - markdown (native)         : titre, image, ustensiles, texte des étapes
 * - todo-list (native)        : checklist des ingrédients (todo.py backend)
 * - button (native)           : démarre le minuteur avec la bonne durée
 * - custom:circular-timer-card : affichage/contrôle du minuteur partagé
 * - custom:tabdeck-card         : une tab par étape
 * - custom:cookcli-card         : la liste (voir cookcli-card.js)
 *
 * Configuration du tableau de bord (remplace le contenu YAML du dashboard) :
 *   strategy:
 *     type: custom:cookcli
 *     title: Recettes
 *     timer_entity: timer.recette_en_cours   # créé manuellement, voir README
 *     entry_id: xxxx                          # optionnel, si plusieurs serveurs CookCLI
 */

class CookCliDashboardStrategy extends HTMLElement {
  static getCreateSuggestions() {
    return { title: "Recettes", icon: "mdi:chef-hat" };
  }

  static async generate(config, hass) {
    config = config || {};

    const wsMsg = { type: "cookcli/recipes" };
    if (config.entry_id) wsMsg.entry_id = config.entry_id;

    let recipes = [];
    try {
      const result = await hass.connection.sendMessagePromise(wsMsg);
      recipes = result.recipes || [];
    } catch (err) {
      // Liste vide plutôt que planter tout le dashboard ; la carte affichera
      // son propre message d'erreur au prochain essai de fetch côté carte.
    }

    const listView = {
      title: config.title || "Recettes",
      path: "recettes",
      cards: [
        {
          type: "custom:cookcli-card",
          title: config.title || "Mes recettes",
          entry_id: config.entry_id,
        },
      ],
    };

    const recipeViews = recipes.map((recipe) => ({
      path: recipe.view_path,
      subview: true,
      strategy: {
        type: "custom:cookcli-recipe",
        path: recipe.path,
        timer_entity: config.timer_entity,
        entry_id: config.entry_id,
      },
    }));

    return {
      title: config.title || "Recettes",
      views: [listView, ...recipeViews],
    };
  }
}

/**
 * View strategy : génère le contenu de la vue d'UNE recette. `config.path`
 * est fourni par la dashboard strategy ci-dessus ; utilisable seule (une vue
 * par recette écrite à la main) en le fixant directement dans le YAML.
 */
class CookCliRecipeViewStrategy extends HTMLElement {
  static async generate(config, hass) {
    config = config || {};
    const path = config.path;

    if (!path) {
      return {
        cards: [{ type: "markdown", content: "Aucune recette sélectionnée." }],
      };
    }

    const wsMsg = { type: "cookcli/recipe", path };
    if (config.entry_id) wsMsg.entry_id = config.entry_id;

    let recipe;
    try {
      recipe = await hass.connection.sendMessagePromise(wsMsg);
    } catch (err) {
      return {
        cards: [
          {
            type: "markdown",
            content: `**Erreur en chargeant la recette**\n\n${(err && err.message) || err}`,
          },
        ],
      };
    }

    const cards = [];
    cards.push(this._headerCard(recipe));

    if (config.timer_entity) {
      cards.push({
        type: "custom:simple-timer-card",
        style: "fill_horizontal",
        show_active_header: false,
        entities: [{
          entity: config.timer_entity,
          keep_timer_visible_when_idle: true,
          name: " "
        }]
      });
      cards.push({
        type: "horizontal-stack",
        cards: [
          {
            type: "markdown",
            content: " ",
            text_only: true
          },
          {
            type: "custom:circular-timer-card",
            entity: config.timer_entity,
            primary_info: "none"
          }
        ]
      });
    }

    if (recipe.todo_entity_id) {
      cards.push({
        type: "todo-list",
        entity: recipe.todo_entity_id,
        title: "Ingrédients à rassembler",
        card_mod: {
          style: `
              ha-list .header {
                display: none;
              }
            `
        }
      });
    }

    const tabs = this._stepTabs(recipe, config.timer_entity);
    if (tabs.length) {
      cards.push({ type: "custom:tabdeck-card", tabs });
    }

    return {
      title: recipe.title || "Recette",
      cards,
    };
  }

  static _headerCard(recipe) {
    let content = "";
    if (recipe.image_url) content += `![](${recipe.image_url})\n\n`;
    content += `## ${recipe.title || ""}\n`;
    if (recipe.cookware && recipe.cookware.length) {
      content += `\n**Ustensiles** : ${recipe.cookware.map((c) => c.name).join(", ")}\n`;
    }
    return { type: "markdown", content };
  }

  static _stepTabs(recipe, timerEntity) {
    const tabs = [];
    let stepCounter = 0;

    for (const section of recipe.sections || []) {
      for (const step of section.steps || []) {
        stepCounter += 1;
        const { markdown, timers } = this._renderStepMarkdown(step);

        const stepCards = [{ type: "markdown", content: markdown }];

        if (timerEntity) {
          for (const timer of timers) {
            const seconds = this._parseDurationSeconds(timer.duration, timer.unit);
            if (!seconds) continue;
            const label = `${timer.duration ?? ""} ${timer.unit ?? ""}`.trim();
            stepCards.push({
              type: "button",
              name: `Démarrer ${label}`,
              icon: "mdi:timer-outline",
              tap_action: {
                action: "call-service",
                service: "timer.start",
                target: { entity_id: timerEntity },
                data: { duration: this._secondsToHms(seconds) },
              },
            });
          }
        }

        tabs.push({
          name: section.name ? `${section.name} ${step.number ?? ""}`.trim() : `Étape ${stepCounter}`,
          card: { type: "vertical-stack", cards: stepCards },
        });
      }
    }

    return tabs;
  }

  static _renderStepMarkdown(step) {
    let markdown = "";
    const timers = [];

    for (const item of step.items || []) {
      switch (item.type) {
        case "text":
          markdown += item.value ?? "";
          break;
        case "ingredient":
        case "cookware": {
          const qty = item.quantity
            ? `${item.quantity.value ?? ""} ${item.quantity.unit ?? ""}`.trim()
            : "";
          markdown += `**${item.name}${qty ? ` (${qty})` : ""}**`;
          break;
        }
        case "timer": {
          const label = `${item.duration ?? ""} ${item.unit ?? ""}`.trim();
          markdown += `⏱ *${label}*`;
          timers.push(item);
          break;
        }
        default:
          break;
      }
    }

    return { markdown, timers };
  }

  /**
   * Devine une durée en secondes à partir d'une valeur de minuteur résolue.
   * `duration` peut être un nombre (secondes/minutes selon `unit`) ou du
   * texte libre façon "2-3 minutes" (Cooklang autorise les plages en texte
   * libre) — dans ce cas on prend le premier nombre trouvé, ce qui donne une
   * estimation basse ; ajustable ensuite via circular-timer-card (tap =
   * toggle, double-tap = annuler, appui long = plus d'infos) ou en relançant
   * timer.start avec une autre durée.
   */
  static _parseDurationSeconds(duration, unit) {
    let value = null;
    let unitHint = (unit || "").toLowerCase();

    if (typeof duration === "number") {
      value = duration;
    } else if (typeof duration === "string") {
      const match = duration.match(/(\d+(?:[.,]\d+)?)/);
      if (match) {
        value = parseFloat(match[1].replace(",", "."));
        if (!unitHint) unitHint = duration.toLowerCase();
      }
    }

    if (value === null) return null;

    if (unitHint.includes("heure") || unitHint.includes("hour") || unitHint === "h") {
      return Math.round(value * 3600);
    }
    if (unitHint.includes("sec") || unitHint === "s") {
      return Math.round(value);
    }
    // Par défaut (minutes, ou pas d'unité reconnue) : on suppose des minutes.
    return Math.round(value * 60);
  }

  static _secondsToHms(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }
}

customElements.define("ll-strategy-dashboard-cookcli", CookCliDashboardStrategy);
customElements.define("ll-strategy-view-cookcli-recipe", CookCliRecipeViewStrategy);

window.customStrategies = window.customStrategies || [];
window.customStrategies.push({
  type: "cookcli",
  strategyType: "dashboard",
  name: "CookCLI",
  description: "Dashboard de recettes CookCLI : liste + une vue par recette.",
  documentationURL: "https://git.thethomaas.net/TheThomaas/ha-cookcli",
});
