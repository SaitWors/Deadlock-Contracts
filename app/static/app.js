"use strict";

const state = {
  csrf: null,
  user: null,
  board: null,
  selected: new Set(),
  pollTimer: null,
  busy: false,
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (state.csrf && !["GET", "HEAD"].includes((options.method || "GET").toUpperCase())) {
    headers.set("X-CSRF-Token", state.csrf);
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    redirect: "follow",
  });
  let payload = null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.detail || `Ошибка HTTP ${response.status}`);
    error.status = response.status;
    error.requestId = payload?.request_id || response.headers.get("x-request-id");
    throw error;
  }
  return payload;
}

function toast(message, kind = "info") {
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  $("toastRegion").append(item);
  window.setTimeout(() => item.remove(), 5000);
}

function setBusy(value) {
  state.busy = value;
  $("lockButton").disabled = value || !canLock();
  $("syncButton").disabled = value || !state.board || state.board.status === "OFFERED" || state.board.status === "SETTLED";
}

function canLock() {
  return state.board?.status === "OFFERED" && state.selected.size >= 1 && state.selected.size <= 3;
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("ru-RU", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "long" }).format(date);
}

function statusInfo(status) {
  const map = {
    OFFERED: ["Доска открыта", "Выберите от одного до трёх контрактов и зафиксируйте набор.", ""],
    LOCKED: ["Контракты зафиксированы", "Сыграйте следующий матч Standard. Мы начнём искать его после завершения.", "warning"],
    MATCH_BOUND: ["Матч найден", "Итоговая статистика получена. Проводим проверку условий.", "warning"],
    VERIFYING: ["Матч найден", "Итоговая статистика получена. Проводим проверку условий.", "warning"],
    SETTLED: ["Дело закрыто", "Проверка завершена. Ниже показан вердикт по каждому контракту.", "success"],
  };
  return map[status] || ["Проверяем состояние", "Обновите страницу через несколько секунд.", "warning"];
}

function showBanner(title, text, kind = "", spinning = false) {
  const banner = $("systemBanner");
  banner.className = `system-banner ${kind}`.trim();
  $("systemTitle").textContent = title;
  $("systemText").textContent = text;
  $("systemSpinner").classList.toggle("hidden", !spinning);
}

function switchView(authenticated) {
  $("landingView").classList.toggle("hidden", authenticated);
  $("appView").classList.toggle("hidden", !authenticated);
  $("headerLogin").classList.toggle("hidden", authenticated);
  $("logoutButton").classList.toggle("hidden", !authenticated);
}

function renderUser() {
  if (!state.user) return;
  $("userName").textContent = state.user.display_name || "Игрок";
  $("userXp").textContent = new Intl.NumberFormat("ru-RU").format(state.user.xp || 0);
  const avatar = $("userAvatar");
  if (state.user.avatar_url) {
    avatar.src = state.user.avatar_url;
    avatar.alt = `Аватар ${state.user.display_name || "игрока"}`;
    avatar.classList.remove("hidden");
    $("avatarFallback").classList.add("hidden");
  } else {
    avatar.removeAttribute("src");
    avatar.classList.add("hidden");
    $("avatarFallback").classList.remove("hidden");
  }
}

function contractStatusLabel(status) {
  return ({
    OFFERED: "Доступен",
    LOCKED: "Зафиксирован",
    SKIPPED: "Не выбран",
    COMPLETED: "Выполнен",
    FAILED: "Не выполнен",
    UNVERIFIABLE: "Нет данных",
  })[status] || status;
}

function statusClass(status) {
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED") return "failed";
  if (status === "UNVERIFIABLE") return "unverifiable";
  if (status === "SKIPPED") return "skipped";
  return "";
}

