(() => {
  // The only remote executable asset in the Desktop window is the official
  // Overwolf Ads SDK. The slot is never created for the in-game overlay.
  const SDK_URL = 'https://content.overwolf.com/libs/ads/latest/owads.min.js'
  const CONTAINER_ID = 'dc_400x60_desktop_b'
  const AD_SIZE = { width: 400, height: 60 }
  const state = { eligible: false, sdkRequested: false, ad: null }

  const $ = id => document.getElementById(id)

  function setStatus(message, phase = 'idle') {
    const rail = $('desktopAdRail')
    const status = $('desktopAdStatus')
    if (rail) rail.dataset.adState = phase
    if (status) status.textContent = message
  }

  function setRailVisible(visible) {
    const rail = $('desktopAdRail')
    if (rail) rail.hidden = !visible
  }

  function shutDown() {
    if (state.ad?.shutdown) {
      try { state.ad.shutdown() } catch (_) {}
    }
    state.ad = null
    const container = $('desktopAdContainer')
    if (container) container.replaceChildren()
  }

  function createManagedContainer() {
    if (!state.eligible || state.ad || typeof window.OwAd !== 'function') return
    const container = $('desktopAdContainer')
    if (!container) return

    // OwAd owns this element after construction: no placeholder or other
    // children are ever inserted into the container itself.
    container.replaceChildren()
    try {
      const ad = new window.OwAd(container, {
        size: AD_SIZE,
        containerId: CONTAINER_ID,
        customTracking: {
          page: 'desktop_hq',
          placement: 'bottom_rail',
          game: 'deadlock',
        },
      })
      state.ad = ad
      ad.addEventListener?.('display_ad_loaded', () => setStatus('AD SERVED BY OVERWOLF', 'ready'))
      ad.addEventListener?.('play', () => setStatus('SPONSORED CONTENT', 'ready'))
      setStatus('REQUESTING OVERWOLF AD', 'loading')
    } catch (error) {
      state.ad = null
      setStatus('AD SLOT UNAVAILABLE IN THIS BUILD', 'unavailable')
      console.warn('Overwolf ad slot unavailable', error)
    }
  }

  function loadSdk() {
    if (state.sdkRequested || !state.eligible) return
    state.sdkRequested = true
    setStatus('LOADING OVERWOLF AD SDK', 'loading')
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () => {
      if (typeof window.OwAd !== 'function') {
        setStatus('AD SDK DID NOT INITIALIZE', 'unavailable')
        return
      }
      createManagedContainer()
    }
    script.onerror = () => setStatus('AD SDK UNAVAILABLE', 'unavailable')
    document.head.appendChild(script)
  }

  function setEligible(value) {
    const next = !!value && typeof overwolf !== 'undefined'
    if (!next) {
      state.eligible = false
      shutDown()
      setRailVisible(false)
      return
    }

    state.eligible = true
    setRailVisible(true)
    if (typeof window.OwAd === 'function') createManagedContainer()
    else loadSdk()
  }

  window.addEventListener('beforeunload', shutDown)
  window.DCDesktopAds = { setEligible, shutDown }
})()
