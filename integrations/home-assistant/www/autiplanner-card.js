/* AutiPlanner Lovelace card. Copy this file to /config/www and register it as /local/autiplanner-card.js. */
(() => {
  const PERIODS = ["morning", "afternoon", "evening", "night"];
  const PERIOD_LABELS = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
  const STATUS_GLYPHS = { pending: "○", completed: "✓", missed: "✕", skipped: "—" };
  const STATUS_LABELS = { pending: "Pending", completed: "Completed", missed: "Missed", skipped: "Skipped" };
  const PRIORITIES = ["must_do", "preferably", "optional"];
  const PRIORITY_LABELS = { must_do: "Must do", preferably: "Preferably", optional: "Optional" };
  const ICON_CATEGORIES = [
    ["all", "All"], ["appointments", "Appointments"], ["daily_tasks", "Daily tasks"],
    ["health_routines", "Health & routines"], ["free_time", "Free time"], ["home_errands", "Home & errands"],
    ["travel", "Travel"], ["social", "Social"], ["nature_weather", "Nature & weather"],
  ];
  const BUILT_IN_ICONS = [
    ["mdi:calendar", "Calendar", "appointments", "date plan", "🗓️"], ["mdi:calendar-check", "Calendar check", "appointments", "appointment done", "✅"],
    ["mdi:calendar-clock", "Calendar time", "appointments", "appointment schedule", "🕘"], ["mdi:calendar-plus", "Add to calendar", "appointments", "appointment new", "➕"],
    ["mdi:clock-outline", "Clock", "appointments", "time schedule", "🕘"], ["mdi:alarm", "Alarm", "appointments", "reminder wake", "⏰"],
    ["mdi:doctor", "Doctor", "appointments", "medical appointment", "🩺"], ["mdi:hospital-building", "Hospital", "appointments", "medical appointment", "🏥"],
    ["mdi:map-marker", "Location", "appointments", "place address", "📍"], ["mdi:phone", "Phone call", "appointments", "call contact", "📞"],
    ["mdi:email", "Email", "appointments", "mail contact", "✉️"],
    ["mdi:check-circle", "Complete", "daily_tasks", "done task", "✅"], ["mdi:clipboard-check", "Checklist", "daily_tasks", "task todo", "📋"],
    ["mdi:format-list-checks", "Task list", "daily_tasks", "todo routine", "☑️"], ["mdi:home", "Home", "daily_tasks", "routine place", "🏠"],
    ["mdi:bed", "Sleep", "daily_tasks", "rest night", "🛏️"], ["mdi:shower", "Shower", "daily_tasks", "wash hygiene", "🚿"],
    ["mdi:toilet", "Toilet", "daily_tasks", "bathroom hygiene", "🚻"], ["mdi:toothbrush", "Brush teeth", "daily_tasks", "hygiene morning", "🪥"],
    ["mdi:food-apple", "Eat fruit", "daily_tasks", "food snack healthy", "🍎"], ["mdi:food", "Meal", "daily_tasks", "eat lunch dinner", "🍽️"],
    ["mdi:water", "Drink water", "daily_tasks", "drink health", "💧"], ["mdi:pill", "Medicine", "health_routines", "medication health", "💊"],
    ["mdi:walk", "Walk", "health_routines", "exercise outside", "🚶"], ["mdi:run", "Run", "health_routines", "exercise sport", "🏃"],
    ["mdi:meditation", "Meditate", "health_routines", "calm mindfulness", "🧘"], ["mdi:heart-pulse", "Health", "health_routines", "wellbeing medical", "💗"],
    ["mdi:gamepad-variant", "Gaming", "free_time", "play hobby", "🎮"], ["mdi:book-open-page-variant", "Read", "free_time", "book hobby", "📖"],
    ["mdi:movie-open", "Movie", "free_time", "film watch", "🎬"], ["mdi:music", "Music", "free_time", "listen hobby", "🎵"],
    ["mdi:palette", "Art", "free_time", "draw paint hobby", "🎨"], ["mdi:camera", "Photography", "free_time", "photo hobby", "📷"],
    ["mdi:coffee", "Coffee", "free_time", "drink break", "☕"], ["mdi:flower", "Gardening", "free_time", "plant hobby", "🌸"],
    ["mdi:dog", "Dog", "free_time", "pet walk", "🐶"], ["mdi:cat", "Cat", "free_time", "pet", "🐱"],
    ["mdi:television", "Television", "free_time", "watch relax", "📺"], ["mdi:puzzle", "Puzzle", "free_time", "game hobby", "🧩"],
    ["mdi:broom", "Clean", "home_errands", "chore tidy", "🧹"], ["mdi:washing-machine", "Laundry", "home_errands", "chore clothes", "🧺"],
    ["mdi:vacuum", "Vacuum", "home_errands", "clean chore", "🧹"], ["mdi:trash-can", "Take out trash", "home_errands", "chore bin", "🗑️"],
    ["mdi:cart", "Shopping", "home_errands", "groceries errand", "🛒"], ["mdi:shopping", "Shopping bag", "home_errands", "store errand", "🛍️"],
    ["mdi:lightbulb", "Light", "home_errands", "home remember", "💡"], ["mdi:lock", "Lock", "home_errands", "door safety", "🔒"],
    ["mdi:key", "Key", "home_errands", "door leave", "🔑"], ["mdi:tools", "Repair", "home_errands", "fix chore", "🛠️"],
    ["mdi:car", "Car", "travel", "drive transport", "🚗"], ["mdi:bus", "Bus", "travel", "transport commute", "🚌"],
    ["mdi:train", "Train", "travel", "transport commute", "🚆"], ["mdi:airplane", "Airplane", "travel", "flight holiday", "✈️"],
    ["mdi:bicycle", "Bicycle", "travel", "cycle exercise", "🚲"], ["mdi:map", "Map", "travel", "route directions", "🗺️"],
    ["mdi:gas-station", "Fuel", "travel", "car errand", "⛽"], ["mdi:briefcase", "Work", "travel", "job office", "💼"],
    ["mdi:message", "Message", "social", "chat contact", "💬"], ["mdi:chat", "Chat", "social", "talk contact", "🗨️"],
    ["mdi:account", "Person", "social", "people contact", "👤"], ["mdi:account-group", "Group", "social", "people family", "👥"],
    ["mdi:heart", "Favourite", "social", "love care", "♥"], ["mdi:gift", "Gift", "social", "birthday present", "🎁"],
    ["mdi:party-popper", "Party", "social", "celebrate event", "🎉"], ["mdi:human-greeting", "Greet", "social", "hello people", "👋"],
    ["mdi:white-balance-sunny", "Sunny", "nature_weather", "weather day", "☀️"], ["mdi:weather-night", "Night", "nature_weather", "weather sleep", "🌙"],
    ["mdi:weather-rainy", "Rain", "nature_weather", "weather outside", "🌧️"], ["mdi:weather-cloudy", "Cloudy", "nature_weather", "weather", "☁️"],
    ["mdi:snowflake", "Snow", "nature_weather", "weather winter", "❄️"], ["mdi:leaf", "Nature", "nature_weather", "plant outside", "🍃"],
    ["mdi:weather-sunset", "Sunset", "nature_weather", "evening weather", "🌇"],
  ].map(([token, label, category, keywords, glyph]) => ({ token, label, category, keywords, glyph }));
  const MDI_CODEPOINTS = {
    "mdi:calendar": 0xF00ED, "mdi:calendar-check": 0xF00EF, "mdi:calendar-clock": 0xF00F0, "mdi:calendar-plus": 0xF00F3,
    "mdi:clock-outline": 0xF0150, "mdi:alarm": 0xF0020, "mdi:doctor": 0xF0A42, "mdi:hospital-building": 0xF02E1,
    "mdi:map-marker": 0xF034E, "mdi:phone": 0xF03F2, "mdi:email": 0xF01EE, "mdi:check-circle": 0xF05E0,
    "mdi:clipboard-check": 0xF014E, "mdi:format-list-checks": 0xF0756, "mdi:home": 0xF02DC, "mdi:bed": 0xF02E3,
    "mdi:shower": 0xF09A0, "mdi:toilet": 0xF09AB, "mdi:toothbrush": 0xF1129, "mdi:food-apple": 0xF025B,
    "mdi:food": 0xF025A, "mdi:water": 0xF058C, "mdi:pill": 0xF0402, "mdi:walk": 0xF0583, "mdi:run": 0xF070E,
    "mdi:meditation": 0xF117B, "mdi:heart-pulse": 0xF05F6, "mdi:gamepad-variant": 0xF0297, "mdi:book-open-page-variant": 0xF05DA,
    "mdi:movie-open": 0xF0FCE, "mdi:music": 0xF075A, "mdi:palette": 0xF03D8, "mdi:camera": 0xF0100,
    "mdi:coffee": 0xF0176, "mdi:flower": 0xF024A, "mdi:dog": 0xF0A43, "mdi:cat": 0xF011B,
    "mdi:television": 0xF0502, "mdi:puzzle": 0xF0431, "mdi:broom": 0xF00E2, "mdi:washing-machine": 0xF072A,
    "mdi:vacuum": 0xF19A1, "mdi:trash-can": 0xF0A79, "mdi:cart": 0xF0110, "mdi:shopping": 0xF049A,
    "mdi:lightbulb": 0xF0335, "mdi:lock": 0xF033E, "mdi:key": 0xF0306, "mdi:tools": 0xF1064,
    "mdi:car": 0xF010B, "mdi:bus": 0xF00E7, "mdi:train": 0xF052C, "mdi:airplane": 0xF001D,
    "mdi:bicycle": 0xF109C, "mdi:map": 0xF034D, "mdi:gas-station": 0xF0298, "mdi:briefcase": 0xF00D6,
    "mdi:message": 0xF0361, "mdi:chat": 0xF0B79, "mdi:account": 0xF0004, "mdi:account-group": 0xF0849,
    "mdi:heart": 0xF02D1, "mdi:gift": 0xF0E44, "mdi:party-popper": 0xF1056, "mdi:human-greeting": 0xF17C4,
    "mdi:white-balance-sunny": 0xF05A8, "mdi:weather-night": 0xF0594, "mdi:weather-rainy": 0xF0597, "mdi:weather-cloudy": 0xF0590,
    "mdi:snowflake": 0xF0717, "mdi:leaf": 0xF032A, "mdi:weather-sunset": 0xF059A,
  };
  const ICON_GLYPHS = Object.fromEntries(BUILT_IN_ICONS.map((icon) => [icon.token, String.fromCodePoint(MDI_CODEPOINTS[icon.token] || icon.glyph.codePointAt(0))]));
  Object.assign(ICON_GLYPHS, { "fa:coffee": "\uf0f4", "fa:medkit": "\uf0fa", "fa:heart": "\uf004", "fa:bed": "\uf236", "mdi:sleep": "☾" });
  const STYLE = `
    @font-face { font-family:"AutiPlanner MDI"; src:url("/local/autiplanner-icons.woff2") format("woff2"); font-display:block; }
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
    .icon-field { display:grid; grid-template-columns:auto 1fr auto auto; align-items:center; gap:8px; min-height:52px; padding:7px 8px; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:8px; }
    .icon-preview { display:grid; place-items:center; width:34px; height:34px; font-size:1.35rem; } .icon-copy { display:grid; min-width:0; gap:1px; } .icon-copy strong { font-size:.78rem; color:var(--muted); font-weight:500; } .icon-copy span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .icon-field button,.icon-dialog button { min-height:40px; padding:6px 10px; color:var(--text); background:transparent; border:1px solid var(--border); border-radius:8px; } .icon-field button.primary,.icon-dialog button.primary { color:var(--on-accent); background:var(--accent); border-color:var(--accent); }
    .icon-dialog { position:fixed; inset:0; width:min(620px,calc(100% - 28px)); max-width:none; max-height:calc(100% - 28px); margin:auto; padding:0; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:14px; box-shadow:0 18px 60px #0006; } .icon-dialog::backdrop { background:#0008; }
    .icon-dialog__surface { display:grid; gap:10px; padding:16px; } .icon-dialog__header,.icon-dialog__actions { display:flex; align-items:center; justify-content:space-between; gap:8px; } .icon-dialog__header h3 { flex:1; }
    .icon-categories { display:flex; gap:6px; overflow-x:auto; padding:2px 1px 5px; } .icon-categories button { flex:0 0 auto; min-height:38px; border-radius:999px; } .icon-categories button[aria-pressed="true"] { color:var(--on-accent); background:var(--accent); border-color:var(--accent); }
    .icon-result-count { color:var(--muted); font-size:.78rem; } .icon-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; max-height:310px; overflow:auto; padding:1px; } .icon-option { display:grid; place-items:center; gap:3px; min-height:74px; padding:6px 4px!important; text-align:center; } .icon-option[aria-pressed="true"] { background:color-mix(in srgb,var(--accent) 15%,var(--surface)); border-color:var(--accent); } .icon-option__glyph { font-size:1.45rem; line-height:1; } .icon-option__label { overflow:hidden; max-width:100%; font-size:.72rem; text-overflow:ellipsis; white-space:nowrap; }
    .add-actions { display:flex; justify-content:flex-end; gap:8px; } .add-actions button { padding:8px 13px; color:var(--on-accent); background:var(--accent); border:1px solid var(--accent); border-radius:8px; font-weight:650; }
    @media (max-width:520px) { .calendar { padding-inline:7px; } .day { min-height:48px; padding:5px 4px; } .add-grid { grid-template-columns:1fr; } .item button { padding-inline:8px; } .icon-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .icon-field { grid-template-columns:auto 1fr auto; } .icon-field [data-icon-picker="clear"] { grid-column:2 / -1; justify-self:end; } }
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
      this._iconValue = "";
      this._iconPickerOpen = false;
      this._iconQuery = "";
      this._iconCategory = "all";
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
        ${this._renderIconPicker()}
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
      return `<div class="item ${item.outcome} ${item.priority}"><span class="item-state" aria-label="${STATUS_LABELS[item.outcome]}">${STATUS_GLYPHS[item.outcome]}</span>${item.icon ? `<span class="item-icon" style="font-family:${escapeAttr(iconFontFor(item.icon, iconFont))}" aria-hidden="true">${escapeHtml(icon)}</span>` : ""}<span class="item-copy"><span class="item-title">${escapeHtml(item.title)}</span><span class="meta">${PRIORITY_LABELS[item.priority]} · ${STATUS_LABELS[item.outcome]}${formatTime(item) ? ` · ${formatTime(item)}` : ""}</span></span>${item.outcome === "pending" ? `<button data-command="complete" data-uid="${escapeAttr(item.uid)}" ${pending ? "disabled" : ""}>${pending ? "Saving…" : "Complete"}</button>` : ""}</div>`;
    }

    _renderAdd(date) {
      const icon = BUILT_IN_ICONS.find((option) => option.token === this._iconValue);
      const iconLabel = icon?.label || (this._iconValue ? "Custom icon" : "No icon selected");
      return `<form class="add" data-form="add"><h3>Add routine</h3><div class="add-grid"><label>Title<input name="title" required autocomplete="off"></label><label>Date<input name="date" type="date" value="${date}" required></label><label>Day part<select name="day_part">${PERIODS.map((period) => `<option value="${period}">${PERIOD_LABELS[period]}</option>`).join("")}</select></label><label>Priority<select name="priority"><option value="must_do">Must do</option><option value="preferably" selected>Preferably</option><option value="optional">Optional</option></select></label></div><div class="icon-field" aria-label="Routine icon"><input type="hidden" name="icon" value="${escapeAttr(this._iconValue)}"><span class="icon-preview" data-icon-preview style="font-family:${escapeAttr(iconFontFor(this._iconValue, "inherit"))}" aria-hidden="true">${this._iconValue ? escapeHtml(renderIcon(this._iconValue)) : "＋"}</span><span class="icon-copy"><strong>Icon</strong><span data-icon-label>${escapeHtml(iconLabel)}</span></span><button type="button" class="primary" data-icon-picker="open">Choose icon</button>${this._iconValue ? `<button type="button" data-icon-picker="clear">Clear</button>` : ""}</div><label>Description<textarea name="description"></textarea></label><div class="add-actions"><button type="submit">Add routine</button></div></form>`;
    }

    _renderIconPicker() {
      const selected = BUILT_IN_ICONS.find((option) => option.token === this._iconValue);
      return `<dialog class="icon-dialog" data-icon-dialog ${this._iconPickerOpen ? "open" : "hidden"} aria-labelledby="icon-dialog-title"><div class="icon-dialog__surface"><div class="icon-dialog__header"><h3 id="icon-dialog-title">Choose an icon</h3><button type="button" data-icon-picker="close" aria-label="Close icon picker">×</button></div><p class="subtitle">Built-in Material Design Icons</p><input data-icon-search type="search" value="${escapeAttr(this._iconQuery)}" placeholder="Search appointments, food, relax…" aria-label="Search icons"><div class="icon-categories" role="group" aria-label="Icon categories">${ICON_CATEGORIES.map(([value, label]) => `<button type="button" data-icon-category="${value}" aria-pressed="${this._iconCategory === value}">${label}</button>`).join("")}</div><div class="icon-result-count" data-icon-result-count>${filterBuiltInIcons(this._iconQuery, this._iconCategory).length} icons</div><div class="icon-grid" data-icon-grid>${renderIconOptions(this._iconQuery, this._iconCategory, selected?.token || this._iconValue)}</div><div class="icon-dialog__actions"><button type="button" data-icon-picker="clear">Clear icon</button><button type="button" class="primary" data-icon-picker="close">Done</button></div></div></dialog>`;
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
      this.shadowRoot.querySelectorAll("[data-icon-picker]").forEach((button) => button.addEventListener("click", () => {
        const action = button.dataset.iconPicker;
        if (action === "open") this._openIconPicker();
        if (action === "close") this._closeIconPicker();
        if (action === "clear") this._setIconValue("");
      }));
      this.shadowRoot.querySelector("[data-icon-search]")?.addEventListener("input", (event) => {
        this._iconQuery = event.target.value;
        this._updateIconPickerDom();
      });
      this.shadowRoot.querySelectorAll("[data-icon-category]").forEach((button) => button.addEventListener("click", () => {
        this._iconCategory = button.dataset.iconCategory || "all";
        this._updateIconPickerDom();
      }));
      this.shadowRoot.querySelectorAll("[data-icon-token]").forEach((button) => button.addEventListener("click", () => this._setIconValue(button.dataset.iconToken || "")));
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
        this._selectedDate = data.date; this._month = data.date.slice(0, 7); this._iconValue = ""; this._iconPickerOpen = false;
      } catch (error) { this._error = error?.message || "Unable to add routine"; }
      this._render();
    }

    _openIconPicker() {
      this._iconPickerOpen = true; this._iconQuery = ""; this._iconCategory = "all";
      const dialog = this.shadowRoot.querySelector("[data-icon-dialog]");
      if (dialog) {
        dialog.hidden = false;
        if (typeof dialog.showModal === "function") { try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); } } else dialog.setAttribute("open", "");
      }
      this._updateIconPickerDom();
      this.shadowRoot.querySelector("[data-icon-search]")?.focus();
    }

    _closeIconPicker() {
      this._iconPickerOpen = false;
      const dialog = this.shadowRoot.querySelector("[data-icon-dialog]");
      if (dialog) { if (typeof dialog.close === "function" && dialog.open) dialog.close(); else dialog.removeAttribute("open"); dialog.hidden = true; }
    }

    _setIconValue(value) {
      this._iconValue = value;
      const field = this.shadowRoot.querySelector("[data-form=add]");
      if (field) {
        const input = field.querySelector("[name=icon]"); if (input) input.value = value;
        const preview = field.querySelector("[data-icon-preview]"); if (preview) preview.textContent = value ? renderIcon(value) : "＋";
        const label = field.querySelector("[data-icon-label]"); const option = BUILT_IN_ICONS.find((icon) => icon.token === value); if (label) label.textContent = option?.label || (value ? "Custom icon" : "No icon selected");
        const clear = field.querySelector('[data-icon-picker="clear"]'); if (value && !clear) { const button = document.createElement("button"); button.type = "button"; button.dataset.iconPicker = "clear"; button.textContent = "Clear"; field.querySelector('[data-icon-picker="open"]')?.after(button); button.addEventListener("click", () => this._setIconValue("")); } else if (!value && clear) clear.remove();
      }
      this._updateIconPickerDom();
      if (value) this._closeIconPicker();
    }

    _updateIconPickerDom() {
      const grid = this.shadowRoot.querySelector("[data-icon-grid]");
      if (grid) grid.innerHTML = renderIconOptions(this._iconQuery, this._iconCategory, this._iconValue);
      const count = this.shadowRoot.querySelector("[data-icon-result-count]");
      if (count) count.textContent = `${filterBuiltInIcons(this._iconQuery, this._iconCategory).length} icons`;
      this.shadowRoot.querySelectorAll("[data-icon-category]").forEach((button) => { button.setAttribute("aria-pressed", String(button.dataset.iconCategory === this._iconCategory)); });
      this.shadowRoot.querySelectorAll("[data-icon-token]").forEach((button) => button.addEventListener("click", () => this._setIconValue(button.dataset.iconToken || "")));
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
  function iconFontFor(value, configuredFont) { return String(value || "").toLowerCase().startsWith("mdi:") ? "AutiPlanner MDI" : configuredFont; }
  function filterBuiltInIcons(query, category) {
    const normalized = String(query || "").trim().toLowerCase();
    return BUILT_IN_ICONS.filter((icon) => {
      const matchesCategory = category === "all" || icon.category === category;
      const matchesQuery = !normalized || [icon.token, icon.label, icon.keywords].some((value) => String(value).toLowerCase().includes(normalized));
      return matchesCategory && matchesQuery;
    });
  }
  function renderIconOptions(query, category, selectedToken) {
    const icons = filterBuiltInIcons(query, category);
    return icons.length ? icons.map((icon) => `<button type="button" class="icon-option" data-icon-token="${escapeAttr(icon.token)}" aria-pressed="${icon.token === selectedToken}" aria-label="Choose ${escapeAttr(icon.label)}"><span class="icon-option__glyph" style="font-family:AutiPlanner MDI" aria-hidden="true">${escapeHtml(renderIcon(icon.token))}</span><span class="icon-option__label">${escapeHtml(icon.label)}</span></button>`).join("") : `<p class="empty">No icons match that search.</p>`;
  }
  function priorityRank(value) { return value === "must_do" ? 0 : value === "optional" ? 2 : 1; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char])); }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g,"&#96;"); }

  customElements.define("autiplanner-card", AutiPlannerCard);
})();
