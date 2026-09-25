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
    this._selectedTag = null;
    this._reloading = false;
    this._reloadError = null;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
      this.shadowRoot.addEventListener(
        "wheel",
        (event) => {
          const bar = event.target.closest(".tag-filter");
          if (!bar || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          const max = bar.scrollWidth - bar.clientWidth;
          const atStart = bar.scrollLeft <= 0 && event.deltaY < 0;
          const atEnd = bar.scrollLeft >= max && event.deltaY > 0;
          if (max <= 0 || atStart || atEnd) return; // laisse la page défiler
          event.preventDefault();
          bar.scrollLeft += event.deltaY;
        },
        { passive: false }
      );
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
    this._subscribe();
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
      if (this._selectedTag !== null && !this._allTags().includes(this._selectedTag)) {
        this._selectedTag = null;
      }
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
    if (event.target.closest("[data-action='reload']")) {
      this._reload();
      return;
    }
    if (event.target.closest("[data-tag-clear]")) {
      this._selectedTag = null;
      this._render();
      return;
    }
    const tagEl = event.target.closest("[data-tag]");
    if (tagEl) {
      const tag = tagEl.dataset.tag;
      // Un second clic sur la pill active revient à « Toutes ».
      this._selectedTag = this._selectedTag === tag ? null : tag;
      this._render();
      return;
    }
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

  // Les tags peuvent arriver sous forme de tableau ou de chaîne "a, b".
  _tagsOf(recipe) {
    const tags = recipe.tags;
    if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
    if (typeof tags === "string") {
      return tags.split(",").map((t) => t.trim()).filter(Boolean);
    }
    return [];
  }

  _allTags() {
    const tags = new Set();
    for (const r of this._recipes || []) {
      for (const t of this._tagsOf(r)) tags.add(t);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  _tagFilterEnabled() {
    // Les pills n'ont pas de sens quand un tag est déjà imposé par la config.
    return this._config.show_tag_filter !== false && !this._config.tag;
  }

  _filteredRecipes() {
    const fixedTag = this._config.tag;
    if (fixedTag) {
      return this._recipes.filter((r) => this._tagsOf(r).includes(fixedTag));
    }
    if (!this._tagFilterEnabled() || this._selectedTag === null) return this._recipes;
    return this._recipes.filter((r) => this._tagsOf(r).includes(this._selectedTag));
  }

  connectedCallback() {
    this._subscribe();
  }

  disconnectedCallback() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }

  async _subscribe() {
    if (this._unsub || this._subscribing || !this._hass || !this.isConnected) return;
    this._subscribing = true;
    try {
      this._unsub = await this._hass.connection.subscribeEvents(
        (ev) => this._onReloaded(ev),
        "cookcli_reloaded"
      );
    } catch (err) {
      // Pas d'abonnement : le bouton retombe sur un rafraîchissement manuel.
    } finally {
      this._subscribing = false;
    }
    // La carte a pu être retirée du DOM pendant l'attente.
    if (!this.isConnected && this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }

  _onReloaded(ev) {
    const target = this._config.entry_id;
    if (target && ev.data && ev.data.entry_id !== target) return;
    this._fetchRecipes();
  }

  async _reload() {
    if (this._reloading || !this._hass) return;
    this._reloading = true;
    this._reloadError = null;
    this._render();
    try {
      const data = {};
      if (this._config.entry_id) data.entry_id = this._config.entry_id;
      await this._hass.callService("cookcli", "reload", data);
      // Normalement l'événement a déjà déclenché le rechargement ;
      // on ne le refait à la main que si l'abonnement a échoué.
      if (!this._unsub) await this._fetchRecipes();
    } catch (err) {
      this._reloadError = (err && err.message) || "Échec du rechargement";
    } finally {
      this._reloading = false;
      this._render();
    }
  }

  _renderTagFilter() {
    if (!this._tagFilterEnabled()) return "";
    const tags = this._allTags();
    if (tags.length === 0) return "";
    const allActive = this._selectedTag === null;
    const pills = tags
      .map((t) => {
        const active = this._selectedTag === t;
        return `<button type="button" class="tag-pill${active ? " active" : ""}" data-tag="${this._escape(t)}" aria-pressed="${active}">${this._escape(t)}</button>`;
      })
      .join("");
    return `
      <div class="tag-filter">
        <button type="button" class="tag-pill${allActive ? " active" : ""}" data-tag-clear aria-pressed="${allActive}">Toutes</button>
        ${pills}
      </div>`;
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

    const filtered = this._filteredRecipes();
    const filterBar = this._renderTagFilter();
    if (filtered.length === 0) {
      return `${filterBar}<div class="state-msg">Aucune recette avec ce tag.</div>`;
    }

    const cards = filtered
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

    return `${filterBar}<div class="recipe-grid">${cards}</div>`;
  }

  _render() {
    if (!this.shadowRoot) return;
    const title = this._config.title || "Recettes";
    const previous = this.shadowRoot.querySelector(".tag-filter");
    const scrollLeft = previous ? previous.scrollLeft : 0;
    const errorMsg = this._reloadError
      ? `<div class="state-msg error reload-error">${this._escape(this._reloadError)}</div>`
      : "";
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="card-header">
          <span class="card-title">${this._escape(title)}</span>
          <ha-icon-button
            class="reload-btn ${this._reloading ? "spinning" : ""}"
            data-action="reload"
            label="Recharger les recettes"
            ${this._reloading ? "disabled" : ""}
          >
            <ha-icon icon="mdi:refresh"></ha-icon>
          </ha-icon-button>
        </div>
        ${errorMsg}
        <div class="card-content">${this._renderList()}</div>
      </ha-card>
    `;

    const next = this.shadowRoot.querySelector(".tag-filter");
    if (next) next.scrollLeft = scrollLeft;
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
        grid-template-columns: repeat(auto-fill, minmax(225px, 1fr));
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
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 8px 8px 16px;
        color: var(--ha-card-header-color, var(--primary-text-color));
        font-family: var(--ha-card-header-font-family, inherit);
        font-size: var(--ha-card-header-font-size, 24px);
        line-height: 32px;
      }
      .reload-error { padding: 0 16px 8px; }
      .reload-btn.spinning ha-icon { animation: cookcli-spin 1s linear infinite; }
      @keyframes cookcli-spin { to { transform: rotate(360deg); } }
      
      .tag-filter {
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        margin-bottom: 12px;
        overflow-x: auto;
        /* Marge de fin pour que la dernière pill sorte de la zone de fondu. */
        padding-right: 24px;
        scrollbar-width: none;
        -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
        mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
      }
      .tag-filter::-webkit-scrollbar {
        display: none;
      }
      .tag-pill {
        font: inherit;
        font-size: 0.85em;
        padding: 4px 12px;
        border-radius: 999px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        color: var(--primary-text-color);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        flex-shrink: 0;
        white-space: nowrap;
      }
      .tag-pill:hover {
        border-color: var(--primary-color);
      }
      .tag-pill.active {
        background: var(--primary-color);
        border-color: var(--primary-color);
        color: var(--text-primary-color, #fff);
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
const COOKCLI_CARD_EDITOR_FIELDS = ["title", "tag", "show_tag_filter", "dashboard_path", "entry_id"];

const COOKCLI_CARD_EDITOR_LABELS = {
  title: "Titre",
  tag: "Tag unique",
  show_tag_filter: "Filtre par tags",
  dashboard_path: "Dashboard des recettes",
  entry_id: "Serveur CookCLI",
};

const COOKCLI_CARD_EDITOR_HELPERS = {
  title: "Titre de la carte. Par défaut : « Recettes ».",
  tag: "N'afficher que les recettes portant ce tag. Vide = toutes les recettes.",
  show_tag_filter: "Affiche des pills cliquables en haut de la liste pour filtrer par tag. Sans effet si un tag unique est choisi.",
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
    this._tagOptions = [];
    this._tagsLoadedFor = null;
  }

  setConfig(config) {
    this._config = config || {};
    this._maybeLoadTags();
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._maybeLoadTags();
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

  _buildSchema(dashboardOptions, tagOptions) {
    return [
      { name: "title", selector: { text: {} } },
      {
        name: "tag",
        selector: { select: { options: tagOptions, custom_value: true, mode: "dropdown" } },
      },
      { name: "show_tag_filter", selector: { boolean: {} } },
      {
        name: "dashboard_path",
        selector: { select: { options: dashboardOptions, custom_value: true, mode: "dropdown" } },
      },
      { name: "entry_id", selector: { config_entry: { integration: "cookcli" } } },
    ];
  }

  _ensureForm() {
    if (this._form) return;
    const form = document.createElement("ha-form");
    const options = this._dashboardOptions();
    this._optionsSignature = JSON.stringify([options, this._tagOptions]);
    form.schema = this._buildSchema(options, this._tagOptions);
    form.computeLabel = (schema) => COOKCLI_CARD_EDITOR_LABELS[schema.name] || schema.name;
    form.computeHelper = (schema) => COOKCLI_CARD_EDITOR_HELPERS[schema.name] || "";
    form.addEventListener("value-changed", (ev) => this._valueChanged(ev));
    this.appendChild(form);
    this._form = form;
  }

  _update() {
    if (!this._form) return;
    if (this._hass) {
      this._form.hass = this._hass;
    }
    const options = this._dashboardOptions();
    const signature = JSON.stringify([options, this._tagOptions]);
    if (signature !== this._optionsSignature) {
      this._optionsSignature = signature;
      this._form.schema = this._buildSchema(options, this._tagOptions);
    }
    const data = {};
    for (const name of COOKCLI_CARD_EDITOR_FIELDS) {
      if (this._config[name] !== undefined) data[name] = this._config[name];
    }
    data.show_tag_filter = this._config.show_tag_filter !== false;
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
      else if (name === "show_tag_filter" && v === true) delete config[name];
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

  // Récupère la liste des tags existants pour le sélecteur. Rechargée si le
  // serveur (entry_id) change ; l'échec laisse simplement la liste vide, la
  // saisie libre restant possible.
  _maybeLoadTags() {
    if (!this._hass) return;
    const key = this._config.entry_id || "";
    if (this._tagsLoadedFor === key) return;
    this._tagsLoadedFor = key;

    const msg = { type: "cookcli/recipes" };
    if (key) msg.entry_id = key;
    this._hass.connection
      .sendMessagePromise(msg)
      .then((result) => {
        const tags = new Set();
        for (const r of result.recipes || []) {
          const raw = r.tags;
          const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
          for (const t of list) {
            const s = String(t).trim();
            if (s) tags.add(s);
          }
        }
        this._tagOptions = [...tags]
          .sort((a, b) => a.localeCompare(b))
          .map((t) => ({ value: t, label: t }));
      })
      .catch(() => {
        this._tagOptions = [];
      })
      .finally(() => this._update());
  }
}

/**
 * Checklist d'ingrédients d'une étape (cases à cocher, état local).
 *
 * L'état coché est stocké dans localStorage du navigateur, par recette et par
 * étape (`storage_key`) : il n'est pas partagé entre appareils, ni lié à la
 * todo du Résumé. Config :
 *   type: custom:cookcli-checklist-card
 *   storage_key: chocolat-chaud.cook:2
 *   items: [{ quantity: "200 ml", name: "lait" }, ...]
 *   title: Ingrédients            # optionnel
 */
class CookCliChecklistCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.items)) {
      throw new Error("La carte a besoin d'une liste `items`.");
    }
    this._config = config;
    this._checked = this._load();

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("change", (ev) => this._onChange(ev));
      this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
    }
    this._render();
  }

  getCardSize() {
    return (this._config?.items?.length || 0) + 1;
  }

  _storageKey() {
    return `cookcli-checklist:${this._config.storage_key || "default"}`;
  }

  // Identifiant d'une ligne : index + libellé, pour rester correct si deux
  // lignes ont le même nom ou si la recette est modifiée.
  _itemId(item, index) {
    return `${index}:${item.quantity || ""} ${item.name || ""}`.trim();
  }

  _load() {
    try {
      const raw = localStorage.getItem(this._storageKey());
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      return new Set();
    }
  }

  _save() {
    try {
      localStorage.setItem(this._storageKey(), JSON.stringify([...this._checked]));
    } catch (err) {
      // localStorage indisponible : l'état reste valable jusqu'au prochain rendu.
    }
  }

  _onChange(ev) {
    const input = ev.target.closest("input[data-id]");
    if (!input) return;
    if (input.checked) this._checked.add(input.dataset.id);
    else this._checked.delete(input.dataset.id);
    this._save();
    this._render();
  }

  _onClick(ev) {
    if (ev.target.closest("[data-reset]")) {
      this._checked.clear();
      this._save();
      this._render();
    }
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  _render() {
    if (!this.shadowRoot) return;
    const items = this._config.items;
    const anyChecked = items.some((item, i) => this._checked.has(this._itemId(item, i)));

    const rows = items
      .map((item, i) => {
        const id = this._itemId(item, i);
        const checked = this._checked.has(id);
        return `
          <label class="row ${checked ? "done" : ""}">
            <input type="checkbox" data-id="${this._escape(id)}" ${checked ? "checked" : ""}>
            <span class="label">
              ${item.quantity ? `<strong>${this._escape(item.quantity)}</strong> ` : ""}${this._escape(item.name)}
            </span>
          </label>`;
      })
      .join("");

    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 8px 16px; }
        .title {
          padding: 8px 0 4px;
          font-size: var(--ha-card-header-font-size, 24px);
          font-weight: var(--ha-card-header-font-weight, 400);
          line-height: 32px;
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
          cursor: pointer;
          color: var(--primary-text-color);
        }
        .row input {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          accent-color: var(--primary-color);
          cursor: pointer;
        }
        .row.done .label {
          text-decoration: line-through;
          color: var(--secondary-text-color);
        }
        .reset {
          display: ${anyChecked ? "block" : "none"};
          margin-left: auto;
          padding: 4px 0 0;
          background: none;
          border: none;
          font: inherit;
          font-size: 0.85em;
          color: var(--primary-color);
          cursor: pointer;
        }
      </style>
      <ha-card>
        ${this._config.title ? `<div class="title">${this._escape(this._config.title)}</div>` : ""}
        ${rows}
        <button class="reset" data-reset>Tout décocher</button>
      </ha-card>
    `;
  }
}

/**
 * Enrobe circular-timer-card (karlis-vagalis/circular-timer-card) sans la
 * modifier : superpose un bouton "Démarrer" tant que le minuteur est à
 * l'état idle, avec la durée voulue (transmise à timer.start). Une fois
 * démarré, le bouton disparaît et les actions natives de la carte prennent
 * le relais (tap = pause/reprise, appui long = détail, double-tap = annuler).
 *
 * Config :
 *   type: custom:cookcli-timer-start-card
 *   entity: timer.xxx
 *   duration: "00:10:00"        # HH:MM:SS, passé à timer.start au clic
 *   label: "10 min"             # optionnel, affiché sur le bouton
 *   timer_card_config: {}       # optionnel, transmis tel quel à
 *                                # circular-timer-card (bins, color, layout…)
 */
class CookCliTimerStartCard extends HTMLElement {
  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("La carte a besoin d'une `entity` (timer).");
    }
    this._config = config;
    this._state = null;

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._buildDom();
  }

  getCardSize() {
    return 4;
  }

  _buildDom() {
    this.shadowRoot.innerHTML = `
      <style>
        .wrap { position: relative; }
        .overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          cursor: pointer;
          background: color-mix(in srgb, var(--card-background-color) 55%, transparent);
          border-radius: var(--ha-card-border-radius, 12px);
          transition: opacity 0.2s ease;
        }
        .overlay ha-icon { color: var(--primary-color); --mdc-icon-size: 32px; }
        .overlay span { font-size: 0.9em; color: var(--primary-text-color); }
        .overlay.hidden { opacity: 0; pointer-events: none; }
      </style>
      <div class="wrap">
        <div class="card-slot"></div>
        <div class="overlay hidden">
          <ha-icon icon="mdi:play-circle"></ha-icon>
          <span></span>
        </div>
      </div>
    `;
    this._overlay = this.shadowRoot.querySelector(".overlay");
    this._overlay.querySelector("span").textContent = this._config.label
      ? `Démarrer ${this._config.label}`
      : "Démarrer";
    this._overlay.addEventListener("click", (ev) => this._onStart(ev));

    this._inner = document.createElement("circular-timer-card");
    this._inner.setConfig({
      type: "custom:circular-timer-card",
      entity: this._config.entity,
      ...(this._config.timer_card_config || {}),
    });
    this.shadowRoot.querySelector(".card-slot").appendChild(this._inner);
  }

  _onStart(ev) {
    ev.stopPropagation();
    if (!this._hass || !this._config.duration) return;
    this._hass.callService("timer", "start", {
      entity_id: this._config.entity,
      duration: this._config.duration,
    });
  }

  set hass(hass) {
    this._hass = hass;
    if (this._inner) this._inner.hass = hass;
    const state = hass.states[this._config.entity]?.state;
    if (state !== this._state) {
      this._state = state;
      this._overlay.classList.toggle("hidden", state !== "idle");
    }
  }
}

customElements.define("cookcli-card", CookCliCard);
customElements.define("cookcli-card-editor", CookCliCardEditor);
customElements.define("cookcli-checklist-card", CookCliChecklistCard);
customElements.define("cookcli-timer-start-card", CookCliTimerStartCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "cookcli-card",
  name: "CookCLI Recipes",
  preview: false,
  description: "Liste navigable de tes recettes CookCLI.",
});