"use strict";
const documentType = window.location.pathname === "/terms" ? "terms" : window.location.pathname === "/support" ? "support" : "privacy";
const documentId = documentType === "terms" ? "termsDocument" : documentType === "support" ? "supportDocument" : "privacyDocument";
const active = document.getElementById(documentId);
active.classList.remove("hidden");
const title = documentType === "terms" ? "условия" : documentType === "support" ? "поддержка" : "обработка данных";
document.title = `Deadlock Contracts — ${title}`;
fetch("/api/status", { credentials: "same-origin", headers: { Accept: "application/json" } })
  .then((response) => response.ok ? response.json() : Promise.reject(new Error("status")))
  .then((data) => {
    document.querySelectorAll(".legalContact").forEach((link) => {
      if (data.contact_email) {
        link.textContent = data.contact_email;
        link.href = `mailto:${data.contact_email}`;
      } else {
        link.textContent = "владельца тестовой группы";
        link.removeAttribute("href");
      }
    });
  })
  .catch(() => {
    document.querySelectorAll(".legalContact").forEach((link) => {
      link.textContent = "владельца тестовой группы";
      link.removeAttribute("href");
    });
  });
