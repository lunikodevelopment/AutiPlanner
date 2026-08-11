/*
 * AutiPlanner bridge panel for the HACS Navet integration.
 *
 * Navet's HACS package ships a compiled panel bundle, while the AutiPlanner
 * repository keeps the Navet-facing widget as provider-neutral source. This
 * small panel wrapper gives that compiled installation a stable panel entry
 * point and reuses the same Home Assistant card UI and data boundary.
 */
(() => {
  const CARD_URL = "/local/autiplanner-card.js";

  class AutiPlannerNavetPanel extends HTMLElement {
    constructor() {
      super();
      this._config = { entity: "todo.autiplanner", theme: "system", sort_priority: true };
      this._hass = null;
      this._card = null;
      this.attachShadow({ mode: "open" });
    }

    setConfig(config) {
      this._config = { ...this._config, ...(config || {}) };
      this._card?.setConfig(this._config);
    }

    set hass(value) {
      this._hass = value;
      if (this._card) this._card.hass = value;
    }

    connectedCallback() {
      this._render();
      this._loadCard();
    }

    _render() {
      this.shadowRoot.innerHTML = `<style>
        :host { display:block; min-height:100%; box-sizing:border-box; background:var(--primary-background-color,#f8f7f3); color:var(--primary-text-color,#24231f); }
        main { box-sizing:border-box; width:min(1180px,100%); min-height:100vh; margin:0 auto; padding:clamp(12px,3vw,32px); }
        autiplanner-card { display:block; width:100%; }
        @media (max-width:520px) { main { padding:8px; } }
      </style><main aria-label="AutiPlanner"><autiplanner-card></autiplanner-card></main>`;
      this._card = this.shadowRoot.querySelector("autiplanner-card");
    }

    async _loadCard() {
      if (!customElements.get("autiplanner-card")) await loadClassicScript(CARD_URL);
      await customElements.whenDefined("autiplanner-card");
      if (!this.isConnected || !this._card) return;
      this._card.setConfig(this._config);
      if (this._hass) this._card.hass = this._hass;
    }
  }

  function loadClassicScript(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-autiplanner-card="${url}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (customElements.get("autiplanner-card")) resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.dataset.autiplannerCard = url;
      script.async = true;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error(`Unable to load ${url}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  customElements.define("autiplanner-navet-panel", AutiPlannerNavetPanel);
})();
