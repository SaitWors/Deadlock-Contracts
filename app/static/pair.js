async function connectCompanion() {
  const status = document.getElementById('status')
  const signIn = document.getElementById('sign-in')
  const approval = document.getElementById('approval')
  const approve = document.getElementById('approve')
  const storageKey = 'companion-link-challenge'

  try {
    const challenge = location.hash.slice(1) || sessionStorage.getItem(storageKey) || ''
    if (!/^\d{10}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(challenge)) {
      status.textContent = 'Choose Connect in browser in the Companion to open a connection request.'
      return
    }
    if (Number(challenge.split('.')[0]) * 1000 <= Date.now()) {
      sessionStorage.removeItem(storageKey)
      status.textContent = 'This connection request expired. Start again from the Companion.'
      return
    }
    sessionStorage.setItem(storageKey, challenge)
    if (location.hash) history.replaceState(null, '', '/pair')

    const response = await fetch('/api/me', { cache: 'no-store' })
    if (!response.ok) throw new Error('Session unavailable')
    const session = await response.json()
    if (!session.authenticated) {
      const authError = new URLSearchParams(location.search).has('auth_error')
      status.textContent = authError
        ? 'Steam sign-in could not be completed. Try signing in again.'
        : 'Sign in with Steam to choose which account to connect.'
      signIn.hidden = false
      return
    }

    const hint = challenge.slice(-6).toUpperCase()
    status.textContent = `Connect as ${session.user.display_name}. Confirm that ${hint} matches the code in your Companion.`
    approval.hidden = false
    approve.addEventListener('click', async () => {
      approve.disabled = true
      try {
        const response = await fetch('/api/companion/pairing/link/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'Accept-Language': 'en' },
          body: JSON.stringify({ challenge }),
        })
        if (response.ok) {
          approval.hidden = true
          sessionStorage.removeItem(storageKey)
          status.textContent = 'Connection approved. Return to the Companion to choose your contracts.'
        } else if ([409, 410].includes(response.status)) {
          approval.hidden = true
          sessionStorage.removeItem(storageKey)
          status.textContent = 'This connection request is no longer available. Start a new one from the Companion.'
        } else if ([401, 403].includes(response.status)) {
          approval.hidden = true
          signIn.hidden = false
          status.textContent = 'Your session expired. Sign in with Steam again to continue.'
        } else {
          throw new Error('Approval unavailable')
        }
      } catch (_) {
        status.textContent = 'The Companion could not be connected. Try approving again.'
      } finally {
        approve.disabled = false
      }
    })
  } catch (_) {
    status.textContent = 'The site could not check your account. Refresh this page to try again.'
  }
}

void connectCompanion()
