/**
 * View strategy CookCLI : génère la vue de détail d'une recette.
 *
 * Contrairement à une carte custom classique, une view strategy ne gère pas
 * son propre état de navigation : elle génère la config d'UNE vue HA
 * (titre + liste de cartes) à partir de `config` (donné en YAML) et de
 * `hass`, au moment où la vue est ouverte. Voir :
 * https://developers.home-assistant.io/docs/frontend/custom-ui/custom-strategy/#views
 *
 * Le chemin de la recette à afficher (`path`) est lu soit dans `config`
 * (fixe, une vue par recette), soit — cas normal ici — dans le paramètre
 * d'URL `?path=...` que cookcli-card.js pose avant de naviguer. Une view
 * strategy tourne dans le navigateur, donc lire window.location est légitime
 * même si HA ne le passe pas explicitement dans `config`.
 *
 * Cartes utilisées, toutes tierces ou natives — aucune carte custom pour le
 * rendu du contenu lui-même :
 * - markdown (native)      : titre, image, ustensiles, texte des étapes
 * - todo-list (native)     : checklist des ingrédients (todo.py côté backend)
 * - button (native)        : démarre le minuteur partagé avec la bonne durée
 * - custom:simple-timer-card : affichage/contrôle du minuteur partagé
 * - custom:tabdeck-card      : une tab par étape
 *
 * Configuration de la vue (YAML) :
 *   views:
 *     - path: recette
 *       strategy:
 *         type: custom:cookcli-recipe
 *         timer_entity: timer.cookcli   # créé manuellement, voir README
 *         entry_id: xxxx                # optionnel, si plusieurs serveurs CookCLI
 */

class CookCliRecipeViewStrategy extends HTMLElement {
  static async generate(config, hass) {
    config = config || {};
    const params = new URLSearchParams(window.location.search);
    const path = config.path || params.get("path");

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
   * estimation basse ; ajustable ensuite via les boutons +/- de
   * simple-timer-card ou l'éditeur de durée intégré.
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

customElements.define("ll-strategy-view-cookcli-recipe", CookCliRecipeViewStrategy);
