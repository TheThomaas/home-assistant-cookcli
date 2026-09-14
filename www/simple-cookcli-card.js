/**
 * Carte Lovelace pour l'intégration CookCLI.
 *
 * Consomme les commandes websocket exposées par l'intégration :
 * - cookcli/recipes -> liste (path, name, time, servings, tags)
 * - cookcli/recipe  -> détail (title, ingredients, cookware, sections)
 *
 * Limitation connue : les images de recettes ne sont pas affichées. Le
 * serveur CookCLI n'est joignable depuis le navigateur ni sur son port
 * ingress (restreint au Supervisor) ni sur son port direct (non exposé au
 * LAN) — il faudrait un endpoint de proxy côté intégration pour les servir.
 * Voir le README du projet pour plus de détails si tu veux l'ajouter.
 *
 * Installation :
 * 1. Copie ce fichier dans config/www/simple-cookcli-card.js
 * 2. Paramètres -> Tableaux de bord -> menu ⋮ -> Ressources -> Ajouter :
 *    URL "/local/simple-cookcli-card.js", type "Module JavaScript"
 * 3. Ajoute une carte manuelle sur un tableau de bord :
 *    type: custom:simple-cookcli-card
 *    title: Mes recettes
 */

class SimpleCookCliCard extends HTMLElement {
  static getStubConfig() {
    return { title: "Recettes" };
  }

  setConfig(config) {
    this._config = config || {};
    this._view = "list";
    this._recipes = null;
    this._selected = null;
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

  _wsMessage(extra) {
    const msg = { ...extra };
    if (this._config.entry_id) {
      msg.entry_id = this._config.entry_id;
    }
    return msg;
  }

  async _fetchRecipes() {
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const result = await this._hass.connection.sendMessagePromise(
        this._wsMessage({ type: "cookcli/recipes" })
      );
      this._recipes = result.recipes || [];
    } catch (err) {
      this._error = (err && err.message) || "Erreur inconnue";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _openRecipe(path) {
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const result = await this._hass.connection.sendMessagePromise(
        this._wsMessage({ type: "cookcli/recipe", path })
      );
      this._selected = result;
      this._view = "detail";
    } catch (err) {
      this._error = (err && err.message) || "Erreur inconnue";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _onClick(event) {
    const backEl = event.target.closest("[data-action='back']");
    if (backEl) {
      this._view = "list";
      this._selected = null;
      this._error = null;
      this._render();
      return;
    }
    const itemEl = event.target.closest("[data-path]");
    if (itemEl) {
      this._openRecipe(itemEl.dataset.path);
    }
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  _formatQuantity(quantity) {
    if (!quantity) return "";
    const value = quantity.value ?? "";
    const unit = quantity.unit ?? "";
    return `${value} ${unit}`.trim();
  }

  _renderStepItem(item) {
    switch (item.type) {
      case "text":
        return this._escape(item.value);
      case "ingredient": {
        const qty = this._formatQuantity(item.quantity);
        return `<span class="ingredient">${this._escape(item.name)}${
          qty ? ` (${this._escape(qty)})` : ""
        }</span>`;
      }
      case "cookware":
        return `<span class="cookware">${this._escape(item.name)}</span>`;
      case "timer": {
        const duration = item.duration ?? "";
        const unit = item.unit ?? "";
        return `<span class="timer">⏱ ${this._escape(String(duration))}${
          unit ? " " + this._escape(unit) : ""
        }</span>`;
      }
      default:
        return "";
    }
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
          <div class="recipe-row" data-path="${this._escape(r.path)}">
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

  _renderDetail() {
    if (this._loading) {
      return `<div class="state-msg">Chargement…</div>`;
    }
    if (this._error) {
      return `
        <button class="back-btn" data-action="back">← Retour à la liste</button>
        <div class="state-msg error">${this._escape(this._error)}</div>`;
    }
    if (!this._selected) return "";

    const r = this._selected;

    const ingredients = (r.ingredients || [])
      .map((i) => {
        const qty = this._formatQuantity(i.quantity);
        return `<li>${qty ? `<strong>${this._escape(qty)}</strong> ` : ""}${this._escape(
          i.name
        )}</li>`;
      })
      .join("");

    const cookware = (r.cookware || [])
      .map((c) => `<li>${this._escape(c.name)}</li>`)
      .join("");

    const sections = (r.sections || [])
      .map((section) => {
        const steps = (section.steps || [])
          .map(
            (step) =>
              `<li>${(step.items || [])
                .map((item) => this._renderStepItem(item))
                .join("")}</li>`
          )
          .join("");
        return `
          ${section.name ? `<h4>${this._escape(section.name)}</h4>` : ""}
          <ol class="steps">${steps}</ol>`;
      })
      .join("");

    return `
      <button class="back-btn" data-action="back">← Retour à la liste</button>
      ${
        r.image_url
          ? `<img class="recipe-hero" src="${this._escape(r.image_url)}" alt="" onerror="this.style.display='none'">`
          : ""
      }
      <h2>${this._escape(r.title || "")}</h2>
      ${cookware ? `<h4>Ustensiles</h4><ul class="cookware-list">${cookware}</ul>` : ""}
      <h4>Ingrédients</h4>
      <ul class="ingredients">${ingredients}</ul>
      <h4>Préparation</h4>
      ${sections}
    `;
  }

  _render() {
    if (!this.shadowRoot) return;
    const title = this._config.title || "Recettes";
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card header="${this._view === "list" ? this._escape(title) : ""}">
        <div class="card-content">
          ${this._view === "list" ? this._renderList() : this._renderDetail()}
        </div>
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
      .recipe-hero {
        width: 100%; max-height: 220px; object-fit: cover;
        border-radius: 8px; margin: 4px 0 8px; display: block;
      }
      .back-btn {
        background: none; border: none; color: var(--primary-color);
        font-size: 0.95em; cursor: pointer; padding: 12px 0 4px; display: block;
      }
      h2 { margin: 4px 0 8px; color: var(--primary-text-color); }
      h4 { margin: 16px 0 4px; color: var(--primary-text-color); }
      ul, ol { margin: 4px 0; padding-left: 20px; color: var(--primary-text-color); }
      ul.ingredients li, ul.cookware-list li { margin: 2px 0; }
      ol.steps li { margin: 8px 0; line-height: 1.5; }
      .ingredient { color: var(--primary-color); font-weight: 500; }
      .cookware { font-style: italic; color: var(--secondary-text-color); }
      .timer { color: var(--warning-color, #ff9800); font-weight: 500; }
    `;
  }
}

customElements.define("simple-cookcli-card", SimpleCookCliCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "simple-cookcli-card",
  name: "CookCLI Recipes",
  description: "Liste navigable de tes recettes CookCLI, avec ingrédients et étapes.",
});
