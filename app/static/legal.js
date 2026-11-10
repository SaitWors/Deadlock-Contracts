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
  fetch("/api/status", {
    credentials: "same-origin",
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
      const names = english
        ? {
            web_api: "Web API",
            database: "Database",
            match_provider: "Match provider",
            companion_ingest: "Companion ingest",
            reward_delivery: "Reward delivery",
            companion_ads: "Desktop ads",
          }
        : {
            web_api: "Web API",
            database: "База данных",
            match_provider: "Провайдер матчей",
            companion_ingest: "Приём Companion",
            reward_delivery: "Выдача наград",
            companion_ads: "Desktop-реклама",
          };
      status.replaceChildren();
      Object.entries(data.components || {}).forEach(([key, value]) => {
        const item = document.createElement("div");
        item.className = "public-status-item";
        const label = document.createElement("span");
        const state = document.createElement("strong");
        label.textContent = names[key] || key;
        state.textContent = String(value || "unknown").replaceAll("_", " ");
        item.append(label, state);
        status.append(item);
      });
      const meta = document.createElement("p");
      meta.className = "public-status-meta";
      const updated = data.updated_at
        ? new Date(data.updated_at).toLocaleString(english ? "en-US" : "ru-RU")
        : "—";
      const incidents = Array.isArray(data.incident_history) ? data.incident_history.length : 0;
      meta.textContent = english
        ? `Version ${data.version || "—"} · Updated ${updated} · ${incidents ? `${incidents} recorded incident(s)` : "No recorded incidents"}`
        : `Версия ${data.version || "—"} · Обновлено ${updated} · ${incidents ? `Зафиксировано инцидентов: ${incidents}` : "Зафиксированных инцидентов нет"}`;
      status.append(meta);
    })
    .catch(() => {
      status.textContent = english
        ? "The public status endpoint is currently unavailable."
        : "Публичный status endpoint сейчас недоступен.";
    });
}
