/**
 * Carte Lovelace pour l'intégration CookCLI — liste navigable des recettes.
 *
 * Le détail d'une recette est une VUE DISTINCTE par recette (path = le
 * "view_path" renvoyé par le backend), générée par une dashboard strategy
 * (voir cookcli-recipe-strategy.js). C'est nécessaire : une view strategy ne
 * régénère son contenu qu'au montage de la vue, pas à chaque changement de
 * l'URL — avec une seule vue partagée + un paramètre `?path=`, il fallait
 * recharger la page pour voir une autre recette. Une vraie vue par recette
 * force un remontage à chaque navigation, donc ça marche en SPA normal.
 *
 * Consomme cookcli/recipes (path, view_path, name, time, servings, tags,
 * image_url).
 *
 * Installation :
 * 1. Copie ce fichier dans config/www/cookcli-card.js
 * 2. Paramètres -> Tableaux de bord -> menu ⋮ -> Ressources -> Ajouter :
 *    URL "/local/cookcli-card.js", type "Module JavaScript"
 * 3. Cette carte est normalement insérée automatiquement par la dashboard
 *    strategy cookcli-recipe-strategy.js — voir son README pour la config
 *    complète du tableau de bord. Utilisable aussi seule en carte manuelle,
 *    y compris sur un AUTRE tableau de bord que celui des recettes :
 *    type: custom:cookcli-card
 *    title: Mes recettes
 *    dashboard_path: test-cuisine   # optionnel — voir plus bas
 *
 * Par défaut, un clic navigue vers une vue du tableau de bord COURANT (celui
 * où la carte est affichée). Si tu places cette carte sur un autre tableau
 * de bord que celui qui contient les vues générées par la dashboard
 * strategy (ex: carte sur /lovelace, vues sur /test-cuisine), précise
 * `dashboard_path: test-cuisine` pour que la navigation cible le bon
 * tableau de bord plutôt que celui où la carte est physiquement posée.
 */

class CookCliCard extends HTMLElement {
  static getStubConfig() {
    return { title: "Recettes" };
  }

