(() => {
  const form = document.getElementById("qaForm");
  const input = document.getElementById("qaCode");
  const button = document.getElementById("submitBtn");
  const status = document.getElementById("status");

  function message(text, kind = "") {
    status.textContent = text;
    status.className = "status" + (kind ? ` ${kind}` : "");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (code.length < 32 || code.length > 128) {
      message("Enter the QA access code exactly as provided.", "err");
      return;
    }
    button.disabled = true;
    message("Authorizing reviewer access...");
    try {
      const response = await fetch("/api/reviewer/access", {
        method: "POST",
        credentials: "same-origin",
        headers: {"Content-Type": "application/json", "Accept": "application/json"},
        body: JSON.stringify({code}),
      });
      let body = {};
      try { body = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(body.detail || "Reviewer access could not be authorized.");
      input.value = "";
      message("Access authorized. Redirecting to Steam...", "ok");
      window.location.assign("/auth/steam");
    } catch (error) {
      message(error.message || "Reviewer access could not be authorized.", "err");
      button.disabled = false;
      input.focus();
      input.select();
    }
  });
})();