function renderBoard() {
  const board = state.board;
  if (!board) return;
  $("boardDate").textContent = `${formatDate(board.date)} · истекает ${formatDate(board.expires_at, true)}`;
  const [title, text, kind] = statusInfo(board.status);
  showBanner(title, text, kind, board.status === "LOCKED" || board.status === "MATCH_BOUND");
  $("selectedCount").textContent = String(state.selected.size);
  $("lockButton").textContent = board.status === "OFFERED" ? "Зафиксировать контракты" : "Набор зафиксирован";
  $("lockButton").disabled = !canLock() || state.busy;
  $("syncButton").disabled = state.busy || board.status === "OFFERED" || board.status === "SETTLED";

  const grid = $("contractGrid");
  grid.replaceChildren();
  board.options.forEach((option, index) => {
    const button = document.createElement("button");
    const selected = state.selected.has(option.id) || option.selected;
    button.type = "button";
    button.className = `contract-card ${statusClass(option.status)}`.trim();
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = board.status !== "OFFERED";
    button.dataset.optionId = option.id;

    const number = document.createElement("span");
    number.className = "contract-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("div");
    const h3 = document.createElement("h3");
    h3.textContent = option.title;
    const p = document.createElement("p");
    p.textContent = option.description;
    copy.append(h3, p);

    const reward = document.createElement("div");
    reward.className = "contract-reward";
    const strong = document.createElement("strong");
    strong.textContent = `+${option.reward_xp} XP`;
    const small = document.createElement("small");
    small.textContent = contractStatusLabel(option.status);
    reward.append(strong, small);

    const check = document.createElement("span");
    check.className = "contract-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = selected ? "✓" : "";

    button.append(number, copy, reward, check);
    button.addEventListener("click", () => toggleContract(option.id));
    grid.append(button);
  });

  renderEvidence();
  managePolling();
}

function toggleContract(id) {
  if (state.board?.status !== "OFFERED" || state.busy) return;
  if (state.selected.has(id)) state.selected.delete(id);
  else if (state.selected.size < 3) state.selected.add(id);
  else {
    toast("Можно выбрать не больше трёх контрактов.", "error");
    return;
  }
  renderBoard();
}

function renderEvidence() {
  const selected = state.board?.options.filter((option) => option.selected) || [];
  const show = state.board?.status === "SETTLED" && selected.length > 0;
  $("evidencePanel").classList.toggle("hidden", !show);
  if (!show) return;
  const matchId = selected.find((option) => option.bound_match_id)?.bound_match_id;
  $("boundMatchLabel").textContent = matchId ? `MATCH ${matchId}` : "MATCH";
  const list = $("evidenceList");
  list.replaceChildren();
  selected.forEach((option) => {
    const item = document.createElement("article");
    item.className = "evidence-item";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = option.title;
    const p = document.createElement("p");
    p.textContent = option.explanation || "Проверка завершена.";
    copy.append(strong, p);
    const badge = document.createElement("span");
    badge.className = `status-badge ${statusClass(option.status)}`;
    badge.textContent = contractStatusLabel(option.status);
    item.append(copy, badge);
    list.append(item);
  });
}

async function loadBoard(silent = false) {
  if (!silent) showBanner("Загрузка доски…", "Получаем актуальное состояние.", "", true);
  try {
    const board = await api("/api/board/today");
    const previousStatus = state.board?.status;
    state.board = board;
    if (board.status === "OFFERED") state.selected = new Set(board.options.filter((o) => o.selected).map((o) => o.id));
    else state.selected = new Set(board.options.filter((o) => o.selected).map((o) => o.id));
    renderBoard();
    if (silent && previousStatus && previousStatus !== board.status) toast("Статус дела обновлён.");
    if (board.status === "SETTLED") await refreshUser();
  } catch (error) {
    if (error.status === 401) return handleSessionExpired();
    showBanner("Не удалось загрузить доску", error.requestId ? `${error.message}. ID: ${error.requestId}` : error.message, "error");
  }
}

