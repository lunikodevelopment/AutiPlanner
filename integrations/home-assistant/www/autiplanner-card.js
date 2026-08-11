/* AutiPlanner Lovelace card. Copy this file to /config/www and register it as /local/autiplanner-card.js. */
(() => {
  const PERIODS = ["morning", "afternoon", "evening", "night"];
  const PERIOD_LABELS = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
  const STATUS_GLYPHS = { pending: "○", completed: "✓", missed: "✕", skipped: "—" };
  const STATUS_LABELS = { pending: "Pending", completed: "Completed", missed: "Missed", skipped: "Skipped" };
  const PRIORITIES = ["must_do", "preferably", "optional"];
  const PRIORITY_LABELS = { must_do: "Must do", preferably: "Preferably", optional: "Optional" };
  const ICON_GLYPHS = {
    "fa:coffee": "\uf0f4", "fa:medkit": "\uf0fa", "fa:heart": "\uf004", "fa:bed": "\uf236",
    "mdi:coffee": "☕", "mdi:pill": "💊", "mdi:heart": "♥", "mdi:sleep": "☾",
  };
  const STYLE = `
    :host { display:block; color:#24231f; font:400 15px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .card { --bg:#f8f7f3; --surface:#fff; --border:#d8d5cc; --text:#24231f; --muted:#69665d; --accent:#3f6957; --on-accent:#fff; --danger:#9b4d48; overflow:hidden; background:var(--bg); border:1px solid var(--border); border-radius:12px; }
    .card[data-theme="dark"] { --bg:#252525; --surface:#30302f; --border:#4b4a46; --text:#f1f0eb; --muted:#c3c0b8; --accent:#9bc8aa; --on-accent:#17231b; --danger:#f0aaa2; }
    .card[data-theme="black"] { --bg:#000; --surface:#11110f; --border:#4c4b45; --text:#fff; --muted:#d0cdc4; --accent:#b2d7bd; --on-accent:#101411; --danger:#ffb5ae; }
    .topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px 12px; border-bottom:1px solid var(--border); }
    h2,h3,p { margin:0; } h2 { font-size:1.08rem; font-weight:650; } h3 { font-size:.94rem; font-weight:650; }
    .subtitle,.meta,.empty { color:var(--muted); font-size:.82rem; }
    button,input,textarea,select { font:inherit; } button { min-height:44px; cursor:pointer; }
    button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible { outline:3px solid color-mix(in srgb,var(--accent) 72%,white); outline-offset:2px; }
    .nav { display:flex; gap:6px; } .nav button,.close { min-width:44px; padding:7px 10px; color:var(--text); background:transparent; border:1px solid var(--border); border-radius:8px; }
    .calendar { display:grid; gap:1px; padding:10px 12px 6px; background:var(--border); } .calendar-row { display:grid; grid-template-columns:34px repeat(7,minmax(0,1fr)); gap:1px; }
    .heading,.week-number { display:grid; place-items:center; min-height:28px; color:var(--muted); background:var(--bg); font-size:.72rem; font-weight:650; }
    .day { display:flex; align-items:flex-start; justify-content:space-between; gap:4px; min-height:54px; padding:7px; color:var(--text); background:var(--surface); border:0; text-align:left; }
    .day:hover,.day:focus-visible { background:color-mix(in srgb,var(--accent) 12%,var(--surface)); } .day.selected { outline:2px solid var(--accent); outline-offset:-2px; }
    .day.outside { color:var(--muted); opacity:.62; } .day-count { min-width:20px; padding:1px 4px; color:#fff; background:#3f8a5b; border-radius:6px; font-size:.7rem; text-align:center; } .day-count.preferably { background:#c28a16; } .day-count.optional { background:#b54848; }
    .details { padding:14px 16px 16px; border-top:1px solid var(--border); } .details-header { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .periods { display:grid; gap:14px; } .period { display:grid; gap:5px; } .period h3 { color:var(--muted); }
    .legend { display:flex; flex-wrap:wrap; gap:12px; padding:8px 16px 0; color:var(--muted); font-size:.75rem; } .legend span { display:inline-flex; align-items:center; gap:5px; } .legend i { width:8px; height:8px; background:#3f8a5b; border-radius:50%; } .legend i.preferably { background:#c28a16; } .legend i.optional { background:#b54848; }
    .item { display:flex; align-items:center; gap:9px; min-height:48px; padding:5px 7px; border-bottom:1px solid color-mix(in srgb,var(--border) 72%,transparent); border-radius:6px; } .item.must_do { background:color-mix(in srgb,#3f8a5b 12%,var(--surface)); } .item.preferably { background:color-mix(in srgb,#c28a16 12%,var(--surface)); } .item.optional { background:color-mix(in srgb,#b54848 12%,var(--surface)); }
    .item:last-child { border-bottom:0; } .item-state,.item-icon { display:grid; place-items:center; flex:0 0 24px; width:24px; height:24px; color:var(--accent); font-size:1.15rem; }
    .item-icon { color:var(--text); font-size:1rem; }
    .item-copy { display:grid; flex:1; min-width:0; gap:1px; } .item-title { overflow:hidden; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
    .item.pending .item-state,.item.pending .item-icon { color:var(--accent); } .item.missed .item-state,.item.missed .item-icon { color:var(--danger); } .item.skipped .item-state,.item.skipped .item-icon { color:var(--muted); }
    .item button { padding:7px 10px; color:var(--on-accent); background:var(--accent); border:1px solid var(--accent); border-radius:8px; font-size:.82rem; font-weight:650; }
    .item button.secondary { color:var(--text); background:transparent; border-color:var(--border); } .item button:disabled { cursor:wait; opacity:.55; }
    .message { padding:14px 16px; color:var(--danger); } .empty { padding:5px 0; }
    .add { display:grid; gap:9px; padding:14px 16px 16px; border-top:1px solid var(--border); } .add h3 { margin-bottom:2px; }
    .add-grid { display:grid; grid-template-columns:1fr 1fr; gap:9px; } label { display:grid; gap:4px; color:var(--muted); font-size:.8rem; }
    input,textarea,select { width:100%; min-height:44px; padding:8px 10px; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:8px; } textarea { min-height:72px; resize:vertical; }
    .add-actions { display:flex; justify-content:flex-end; gap:8px; } .add-actions button { padding:8px 13px; color:var(--on-accent); background:var(--accent); border:1px solid var(--accent); border-radius:8px; font-weight:650; }
    @media (max-width:520px) { .calendar { padding-inline:7px; } .day { min-height:48px; padding:5px 4px; } .add-grid { grid-template-columns:1fr; } .item button { padding-inline:8px; } }
    @media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto!important; transition-duration:.01ms!important; } }
  `;

  class AutiPlannerCard extends HTMLElement {
    constructor() {
      super();
      this._config = { entity: "todo.autiplanner", theme: "system", sort_priority: true };
      this._month = toMonthKey(new Date());
      this._selectedDate = null;
      this._error = "";
      this._busy = new Set();
      this.attachShadow({ mode: "open" });
    }

    setConfig(config) {
      if (!config || typeof config.entity !== "string") throw new Error("AutiPlanner card requires an entity, for example todo.autiplanner");
      this._config = { ...this._config, ...config };
      if (typeof config.month === "string") this._month = config.month;
      this._render();
    }

    set hass(value) { this._hass = value; this._render(); }
    getCardSize() { return 8; }

    _render() {
      if (!this.shadowRoot) return;
      const state = this._hass?.states?.[this._config.entity];
      const records = Array.isArray(state?.attributes?.autiplanner_items) ? state.attributes.autiplanner_items : [];
      const items = records.filter((item) => item && typeof item.uid === "string" && typeof item.title === "string" && PERIODS.includes(item.day_part) && STATUS_GLYPHS[item.outcome]).map((item) => ({ ...item, priority: PRIORITIES.includes(item.priority) ? item.priority : "preferably" }));
      if (this._config.sort_priority !== false) items.sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.date.localeCompare(right.date));
      const iconFont = this._config.icon_font || state?.attributes?.icon_font || "Material Design Icons";
      const activeDate = this._selectedDate && items.some((item) => item.date === this._selectedDate) ? this._selectedDate : this._selectedDate || firstDateInMonth(this._month, items);
      this._selectedDate = activeDate;
      const byDate = new Map();
      items.forEach((item) => byDate.set(item.date, [...(byDate.get(item.date) || []), item]));
      const days = monthDays(this._month);
      const theme = this._config.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : this._config.theme;
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><section class="card" data-theme="${escapeAttr(theme)}" style="--routine-icon-font:${escapeAttr(iconFont)}">
        <div class="topbar"><div><h2>${escapeHtml(this._config.title || "AutiPlanner")}</h2><p class="subtitle">${escapeHtml(formatMonth(this._month))}</p></div><div class="nav"><button data-action="prev" aria-label="Previous month">‹</button><button data-action="today" aria-label="Select current month">Today</button><button data-action="next" aria-label="Next month">›</button></div></div>
        <div class="legend" aria-label="Routine priority legend"><span><i aria-hidden="true"></i>Must do</span><span><i class="preferably" aria-hidden="true"></i>Preferably</span><span><i class="optional" aria-hidden="true"></i>Optional</span></div>
        ${this._error ? `<p class="message" role="alert">${escapeHtml(this._error)}</p>` : ""}
        ${renderCalendar(days, activeDate, byDate, this._month)}
        ${this._renderDetails(activeDate, items, iconFont)}
        ${this._renderAdd(activeDate)}
      </section>`;
      this._bindEvents();
    }

    _renderDetails(date, items, iconFont) {
      const dayItems = items.filter((item) => item.date === date).slice().sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));
      return `<div class="details"><div class="details-header"><h3>${escapeHtml(formatDate(date))}</h3><span class="meta">${dayItems.length} ${dayItems.length === 1 ? "routine" : "routines"}</span></div><div class="periods">${PERIODS.map((period) => {
        const periodItems = dayItems.filter((item) => item.day_part === period);
        return `<section class="period"><h3>${PERIOD_LABELS[period]}</h3>${periodItems.length ? periodItems.map((item) => this._renderItem(item, iconFont)).join("") : `<p class="empty">No routines</p>`}</section>`;
      }).join("")}</div></div>`;
    }

    _renderItem(item, iconFont) {
      const icon = item.icon ? renderIcon(item.icon) : STATUS_GLYPHS[item.outcome];
      const pending = this._busy.has(item.uid);
      return `<div class="item ${item.outcome} ${item.priority}"><span class="item-state" aria-label="${STATUS_LABELS[item.outcome]}">${STATUS_GLYPHS[item.outcome]}</span>${item.icon ? `<span class="item-icon" style="font-family:${escapeAttr(iconFont)}" aria-hidden="true">${escapeHtml(icon)}</span>` : ""}<span class="item-copy"><span class="item-title">${escapeHtml(item.title)}</span><span class="meta">${PRIORITY_LABELS[item.priority]} · ${STATUS_LABELS[item.outcome]}${formatTime(item) ? ` · ${formatTime(item)}` : ""}</span></span>${item.outcome === "pending" ? `<button data-command="complete" data-uid="${escapeAttr(item.uid)}" ${pending ? "disabled" : ""}>${pending ? "Saving…" : "Complete"}</button>` : ""}</div>`;
    }

    _renderAdd(date) {
      return `<form class="add" data-form="add"><h3>Add routine</h3><div class="add-grid"><label>Title<input name="title" required autocomplete="off"></label><label>Date<input name="date" type="date" value="${date}" required></label><label>Day part<select name="day_part">${PERIODS.map((period) => `<option value="${period}">${PERIOD_LABELS[period]}</option>`).join("")}</select></label><label>Priority<select name="priority"><option value="must_do">Must do</option><option value="preferably" selected>Preferably</option><option value="optional">Optional</option></select></label><label>Icon token<input name="icon" placeholder="mdi:coffee or fa:coffee"></label></div><label>Description<textarea name="description"></textarea></label><div class="add-actions"><button type="submit">Add routine</button></div></form>`;
    }

    _bindEvents() {
      this.shadowRoot.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (action === "prev" || action === "next") this._month = shiftMonth(this._month, action === "next" ? 1 : -1);
        if (action === "today") this._month = toMonthKey(new Date());
        this._selectedDate = firstDateInMonth(this._month, this._items());
        this._render();
      }));
      this.shadowRoot.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => {
        this._selectedDate = button.dataset.date;
        if (this._selectedDate) this._month = this._selectedDate.slice(0, 7);
        this._render();
      }));
      this.shadowRoot.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => this._runCommand(button.dataset.command, button.dataset.uid)));
      this.shadowRoot.querySelector("[data-form=add]")?.addEventListener("submit", (event) => this._addRoutine(event));
    }

    _items() {
      const state = this._hass?.states?.[this._config.entity];
      return Array.isArray(state?.attributes?.autiplanner_items) ? state.attributes.autiplanner_items : [];
    }

    async _runCommand(service, uid) {
      if (!service || !uid || !this._hass) return;
      this._busy.add(uid); this._error = ""; this._render();
      try { await this._hass.callService("autiplanner", service, { entity_id: this._config.entity, uid }); }
      catch (error) { this._error = error?.message || `Unable to ${service} routine`; }
      finally { this._busy.delete(uid); this._render(); }
    }

    async _addRoutine(event) {
      event.preventDefault();
      if (!this._hass) return;
      const form = event.currentTarget; const data = Object.fromEntries(new FormData(form).entries());
      this._error = "";
      try {
        await this._hass.callService("autiplanner", "add_routine", { entity_id: this._config.entity, title: data.title, date: data.date, day_part: data.day_part, priority: data.priority, icon: data.icon, description: data.description });
        this._selectedDate = data.date; this._month = data.date.slice(0, 7);
      } catch (error) { this._error = error?.message || "Unable to add routine"; }
      this._render();
    }
  }

  function monthDays(month) {
    const first = new Date(`${month}-01T12:00:00Z`); if (Number.isNaN(first.getTime())) return [];
    const start = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)); const end = new Date(last); end.setUTCDate(end.getUTCDate() + (7 - ((last.getUTCDay() + 6) % 7) - 1));
    const result = []; for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) { const day = new Date(cursor); result.push({ date:day.toISOString().slice(0,10), day:day.getUTCDate(), inMonth:day.getUTCMonth() === first.getUTCMonth(), week:day.getUTCDay() === 1 ? isoWeek(day) : "" }); } return result;
  }
  function renderCalendar(days, activeDate, byDate, month) {
    const rows = [];
    for (let index = 0; index < days.length; index += 7) {
      const week = days.slice(index, index + 7);
      rows.push(`<span class="week-number" aria-label="Week ${week[0]?.week ?? ""}">${week[0]?.week ?? ""}</span>${week.map((day) => { const dayItems = byDate.get(day.date) || []; const priority = dayItems.slice().sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))[0]?.priority || "preferably"; return `<button class="day${day.date === activeDate ? " selected" : ""}${day.inMonth ? "" : " outside"}" data-date="${day.date}" role="gridcell" aria-label="${escapeAttr(formatDate(day.date) + (dayItems.length ? `, ${dayItems.length} routines` : ", no routines"))}" aria-pressed="${day.date === activeDate}"><span>${day.day}</span>${dayItems.length ? `<span class="day-count ${priority}">${dayItems.length}</span>` : ""}</button>`; }).join("")}`);
    }
    return `<div class="calendar" role="grid" aria-label="${escapeAttr(formatMonth(month))}"><div class="heading" role="columnheader">Wk</div>${["Mo","Tu","We","Th","Fr","Sa","Su"].map((day) => `<div class="heading" role="columnheader">${day}</div>`).join("")}${rows.map((row) => `<div class="calendar-row">${row}</div>`).join("")}</div>`;
  }
  function isoWeek(date) { const thursday = new Date(date); thursday.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7)); const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(),0,4)); return 1 + Math.round(((thursday-jan4)/86400000 - 3 + ((jan4.getUTCDay()+6)%7))/7); }
  function toMonthKey(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`; }
  function shiftMonth(month, delta) { const date = new Date(`${month}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth()+delta); return toMonthKey(date); }
  function firstDateInMonth(month, items) { return items.find((item) => typeof item.date === "string" && item.date.startsWith(month))?.date || `${month}-01`; }
  function formatMonth(month) { const date = new Date(`${month}-01T12:00:00Z`); return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric",timeZone:"UTC"}).format(date); }
  function formatDate(value) { const date = new Date(`${value}T12:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined,{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"}).format(date); }
  function formatTime(item) { const match = /T(\d{2}:\d{2})/.exec(item.start || item.due || ""); return match?.[1] || ""; }
  function renderIcon(value) { return ICON_GLYPHS[String(value).toLowerCase()] || (String(value).startsWith("unicode:") ? String(value).slice(8) : String(value)); }
  function priorityRank(value) { return value === "must_do" ? 0 : value === "optional" ? 2 : 1; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char])); }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g,"&#96;"); }

  customElements.define("autiplanner-card", AutiPlannerCard);
})();
