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

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._recipes === null && !this._loading) {
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
    if (this._loading) {
      return `<div class="state-msg">Chargement…</div>`;
    }
    if (this._error) {
      return `<div class="state-msg error">${this._escape(this._error)}</div>`;
    }
    if (!this._recipes || this._recipes.length === 0) {
      return `<div class="state-msg">Aucune recette trouvée.</div>`;
    }

    const rows = this._recipes
      .map((r) => {
        const meta = [];
        if (r.time) meta.push(`<span>⏱ ${this._escape(r.time)}</span>`);
        if (r.servings) meta.push(`<span>🍽 ${this._escape(String(r.servings))}</span>`);
        const thumb = r.image_url
          ? `<img class="recipe-thumb" src="${this._escape(r.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="recipe-thumb recipe-thumb-placeholder"></div>`;
        return `
          <div class="recipe-row" data-view-path="${this._escape(r.view_path)}">
            ${thumb}
            <div class="recipe-row-text">
              <div class="recipe-name">${this._escape(r.name)}</div>
              <div class="recipe-meta">${meta.join("")}</div>
            </div>
          </div>`;
      })
      .join("");

    return `<div class="recipe-list">${rows}</div>`;
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
      .recipe-list { display: flex; flex-direction: column; }
      .recipe-row {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 4px; border-bottom: 1px solid var(--divider-color);
        cursor: pointer;
      }
      .recipe-row:last-child { border-bottom: none; }
      .recipe-row:hover { background: var(--secondary-background-color); }
      .recipe-thumb {
        width: 56px; height: 56px; border-radius: 8px; object-fit: cover;
        flex-shrink: 0; background: var(--secondary-background-color);
      }
      .recipe-thumb-placeholder { background: var(--divider-color); }
      .recipe-row-text { min-width: 0; }
      .recipe-name {
        font-weight: 500; color: var(--primary-text-color);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .recipe-meta {
        display: flex; gap: 12px; font-size: 0.85em;
        color: var(--secondary-text-color); white-space: nowrap;
      }
    `;
  }
}

customElements.define("cookcli-card", CookCliCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "cookcli-card",
  name: "CookCLI Recipes",
  description: "Liste navigable de tes recettes CookCLI.",
});