function managePolling() {
  const shouldPoll = ["LOCKED", "MATCH_BOUND", "VERIFYING"].includes(state.board?.status);
  if (shouldPoll && !state.pollTimer) state.pollTimer = window.setInterval(() => loadBoard(true), 20000);
  if (!shouldPoll && state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function refreshUser() {
  const me = await api("/api/me");
  if (!me.authenticated) return handleSessionExpired();
  state.user = me.user;
  state.csrf = me.csrf_token;
  renderUser();
}

async function lockSelected() {
  if (!canLock() || state.busy) return;
  const confirmed = await confirmAction(
    "Зафиксировать набор?",
    "После подтверждения заменить контракты сегодня будет нельзя. Засчитается первый подходящий Standard-матч, начатый после фиксации.",
    "Зафиксировать"
  );
  if (!confirmed) return;
  setBusy(true);
  try {
    state.board = await api("/api/board/today/lock", { method: "POST", body: JSON.stringify({ option_ids: [...state.selected] }) });
    state.selected = new Set(state.board.options.filter((o) => o.selected).map((o) => o.id));
    renderBoard();
    toast("Контракты зафиксированы. Удачи в матче.");
  } catch (error) {
    toast(error.requestId ? `${error.message} · ${error.requestId}` : error.message, "error");
    await loadBoard(true);
  } finally {
    setBusy(false);
  }
}

async function syncMatches() {
  if (state.busy) return;
  setBusy(true);
  try {
    const result = await api("/api/matches/sync", { method: "POST" });
    toast(result.queued ? "Проверка поставлена в очередь." : "Доска уже обработана.");
    window.setTimeout(() => loadBoard(true), 1800);
  } catch (error) {
    toast(error.requestId ? `${error.message} · ${error.requestId}` : error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function loadHistory() {
  const list = $("historyList");
  list.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "empty-state";
  loading.textContent = "Загружаем архив…";
  list.append(loading);
  try {
    const data = await api("/api/history");
    list.replaceChildren();
    if (!data.items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Архив пока пуст. Зафиксируйте первые контракты на сегодняшней доске.";
      list.append(empty);
      return;
    }
    data.items.forEach((entry) => {
      const item = document.createElement("article");
      item.className = "history-item";
      const copy = document.createElement("div");
      const h3 = document.createElement("h3");
      h3.textContent = entry.title;
      const p = document.createElement("p");
      p.textContent = entry.explanation || "Ожидает итоговой проверки.";
      copy.append(h3, p);
      const meta = document.createElement("div");
      meta.className = "history-meta";
      const badge = document.createElement("span");
      badge.className = `status-badge ${statusClass(entry.status)}`;
      badge.textContent = contractStatusLabel(entry.status);
      const time = document.createElement("div");
      time.textContent = entry.settled_at ? formatDate(entry.settled_at, true) : formatDate(entry.locked_at, true);
      meta.append(badge, time);
      item.append(copy, meta);
      list.append(item);
    });
  } catch (error) {
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = error.message;
    list.append(empty);
  }
}

function selectTab(name) {
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  ["board", "history", "settings"].forEach((tab) => $(`${tab}Tab`).classList.toggle("hidden", tab !== name));
  if (name === "history") loadHistory();
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.csrf = null;
    state.user = null;
    state.board = null;
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    window.location.assign("/");
  }
}

async function deleteAccount() {
  const confirmed = await confirmAction(
    "Удалить аккаунт и данные?",
    "Это действие необратимо. Все ваши доски, история контрактов и XP будут удалены.",
    "Удалить навсегда",
    true
  );
  if (!confirmed) return;
  try {
    await api("/api/account/delete", { method: "POST", body: JSON.stringify({ confirmation: "DELETE" }) });
    state.csrf = null;
    window.location.assign("/?deleted=1");
  } catch (error) {
    toast(error.requestId ? `${error.message} · ${error.requestId}` : error.message, "error");
  }
}

function confirmAction(title, text, confirmLabel, dangerous = false) {
  const dialog = $("confirmDialog");
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = text;
  $("dialogConfirm").textContent = confirmLabel;
  $("dialogConfirm").className = dangerous ? "danger-button" : "primary-button";
  dialog.showModal();
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener("close", onClose);
      resolve(dialog.returnValue === "confirm");
    };
    dialog.addEventListener("close", onClose);
  });
}

function handleSessionExpired() {
  state.csrf = null;
  state.user = null;
  switchView(false);
  toast("Сессия истекла. Войдите через Steam снова.", "error");
}

async function bootstrap() {
  try {
    const me = await api("/api/me");
    switchView(me.authenticated);
    if (!me.authenticated) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("deleted") === "1") toast("Ваш аккаунт и связанные данные удалены.");
      if (params.get("auth_error") === "steam_unavailable") toast("Steam временно не отвечает. Повторите вход позже.", "error");
      if (params.get("auth_error") === "steam_rejected") toast("Вход Steam не подтверждён или устарел. Начните вход заново.", "error");
      if (["1", "steam_unavailable", "steam_rejected"].includes(params.get("deleted") || params.get("auth_error"))) {
        window.history.replaceState({}, "", "/");
      }
      return;
    }
    state.user = me.user;
    state.csrf = me.csrf_token;
    renderUser();
    await loadBoard();
    const params = new URLSearchParams(window.location.search);
    if (params.get("login") === "ok") {
      window.history.replaceState({}, "", "/");
      toast("Вход через Steam выполнен.");
    }
  } catch (error) {
    switchView(false);
    toast(error.requestId ? `${error.message} · ${error.requestId}` : error.message, "error");
  }
}

$("lockButton").addEventListener("click", lockSelected);
$("syncButton").addEventListener("click", syncMatches);
$("logoutButton").addEventListener("click", logout);
$("deleteAccountButton").addEventListener("click", deleteAccount);
document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.tab)));
window.addEventListener("focus", () => { if (state.board && ["LOCKED", "MATCH_BOUND", "VERIFYING"].includes(state.board.status)) loadBoard(true); });
bootstrap();
