const buttons = [...document.querySelectorAll("button")];
const message = document.getElementById("preview-message");
async function openPreview(publicPage) {
  buttons.forEach((button) => { button.disabled = true; });
  message.textContent = "Открываем…";
  try {
    if (publicPage) {
      const response = await fetch("/api/me", { credentials: "same-origin", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const session = await response.json();
      if (session.authenticated) {
        const logout = await fetch("/api/auth/logout", {
          method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(15000),
          headers: { "X-CSRF-Token": session.csrf_token },
        });
        if (!logout.ok) throw new Error();
      }
    } else {
      const response = await fetch("/api/auth/demo", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
    }
    window.location.assign("/");
  } catch {
    message.textContent = "Не удалось открыть страницу. Проверь, что тестовый сервер запущен, и повтори.";
    buttons.forEach((button) => { button.disabled = false; });
  }
}
document.getElementById("preview-login").addEventListener("click", () => void openPreview(false));
document.getElementById("preview-public").addEventListener("click", () => void openPreview(true));
