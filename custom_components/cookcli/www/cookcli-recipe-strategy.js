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
 * - custom:cookcli-checklist-card : checklist des ingrédients (Résumé et étapes), état local
 * - button (native)             : Commencer / Précédent / Suivant / Démarrer minuteur
 * - custom:circular-timer-card  : affichage/contrôle du minuteur partagé
 * - custom:tabdeck-card         : les onglets (Résumé + une par étape)
 * - custom:mod-card (card-mod)  : force le ratio 30/70 des colonnes d'étape
 * - custom:cookcli-card         : la liste (voir cookcli-card.js)
 *
 * Configuration du tableau de bord (éditable aussi via l'éditeur visuel,
 * voir CookcliStrategyEditor ; sinon remplace le contenu YAML du dashboard) :
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
  // Largeur unique de tous les boutons de navigation (Commencer, Précédent,
  // Suivant) : c'est elle qu'on ajuste pour les agrandir ou les réduire.
  static NAV_BUTTON_WIDTH = "clamp(96px, 26vw, 150px)";

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

  static _navButton(entity, targetIndex, label, icon, accent = false) {
    return {
      type: "button",
      name: label,
      icon,
      tap_action: {
        action: "perform-action",
        perform_action: "input_number.set_value",
        target: { entity_id: entity },
        data: { value: targetIndex },
      },
      card_mod: {
        style: `
          :host {
            flex: 0 0 ${this.NAV_BUTTON_WIDTH} !important;
            width: ${this.NAV_BUTTON_WIDTH} !important;
            min-width: 0 !important;
          }
          ha-card {
            border-radius: 999px;
            --ha-card-border-width: 0;
            box-shadow: none;
            ${accent
              ? `background: var(--primary-color);
                --state-color: var(--text-primary-color, #fff) !important;
                --paper-item-icon-color: var(--text-primary-color, #fff);`
              : `background: var(--secondary-background-color);`}
          }
        `,
      },
    };
  }

  /**
   * Barre de navigation flottante en bas de l'écran. Les boutons ont une
   * largeur fixe (et non flex: 1) : un seul bouton fait la même taille que
   * deux, et la barre s'adapte à son contenu (max-content).
   */
  static _floatingNav(buttons) {
    return {
      type: "horizontal-stack",
      cards: buttons,
      card_mod: {
        style: `
          :host {
            position: fixed;
            bottom: calc(16px + env(safe-area-inset-bottom, 0px));
            right: calc(16px + env(safe-area-inset-bottom, 0px));
            width: max-content;
            z-index: 5;
            padding: 8px;
            border-radius: 999px;
            background: color-mix(in srgb, var(--card-background-color) 80%, transparent);
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
            height: auto !important;
          }
          #root {
            justify-content: center;
          }
        `,
      },
    };
  }

  /**
   * Deux colonnes sur grand écran (gauche étroite, droite large), une seule
   * colonne empilée sur mobile. Un horizontal-stack natif ne sait faire ni l'un
   * ni l'autre : on surcharge son conteneur interne (#root) avec card-mod.
   * 870px = le seuil "mobile" de Home Assistant.
   */
  static _responsiveColumns(leftCard, rightCard, leftWidth = "30%") {
    return {
      type: "horizontal-stack",
      cards: [leftCard, rightCard],
      card_mod: {
        style: `
          #root {
            flex-direction: column !important;
          }
          #root > * {
            flex: 0 0 auto !important;
            width: 100% !important;
            min-width: 0;
          }
          @media (min-width: 870px) {
            #root {
              flex-direction: row !important;
              align-items: flex-start;
            }
            #root > :first-child {
              display: flex;
              flex: 0 0 ${leftWidth} !important;
              width: auto !important;
            }
            #root > :last-child {
              display: flex;
              flex: 1 1 0 !important;
              width: auto !important;
            }
          }
        `,
      },
    };
  }

  static _summaryTab(recipe, config, stepCount) {
    let content = "";
    //if (recipe.image_url) content += `![image de la recette](${recipe.image_url})\n\n`;
    if (recipe.image_url) {
      const cleanImageUrl = recipe.image_url.replace(/([^:]\/)\/+/g, "\$1");
      content += `<img src='${cleanImageUrl}' alt='image de la recette' style='width: 100%;aspect-ratio: 16 / 10;object-fit: cover;border-radius: 12px;margin-bottom: 8px;' />\n\n`;
    }
    content += `## ${recipe.title || ""}\n`;
    if (recipe.cookware && recipe.cookware.length) {
      content += `\n**Ustensiles** : ${recipe.cookware.map((c) => c.name).join(", ")}\n`;
    }

    const leftCard = {
      type: "markdown",
      content,
      card_mod: `
        style:
          ha-markdown:
            $: |
              img {
                width: 100%;
                aspect-ratio: 16 / 10;
                object-fit: cover;
                border-radius: 12px;
                margin-bottom: 8px;
              }`,
    };

    const rightCards = [];

    const ingredients = recipe.ingredients || [];
    if (ingredients.length) {
      rightCards.push({
        type: "custom:cookcli-checklist-card",
        title: "Ingrédients",
        // État coché propre à cette recette, indépendant de celui des étapes.
        storage_key: `${config.path}:summary`,
        items: ingredients.map((ingredient) => {
          const quantity = ingredient.quantity || {};
          return {
            quantity: [quantity.value, quantity.unit]
              .filter((part) => part !== null && part !== undefined && part !== "")
              .join(" "),
            name: ingredient.name ?? "",
          };
        }),
      });
    }

    if (config.step_entity && stepCount > 0) {
      rightCards.push(
        this._floatingNav([
          this._navButton(config.step_entity, 1, "Commencer", "mdi:play", true),
        ])
      );
    }

    const columns = this._responsiveColumns(
      leftCard,
      { type: "vertical-stack", cards: rightCards },
      "30%"
    );

    const tab = {
      name: "Résumé",
      icon: "mdi:book-open-variant",
      card: {
        type: "vertical-stack",
        cards: [columns],
        // Réserve la place de la barre flottante sous la checklist.
        card_mod: { style: ":host { display: block; padding-bottom: 96px; }" },
      },
    };
    if (config.step_entity) tab.auto_select = { entity: config.step_entity, state: "0.0" };
    return tab;
  }

  static _stepTab(section, step, tabIndex, isLast, config) {
    const { markdown: stepMarkdown, timers } = this._renderStepMarkdown(step);

    const leftCards = [];
    const stepIngredients = (step.items || []).filter((item) => item.type === "ingredient");
    if (stepIngredients.length) {
      leftCards.push({
        type: "custom:cookcli-checklist-card",
        title: "Ingrédients",
        // recette + étape : l'état coché est propre à chaque étape de chaque recette
        storage_key: `${config.path}:${tabIndex}`,
        items: stepIngredients.map((item) => ({
          quantity: item.quantity
            ? `${item.quantity.value ?? ""} ${item.quantity.unit ?? ""}`.trim()
            : "",
          name: item.name ?? "",
        })),
      });
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
            action: "perform-action",
            perform_action: "timer.start",
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

    const columns = this._responsiveColumns(
      { type: "vertical-stack", cards: leftCards },
      { type: "markdown", content: stepMarkdown }
    );

    const cards = [columns];

    if (config.step_entity) {
      const navButtons = [
        this._navButton(config.step_entity, tabIndex - 1, "Précédent", "mdi:arrow-left"),
      ];
      if (!isLast) {
        navButtons.push(
          this._navButton(config.step_entity, tabIndex + 1, "Suivant", "mdi:arrow-right", true)
        );
      }
      cards.push(this._floatingNav(navButtons));
    }

    const tab = {
      name: section.name ? `${section.name} ${step.number ?? ""}`.trim() : `Étape ${tabIndex}`,
      card: {
        type: "vertical-stack",
        cards,
        card_mod: { style: ":host { display: block; padding-bottom: 96px; }" },
      },
    };
    if (config.step_entity) tab.auto_select = { entity: config.step_entity, state: `${tabIndex}.0` };
    return tab;
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

/**
 * Éditeur visuel de la dashboard strategy (remplace l'édition YAML).
 *
 * Basé sur <ha-form> + sélecteurs natifs HA : mêmes composants, même rendu
 * que les éditeurs des cartes officielles (thème, sélecteurs d'entités,
 * traductions). Aucune dépendance Lit : on manipule directement l'élément.
 *
 * Contrat HA pour un éditeur de strategy :
 *   - setConfig(config)  → reçoit la config courante
 *   - set hass(hass)     → reçoit l'objet hass (mis à jour très souvent)
 *   - événement "config-changed" { detail: { config } } → sauvegarde
 */
const COOKCLI_EDITOR_SCHEMA = [
  { name: "title", selector: { text: {} } },
  { name: "timer_entity", selector: { entity: { domain: "timer" } } },
  { name: "step_entity", selector: { entity: { domain: "input_number" } } },
  { name: "entry_id", selector: { config_entry: { integration: "cookcli" } } },
];

const COOKCLI_EDITOR_LABELS = {
  title: "Titre du dashboard",
  timer_entity: "Minuteur",
  step_entity: "Étape en cours",
  entry_id: "Serveur CookCLI",
};

const COOKCLI_EDITOR_HELPERS = {
  title: "Titre de la liste et du dashboard. Par défaut : « Recettes ».",
  timer_entity:
    "Aide « Minuteur » partagée entre toutes les recettes (ex. timer.recette_en_cours). Vide = pas de boutons de minuteur.",
  step_entity:
    "Aide « Nombre » qui pilote l'onglet actif (ex. input_number.recette_etape). Vide = pas de boutons Commencer / Précédent / Suivant.",
  entry_id:
    "Seulement si tu as plusieurs serveurs CookCLI. Vide = le serveur par défaut.",
};

class CookcliStrategyEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = undefined;
    this._form = null;
  }

  setConfig(config) {
    this._config = config || {};
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  connectedCallback() {
    this._ensureForm();
    this._update();
  }

  _ensureForm() {
    if (this._form) return;
    const form = document.createElement("ha-form");
    form.schema = COOKCLI_EDITOR_SCHEMA;
    form.computeLabel = (schema) => COOKCLI_EDITOR_LABELS[schema.name] || schema.name;
    form.computeHelper = (schema) => COOKCLI_EDITOR_HELPERS[schema.name] || "";
    form.addEventListener("value-changed", (ev) => this._valueChanged(ev));
    this.appendChild(form);
    this._form = form;
  }

  // Le formulaire est créé une seule fois ; on ne met à jour que ses
  // propriétés (pas de re-rendu du DOM à chaque changement de hass, ce qui
  // ferait perdre le focus pendant la saisie).
  _update() {
    if (!this._form) return;
    if (this._hass) this._form.hass = this._hass;
    const data = {};
    for (const { name } of COOKCLI_EDITOR_SCHEMA) {
      if (this._config[name] !== undefined) data[name] = this._config[name];
    }
    this._form.data = data;
  }

  _valueChanged(ev) {
    ev.stopPropagation();
    const value = ev.detail.value || {};

    // On part de la config existante (garde `type: custom:cookcli` et toute
    // clé inconnue) et on ne touche qu'aux champs de l'éditeur. Un champ vidé
    // est supprimé plutôt que stocké comme "".
    const config = { ...this._config };
    for (const { name } of COOKCLI_EDITOR_SCHEMA) {
      const v = value[name];
      if (v === undefined || v === null || v === "") delete config[name];
      else config[name] = v;
    }

    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
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