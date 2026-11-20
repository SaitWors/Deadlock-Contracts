(() => {
  const copy = {
    en: {
      title: 'Connect Companion | Deadlock Contracts',
      heading: 'Connect the Companion',
      languageLabel: 'Language',
      signIn: 'Sign in with Steam',
      approval: 'Connect this Companion',
      manualHeading: 'Using a pairing code',
      manualCopy: 'Generate a Companion pairing code in your account settings. Then choose Settings → Use a pairing code in the Companion.',
      profile: 'Open your profile',
      checking: 'Checking your connection request…',
      missing: 'Choose Connect in browser in the Companion to open a connection request.',
      expired: 'This connection request expired or was closed. Start a new one from the Companion.',
      signInPrompt: 'Sign in with Steam to choose which account to connect.',
      signInFailed: 'Steam sign-in could not be completed. Try signing in again.',
      closedAlpha: 'This Steam account does not have access. Sign in with an account that has access to the alpha.',
      confirm: (account, hint) => `Connect as ${account}. Confirm that ${hint} matches the code in your Companion.`,
      approved: 'Connection approved. Return to the Companion to choose your contracts.',
      sessionExpired: 'Your session expired. Sign in with Steam again to continue.',
      approvalFailed: 'The Companion could not be connected. Try approving again.',
      unavailable: 'The site could not check your account. Refresh this page to try again.',
    },
    ru: {
      title: 'Подключение Companion | Deadlock Contracts',
      heading: 'Подключение Companion',
      languageLabel: 'Язык',
      signIn: 'Войти через Steam',
      approval: 'Подключить Companion',
      manualHeading: 'Подключение по коду',
      manualCopy: 'Создайте код Companion в настройках аккаунта. Затем в Companion выберите «Настройки → Ввести код подключения».',
      profile: 'Открыть профиль',
      checking: 'Проверяем запрос на подключение…',
      missing: 'Чтобы открыть запрос, выберите «Подключить через браузер» в Companion.',
      expired: 'Запрос истёк или был закрыт. Создайте новый запрос в Companion.',
      signInPrompt: 'Войдите через Steam, чтобы выбрать аккаунт для подключения.',
      signInFailed: 'Не удалось войти через Steam. Попробуйте ещё раз.',
      closedAlpha: 'У этого аккаунта Steam нет доступа. Войдите с аккаунтом, у которого есть доступ к альфе.',
      confirm: (account, hint) => `Подключить аккаунт ${account}. Убедитесь, что ${hint} совпадает с кодом в Companion.`,
      approved: 'Подключение подтверждено. Вернитесь в Companion, чтобы выбрать контракты.',
      sessionExpired: 'Срок действия сеанса истёк. Чтобы продолжить, войдите через Steam снова.',
      approvalFailed: 'Не удалось подключить Companion. Попробуйте подтвердить подключение ещё раз.',
      unavailable: 'Сайт не смог проверить аккаунт. Обновите страницу и попробуйте снова.',
    },
  }

  const get = id => document.getElementById(id)
  const storageKey = 'companion-link-challenge'
  const languageKey = 'dc.ui.language'
  const params = new URLSearchParams(location.search)
  const explicit = value => value === 'en' || value === 'ru'
  let language = 'en'
  let status = 'checking'
  let account = ''
  let hint = ''

  function render() {
    const messages = copy[language]
    document.documentElement.lang = language
    document.title = messages.title
    get('language').value = language
    get('language-label').textContent = messages.languageLabel
    get('heading').textContent = messages.heading
    get('sign-in-link').textContent = messages.signIn
    get('approve').textContent = messages.approval
    get('manual-heading').textContent = messages.manualHeading
    get('manual-copy').textContent = messages.manualCopy
    get('profile').textContent = messages.profile
    const home = language === 'ru' ? '/' : '/en/'
    get('home').href = home
    get('profile').href = `${home}#profile`
    get('status').textContent = status === 'confirm' ? messages.confirm(account, hint) : messages[status]
  }

  function show(next) {
    status = next
    get('sign-in').hidden = !['signInPrompt', 'signInFailed', 'closedAlpha', 'sessionExpired'].includes(next)
    get('approval').hidden = !['confirm', 'approvalFailed'].includes(next)
    render()
  }

  try {
    const requested = params.get('lang')
    const saved = sessionStorage.getItem('companion-link-language') || localStorage.getItem(languageKey)
    if (explicit(requested)) sessionStorage.setItem('companion-link-language', requested)
    language = explicit(requested) ? requested : explicit(saved) ? saved : 'en'
  } catch (_) {
    if (explicit(params.get('lang'))) language = params.get('lang')
  }
  get('language').addEventListener('change', event => {
    if (!explicit(event.target.value)) return
    language = event.target.value
    try {
      sessionStorage.setItem('companion-link-language', language)
      localStorage.setItem(languageKey, language)
    } catch (_) {}
    render()
  })
  render()

  async function connect() {
    const approvalButton = get('approve')
    const fromLink = location.hash.slice(1)
    if (location.hash || params.has('lang')) {
      const clean = new URL(location.href)
      clean.hash = ''
      clean.searchParams.delete('lang')
      history.replaceState(null, '', clean.pathname + clean.search)
    }
    try {
      const challenge = fromLink || sessionStorage.getItem(storageKey) || ''
      if (!/^\d{10}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(challenge)) return show('missing')
      if (Number(challenge.split('.')[0]) * 1000 <= Date.now()) {
        sessionStorage.removeItem(storageKey)
        return show('expired')
      }
      sessionStorage.setItem(storageKey, challenge)

      const response = await fetch('/api/me', { cache: 'no-store' })
      if (!response.ok) throw new Error('Session unavailable')
      const session = await response.json()
      if (!session.authenticated) {
        if (params.get('auth_error') === 'closed_alpha') return show('closedAlpha')
        return show(params.has('auth_error') ? 'signInFailed' : 'signInPrompt')
      }

      account = session.user.display_name
      hint = challenge.slice(-6).toUpperCase()
      show('confirm')
      approvalButton.addEventListener('click', async () => {
        approvalButton.disabled = true
        try {
          const response = await fetch('/api/companion/pairing/link/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'Accept-Language': language },
            body: JSON.stringify({ challenge }),
          })
          if ([409, 410].includes(response.status)) {
            sessionStorage.removeItem(storageKey)
            return show('expired')
          }
          if ([401, 403].includes(response.status)) return show('sessionExpired')
          if (!response.ok || (await response.json()).approved !== true) throw new Error('Approval unavailable')
          sessionStorage.removeItem(storageKey)
          show('approved')
        } catch (_) {
          show('approvalFailed')
        } finally {
          approvalButton.disabled = false
        }
      })
    } catch (_) {
      show('unavailable')
    }
  }

  void connect()
})()
