"use strict";

const documents = {
  "/privacy": {
    id: "privacyDocument",
  },
  "/terms": {
    id: "termsDocument",
  },
  "/support": {
    id: "supportDocument",
  },
  "/status": {
    id: "statusDocument",
  },
  "/changelog": {
    id: "changelogDocument",
  },
  "/data-sources": {
    id: "dataSourcesDocument",
  },
};

const normalizedPath = window.location.pathname.replace(/^\/(?:ru|en)(?=\/)/, "");
const current =
  documents[normalizedPath] ||
  documents["/privacy"];

const active =
  document.getElementById(current.id);

if (active) {
  active.classList.remove("hidden");
}

const english = document.documentElement.lang === "en";
document.querySelectorAll("[data-document-language]").forEach((link) => {
  const language = link.dataset.documentLanguage;
  const path = documents[normalizedPath] ? normalizedPath : "/privacy";
  if (language === "ru" || language === "en") link.href = `/${language}${path}`;
});

const status = document.getElementById("publicStatus");

if (status) {
  const refresh = document.getElementById("refreshStatus");
  const states = english
    ? { operational: "Enabled by the service", configured: "Connection configured", unconfigured: "Not configured", enabled: "Enabled", disabled: "Disabled", paused: "Paused", ready: "Ready" }
    : { operational: "Включено на стороне сервиса", configured: "Подключение настроено", unconfigured: "Не настроено", enabled: "Включено", disabled: "Выключено", paused: "Приостановлено", ready: "Готово" };
  let loading = false;
  const loadStatus = () => {
    if (loading) return;
    loading = true;
    status.setAttribute("aria-busy", "true");
    if (refresh) refresh.setAttribute("aria-disabled", "true");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    return fetch("/api/status", {
    credentials: "same-origin",
    cache: "no-store",
    signal: controller.signal,
    headers: {
      Accept: "application/json",
      "Accept-Language": english ? "en" : "ru",
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("status");
      }
      return response.json();
    })
    .then((data) => {
      if (!data || typeof data.components !== "object" || data.components === null || Array.isArray(data.components)) {
        throw new Error("status payload");
      }
      const names = english
        ? {
            web_api: "Website service",
            database: "Database",
            match_provider: "Match results",
            companion_ingest: "Companion data reception",
            reward_delivery: "Reward delivery",
            companion_ads: "Desktop ads",
          }
        : {
            web_api: "Сервис сайта",
            database: "База данных",
            match_provider: "Результаты матчей",
            companion_ingest: "Приём данных Companion",
            reward_delivery: "Выдача наград",
            companion_ads: "Реклама в приложении",
          };
      status.replaceChildren();
      Object.entries(names).forEach(([key, name]) => {
        const value = data.components[key];
        const item = document.createElement("div");
        item.className = "public-status-item";
        const label = document.createElement("span");
        const state = document.createElement("strong");
        label.textContent = name;
        state.textContent = Object.hasOwn(states, value) ? states[value] : (english ? "No information" : "Нет сведений");
        if (["paused", "unconfigured"].includes(value)) item.dataset.state = "attention";
        item.append(label, state);
        status.append(item);
      });
      const meta = document.createElement("p");
      meta.className = "public-status-meta";
      const date = typeof data.updated_at === "string" ? new Date(data.updated_at) : null;
      const updated = date && !Number.isNaN(date.getTime())
        ? date.toLocaleString(english ? "en-US" : "ru-RU", { timeZoneName: "short" }) : "—";
      const incidents = Array.isArray(data.incident_history) ? data.incident_history.length : 0;
      meta.textContent = english
        ? `Version ${data.version || "—"} · Retrieved ${updated} · ${incidents ? `${incidents} published incident(s)` : "No incidents published"}`
        : `Версия ${data.version || "—"} · Сведения получены: ${updated} · ${incidents ? `Опубликовано инцидентов: ${incidents}` : "Инциденты не опубликованы"}`;
      status.append(meta);
    })
    .catch(() => {
      status.textContent = english
        ? "Could not retrieve service information. Try again or visit support."
        : "Не удалось получить сведения о сервисе. Повторите попытку или откройте поддержку.";
    })
    .finally(() => {
      window.clearTimeout(timeout);
      loading = false;
      status.setAttribute("aria-busy", "false");
      if (refresh) refresh.setAttribute("aria-disabled", "false");
    });
  };
  if (refresh) {
    refresh.hidden = false;
    refresh.addEventListener("click", loadStatus);
  }
  loadStatus();
}
