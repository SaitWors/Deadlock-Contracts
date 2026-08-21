"use strict";

const documents = {
  "/privacy": {
    id: "privacyDocument",
    title: "обработка данных",
  },
  "/terms": {
    id: "termsDocument",
    title: "условия",
  },
  "/support": {
    id: "supportDocument",
    title: "поддержка",
  },
  "/status": {
    id: "statusDocument",
    title: "статус",
  },
  "/changelog": {
    id: "changelogDocument",
    title: "изменения",
  },
  "/data-sources": {
    id: "dataSourcesDocument",
    title: "источники данных",
  },
};

const current =
  documents[window.location.pathname] ||
  documents["/privacy"];

const active =
  document.getElementById(current.id);

if (active) {
  active.classList.remove("hidden");
}

document.title =
  `Deadlock Contracts — ${current.title}`;

fetch("/api/status", {
  credentials: "same-origin",
  headers: {
    Accept: "application/json",
  },
})
  .then((response) => {
    if (!response.ok) {
      throw new Error("status");
    }

    return response.json();
  })
  .then((data) => {
    document
      .querySelectorAll(".legalContact")
      .forEach((link) => {
        if (data.contact_email) {
          link.textContent =
            data.contact_email;
          link.href =
            `mailto:${data.contact_email}`;
        } else {
          link.textContent =
            "владельца тестовой группы";
          link.removeAttribute("href");
        }
      });

    const status =
      document.getElementById(
        "publicStatus",
      );

    if (status) {
      status.textContent =
        JSON.stringify(data, null, 2);
    }
  })
  .catch(() => {
    document
      .querySelectorAll(".legalContact")
      .forEach((link) => {
        link.textContent =
          "владельца тестовой группы";
        link.removeAttribute("href");
      });

    const status =
      document.getElementById(
        "publicStatus",
      );

    if (status) {
      status.textContent =
        "Публичный status endpoint сейчас недоступен.";
    }
  });
