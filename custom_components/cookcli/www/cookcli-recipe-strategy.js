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
 * La vue d'une recette est UNE SEULE carte tabdeck-card : un onglet "Résumé"
 * (titre, image, ustensiles, tous les ingrédients à cocher, bouton
 * "Commencer"), puis un onglet par étape (colonne gauche 30% : ingrédients
 * de l'étape + minuteur ; colonne droite 70% : texte de l'étape ; boutons
 * Précédent/Suivant en bas).
 *
 * Le ratio 30/70 n'a pas d'équivalent natif HA (grid/horizontal-stack ne
 * font que des colonnes égales) : on s'appuie sur **card-mod**
 * (https://github.com/thomasloven/lovelace-card-mod, HACS) pour forcer la
 * largeur des deux colonnes d'un horizontal-stack.
 *
 * Pour Précédent/Suivant/Commencer, on n'utilise PAS le hash d'URL
 * `#tab=...` de tabdeck (son comportement en navigation live après montage
 * n'est pas documenté avec certitude) mais son mode `remember: entity` —
 * documenté et fiable : l'onglet actif est piloté par la valeur d'un helper
 * input_number, que nos boutons changent via `input_number.set_value`.
 * tabdeck lit cette valeur pour choisir l'onglet actif et se met à jour
 * comme n'importe quel autre entité HA quand elle change — un mécanisme
 * standard, pas une supposition sur le comportement interne de la carte.
 *
 * Cartes utilisées, toutes tierces ou natives — aucune carte custom pour le
 * rendu du contenu lui-même :
 * - markdown (native)           : titre, image, ustensiles, texte des étapes
 * - todo-list (native)          : checklist des ingrédients (todo.py backend)
 * - button (native)             : Commencer / Précédent / Suivant / Démarrer minuteur
 * - custom:circular-timer-card  : affichage/contrôle du minuteur partagé
 * - custom:tabdeck-card         : les onglets (Résumé + une par étape)
 * - custom:mod-card (card-mod)  : force le ratio 30/70 des colonnes d'étape
 * - custom:cookcli-card         : la liste (voir cookcli-card.js)
 *
 * Configuration du tableau de bord (remplace le contenu YAML du dashboard) :
 *   strategy:
 *     type: custom:cookcli
 *     title: Recettes
 *     timer_entity: timer.recette_en_cours       # créé manuellement, voir README
 *     step_entity: input_number.recette_etape    # créé manuellement, voir README
 *     entry_id: xxxx                              # optionnel, si plusieurs serveurs CookCLI
 */

class CookCliDashboardStrategy extends HTMLElement {
  static getCreateSuggestions() {
    return { title: "Recettes", icon: "mdi:chef-hat" };
  }

  static getConfigElement() {
    return document.createElement("cookcli-strategy-editor");
  }

  static configRequired = true;

  static async generate(config, hass) {
    config = config || {};

    const wsMsg = { type: "cookcli/recipes" };
    if (config.entry_id) wsMsg.entry_id = config.entry_id;

    let recipes = [];
    try {
      const result = await hass.connection.sendMessagePromise(wsMsg);
      recipes = result.recipes || [];
    } catch (err) {
      // Liste vide plutôt que planter tout le dashboard.
    }

    const listView = {
      title: config.title || "Recettes",
      path: "recettes",
      panel: true,
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
      panel: true,
      strategy: {
        type: "custom:cookcli-recipe",
        path: recipe.path,
        timer_entity: config.timer_entity,
        step_entity: config.step_entity,
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
 * View strategy : génère le contenu de la vue d'UNE recette, sous forme
 * d'une unique carte tabdeck-card (Résumé + une tab par étape).
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

    // Repart de "Résumé" à chaque nouvelle recette ouverte, plutôt que de
    // garder l'étape où on s'était arrêté sur la recette précédente (le
    // helper input_number est partagé entre toutes les recettes).
    if (config.step_entity) {
      await this._setStepIndex(hass, config.step_entity, 0);
    }

    // Étapes à plat, avec leur index global (1-based ; 0 est réservé au
    // "Résumé") pour piloter remember_entity.
    const flatSteps = [];
    for (const section of recipe.sections || []) {
      for (const step of section.steps || []) {
        flatSteps.push({ section, step });
      }
    }

    const tabs = [this._summaryTab(recipe, config, flatSteps.length)];
    flatSteps.forEach(({ section, step }, i) => {
      const tabIndex = i + 1; // 0 = Résumé
      const isLast = tabIndex === flatSteps.length;
      tabs.push(
        this._stepTab(section, step, tabIndex, isLast, config)
      );
    });

    const tabdeckCard = {
      type: "custom:tabdeck-card",
      panel: true,
      default_tab: 0,
      tabs,
    };
    if (config.step_entity) {
      tabdeckCard.remember = "entity";
      tabdeckCard.remember_entity = config.step_entity;
    }

    return {
      title: recipe.title || "Recette",
      panel: true,
      cards: [tabdeckCard],
    };
  }

  static async _setStepIndex(hass, entity, value) {
    try {
      await hass.connection.sendMessagePromise({
        type: "call_service",
        domain: "input_number",
        service: "set_value",
        service_data: { entity_id: entity, value },
      });
    } catch (err) {
      // Pas bloquant : au pire l'utilisateur atterrit sur le dernier onglet
      // laissé actif plutôt que sur "Résumé".
    }
  }

  static _navButton(entity, targetIndex, label, icon) {
    return {
      type: "button",
      name: label,
      icon,
      tap_action: {
        action: "call-service",
        service: "input_number.set_value",
        target: { entity_id: entity },
        data: { value: targetIndex },
      },
    };
  }

  static _summaryTab(recipe, config, stepCount) {
    let content = "";
    //if (recipe.image_url) content += `![image de la recette](${recipe.image_url})\n\n`;
    if (recipe.image_url) {
      const cleanImageUrl = recipe.image_url.replace(/([^:]\/)\/+/g, "\$1");
      content += `<img src='${cleanImageUrl}' alt='image de la recette 2' style='width: 100%;aspect-ratio: 16 / 10;object-fit: cover;border-radius: 12px;margin-bottom: 8px;' />\n\n`;
    }
    content += `## ${recipe.title || ""}\n`;
    if (recipe.cookware && recipe.cookware.length) {
      content += `\n**Ustensiles** : ${recipe.cookware.map((c) => c.name).join(", ")}\n`;
    }

    const cards = [{ 
      type: "markdown", 
      content,
      card_mod: `
        style: |
          img {
            width: 100%;
            aspect-ratio: 16 / 10;
            object-fit: cover;
            border-radius: 12px;
            margin-bottom: 8px;
          }
      `
    }];

    const rightCards = [];

    if (recipe.todo_entity_id) {
      rightCards.push({
        type: "todo-list",
        entity: recipe.todo_entity_id,
        title: "Ingrédients",
        card_mod: {
          style: `
              ha-list .header {
                display: none;
              }
            `
        }
      });
    }

    if (config.step_entity && stepCount > 0) {
      rightCards.push(this._navButton(config.step_entity, 1, "Commencer", "mdi:play"));
    }

    cards.push({ type: "vertical-stack", cards: rightCards });

    return { name: "Résumé", icon: "mdi:book-open-variant", card: { type: "horizontal-stack", cards } };
  }

  static _stepTab(section, step, tabIndex, isLast, config) {
    const { markdown: stepMarkdown, timers } = this._renderStepMarkdown(step);

    const leftCards = [];
    const stepIngredients = (step.items || []).filter((item) => item.type === "ingredient");
    if (stepIngredients.length) {
      const lines = stepIngredients.map((item) => {
        const qty = item.quantity ?? ""
          ? `${item.quantity.value ?? ""} ${item.quantity.unit ?? ""}`.trim()
          : "";
        return `- ${qty ? `**${qty}** ` : ""}${item.name ?? ""}`;
      });
      leftCards.push({ type: "markdown", content: lines.join("\n") });
    }

    if (config.timer_entity) {
      for (const timer of timers) {
        const seconds = this._parseDurationSeconds(timer.duration, timer.unit);
        if (!seconds) continue;
        const label = `${timer.duration ?? ""} ${timer.unit ?? ""}`.trim();
        leftCards.push({
          type: "button",
          name: `Démarrer ${label}`,
          icon: "mdi:timer-outline",
          tap_action: {
            action: "call-service",
            service: "timer.start",
            target: { entity_id: config.timer_entity },
            data: { duration: this._secondsToHms(seconds) },
          },
        });
        leftCards.push({ type: "custom:circular-timer-card", entity: config.timer_entity });
      }
    }

    if (!leftCards.length) {
      // horizontal-stack veut deux cartes ; une carte vide maintient le ratio.
      leftCards.push({ type: "markdown", content: " " });
    }

    const columns = {
      type: "horizontal-stack",
      cards: [
        { type: "vertical-stack", cards: leftCards },
        { type: "markdown", content: stepMarkdown },
      ],
    };

    const cards = [columns];

    if (config.step_entity) {
      const navButtons = [
        this._navButton(config.step_entity, tabIndex - 1, "Précédent", "mdi:arrow-left"),
      ];
      if (!isLast) {
        navButtons.push(
          this._navButton(config.step_entity, tabIndex + 1, "Suivant", "mdi:arrow-right")
        );
      }
      cards.push({ type: "horizontal-stack", cards: navButtons });
    }

    return {
      name: section.name ? `${section.name} ${step.number ?? ""}`.trim() : `Étape ${tabIndex}`,
      card: { type: "vertical-stack", cards },
    };
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
   * estimation basse ; ajustable ensuite en relançant le bouton "Démarrer"
   * de l'étape (pas d'édition de durée à la volée sur circular-timer-card).
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
    return Math.round(value * 60);
  }

  static _secondsToHms(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }
}

class CookcliStrategyEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
  }

  // Appelé automatiquement quand l'élément est inséré dans le DOM
  connectedCallback() {
    this._render();
  }

  _render() {
    console.log("Editor render appelé", this._config, this._hass);

    // On attend d'avoir hass avant de rendre : ha-input en a besoin
    // pour son thème et ses styles.
    if (!this._hass) {
      this.innerHTML = `<div style="padding:16px">Chargement…</div>`;
      return;
    }

    const c = this._config || {};

    // Remplacer temporairement ha-textfield par des inputs natifs
    this.innerHTML = `
      <div style="padding: 16px; display: flex; flex-direction: column; gap: 16px;">
        <ha-input
          label="Titre du dashboard"
          value="${c.title || ""}"
          data-config-key="title"
          helper="Titre affiché dans l'onglet"
          style="width: 100%;"
        ></ha-input>

        <ha-input
          label="Entité minuteur"
          value="${c.timer_entity || ""}"
          data-config-key="timer_entity"
          helper="Ex: timer.recette_en_cours"
          style="width: 100%;"
        ></ha-input>

        <ha-input
          label="Entité étape"
          value="${c.step_entity || ""}"
          data-config-key="step_entity"
          helper="Ex: input_number.recette_etape"
          style="width: 100%;"
        ></ha-input>

        <ha-input
          label="Entry ID (optionnel)"
          value="${c.entry_id || ""}"
          data-config-key="entry_id"
          helper="Laisser vide si un seul serveur CookCLI"
          style="width: 100%;"
        ></ha-input>
      </div>
    `;

    // Écouteurs natifs (change au lieu de input pour éviter les re-rendus intempestifs)
    this.querySelectorAll("[data-config-key]").forEach((champ) => {
      champ.addEventListener("change", (ev) => {
        const cle = ev.target.dataset.configKey;
        const nouvelleConfig = { ...this._config, [cle]: ev.target.value };
        this._config = nouvelleConfig;
      });
    });
  }
}

customElements.define("ll-strategy-dashboard-cookcli", CookCliDashboardStrategy);
customElements.define("ll-strategy-view-cookcli-recipe", CookCliRecipeViewStrategy);
customElements.define("cookcli-strategy-editor", CookcliStrategyEditor);

window.customStrategies = window.customStrategies || [];
window.customStrategies.push({
  type: "cookcli",
  strategyType: "dashboard",
  name: "CookCLI",
  description: "Dashboard de recettes CookCLI : liste + une vue par recette.",
  documentationURL: "https://git.thethomaas.net/TheThomaas/ha-cookcli",
});