  setConfig(config) {
    this._config = config || {};
    this._recipes = null;
    this._loading = false;
    this._error = null;
    this._lastFetch = 0;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    }
    this._render();
  }

  /**
   * Éditeur visuel : élément dédié (voir CookCliCardEditor plus bas) plutôt
   * que getConfigForm(), dont le schéma est statique et n'a pas accès à
   * hass — or la liste des dashboards disponibles en dépend.
   */
  static getConfigElement() {
    return document.createElement("cookcli-card-editor");
  }

  set hass(hass) {
    this._hass = hass;
    if (this._recipes === null && !this._loading) {
      this._fetchRecipes();
    }
  }

  /**
   * Vérifie si les signatures d'images risquent d'avoir expiré.
   * Si le dernier chargement date de plus de 45 minutes, on relance une requête propre.
   */
  _checkAndRefresh() {
    if (this._loading || !this._recipes) return;
    
    const now = Date.now();
    const fortyFiveMinutes = 45 * 60 * 1000;
    
    if (now - this._lastFetch > fortyFiveMinutes) {
      this._fetchRecipes();
    }
  }

  getCardSize() {
    return 6;
  }

  async _fetchRecipes() {
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const msg = { type: "cookcli/recipes" };
      if (this._config.entry_id) msg.entry_id = this._config.entry_id;
      const result = await this._hass.connection.sendMessagePromise(msg);
      this._recipes = result.recipes || [];
      this._lastFetch = Date.now();
    } catch (err) {
      this._error = (err && err.message) || "Erreur inconnue";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _navigateToView(viewPath) {
    const dashboardRoot = this._config.dashboard_path
      ? `/${this._config.dashboard_path.replace(/^\/+|\/+$/g, "")}`
      // Racine du dashboard courant, ex: "/lovelace-cookcli" depuis
      // "/lovelace-cookcli/recettes" — on y accroche la vue de la recette.
      : window.location.pathname.split("/").slice(0, 2).join("/");
    const url = `${dashboardRoot}/${viewPath}`;

    // Navigation interne HA, sans recharger la page (comme un tap_action navigate).
    window.history.pushState(null, "", url);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  _onClick(event) {
    const itemEl = event.target.closest("[data-view-path]");
    if (itemEl) {
      this._navigateToView(itemEl.dataset.viewPath);
    }
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  _renderList() {
    if (this._loading && !this._recipes) {
      return `<div class="state-msg">Chargement…</div>`;
    }
    if (this._error && !this._recipes) {
      return `<div class="state-msg error">${this._escape(this._error)}</div>`;
    }
    if (!this._recipes || this._recipes.length === 0) {
      return `<div class="state-msg">Aucune recette trouvée.</div>`;
    }

    const cards = this._recipes
      .map((r) => {
        const meta = [];
        if (r.time) meta.push(`<span>⏱ ${this._escape(r.time)}</span>`);
        if (r.servings) meta.push(`<span>🍽 ${this._escape(String(r.servings))}</span>`);
        const thumb = r.image_url
          ? `<img class="recipe-thumb" src="${this._escape(r.image_url)}" alt="" loading="lazy" onerror="this.style.background='var(--divider-color)';this.removeAttribute('src')">`
          : `<div class="recipe-thumb recipe-thumb-placeholder"></div>`;
        return `
          <div class="recipe-card" data-view-path="${this._escape(r.view_path)}">
            ${thumb}
            <div class="recipe-card-text">
              <div class="recipe-name">${this._escape(r.name)}</div>
              <div class="recipe-meta">${meta.join("")}</div>
            </div>
          </div>`;
      })
      .join("");

    return `<div class="recipe-grid">${cards}</div>`;
  }

  _render() {
    if (!this.shadowRoot) return;
    const title = this._config.title || "Recettes";
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card header="${this._escape(title)}">
        <div class="card-content">${this._renderList()}</div>
      </ha-card>
    `;
  }

  _styles() {
    return `
      .card-content { padding: 0 16px 16px; }
      .state-msg { padding: 16px 0; color: var(--secondary-text-color); }
      .state-msg.error { color: var(--error-color, #db4437); }

      /* Grille responsive : 1 colonne par défaut (mobile),
         puis 2 / 3 / 4 colonnes selon la largeur disponible. */
      .recipe-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(225px, 1fr));
        gap: 12px;
      }

      .recipe-card {
        display: flex;
        flex-direction: column;
        background: var(--card-background-color);
        border-radius: 12px;
        overflow: hidden;
        cursor: pointer;
        border: 1px solid var(--divider-color);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .recipe-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      .recipe-card:hover .recipe-name {
        color: var(--primary-color);
      }

      .recipe-thumb {
        width: 100%;
        aspect-ratio: 16 / 10;
        object-fit: cover;
        display: block;
        background: var(--secondary-background-color);
        flex-shrink: 0;
      }
      .recipe-thumb-placeholder {
        background: var(--divider-color);
      }

      .recipe-card-text {
        padding: 10px 12px 12px;
        min-width: 0;
      }
      .recipe-name {
        font-weight: 500;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-bottom: 4px;
      }
      .recipe-meta {
        display: flex;
        gap: 12px;
        font-size: 0.85em;
        color: var(--secondary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `;
  }
}

/**
 * Éditeur visuel de la carte (ha-form + sélecteurs natifs).
 *
 * "Chemin du dashboard" propose les dashboards Lovelace du serveur, lus dans
 * hass.panels (accessible à tous les utilisateurs, contrairement à
 * lovelace/dashboards/list qui demande les droits admin). custom_value reste
 * activé pour pouvoir saisir un chemin qui n'apparaît pas dans la liste.
 */
const COOKCLI_CARD_EDITOR_FIELDS = ["title", "dashboard_path", "entry_id"];

const COOKCLI_CARD_EDITOR_LABELS = {
  title: "Titre",
  dashboard_path: "Dashboard des recettes",
  entry_id: "Serveur CookCLI",
};

const COOKCLI_CARD_EDITOR_HELPERS = {
  title: "Titre de la carte. Par défaut : « Recettes ».",
  dashboard_path:
    "Seulement si la carte n'est pas sur le dashboard qui contient les vues recettes. Vide = dashboard courant.",
  entry_id:
    "Seulement si tu as plusieurs serveurs CookCLI. Vide = le serveur par défaut.",
};

class CookCliCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = undefined;
    this._form = null;
    this._optionsSignature = null;
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

  _dashboardOptions() {
    const panels = (this._hass && this._hass.panels) || {};
    return Object.values(panels)
      .filter((p) => p.component_name === "lovelace" && p.url_path)
      .map((p) => ({
        value: p.url_path,
        label: p.title ? `${p.title} (${p.url_path})` : p.url_path,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  _buildSchema(options) {
    return [
      { name: "title", selector: { text: {} } },
      {
        name: "dashboard_path",
        selector: { select: { options, custom_value: true, mode: "dropdown" } },
      },
      { name: "entry_id", selector: { config_entry: { integration: "cookcli" } } },
    ];
  }

  _ensureForm() {
    if (this._form) return;
    const form = document.createElement("ha-form");
    const options = this._dashboardOptions();
    this._optionsSignature = JSON.stringify(options);
    form.schema = this._buildSchema(options);
    form.computeLabel = (schema) => COOKCLI_CARD_EDITOR_LABELS[schema.name] || schema.name;
    form.computeHelper = (schema) => COOKCLI_CARD_EDITOR_HELPERS[schema.name] || "";
    form.addEventListener("value-changed", (ev) => this._valueChanged(ev));
    this.appendChild(form);
    this._form = form;
  }

  // Formulaire créé une fois ; on ne met à jour que ses propriétés. Le schéma
  // n'est reconstruit que si la liste des dashboards a changé (hass, lui,
  // change en permanence).
  _update() {
    if (!this._form) return;
    if (this._hass) {
      this._form.hass = this._hass;
      const options = this._dashboardOptions();
      const signature = JSON.stringify(options);
      if (signature !== this._optionsSignature) {
        this._optionsSignature = signature;
        this._form.schema = this._buildSchema(options);
      }
    }
    const data = {};
    for (const name of COOKCLI_CARD_EDITOR_FIELDS) {
      if (this._config[name] !== undefined) data[name] = this._config[name];
    }
    this._form.data = data;
  }

  _valueChanged(ev) {
    ev.stopPropagation();
    const value = ev.detail.value || {};

    // Garde `type` et toute clé inconnue ; un champ vidé est supprimé.
    const config = { ...this._config };
    for (const name of COOKCLI_CARD_EDITOR_FIELDS) {
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

customElements.define("cookcli-card", CookCliCard);
customElements.define("cookcli-card-editor", CookCliCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "cookcli-card",
  name: "CookCLI Recipes",
  preview: false,
  description: "Liste navigable de tes recettes CookCLI.",
});