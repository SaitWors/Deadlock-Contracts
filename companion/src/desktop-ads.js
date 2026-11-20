(() => {
  const SDK_URL = 'https://content.overwolf.com/libs/ads/latest/owads.min.js'
  const RETRY_MS = 60000
  const wideWindow = window.matchMedia('(min-width: 1440px)')
  const slots = [
    { rail: 'desktopAdRail', container: 'desktopAdContainer', id: 'dc_400x60_dt_top', height: 60 },
    { rail: 'desktopAdStudio', container: 'desktopStudioContainer', id: 'dc_400x300_dt_right', height: 300, wide: true },
  ]
  let eligible = false
  let nativeWindowVisible = false
  let sdkScript = null
  let retrySdkAt = 0

  const get = id => document.getElementById(id)

  function stopSlot(slot) {
    if (slot.ad) {
      try { slot.ad.shutdown() } catch (error) { console.warn('Overwolf ad shutdown failed', error) }
      slot.ad = null
      get(slot.container).replaceChildren()
    }
    get(slot.rail).hidden = true
  }

  function syncSlots() {
    const visible = eligible && nativeWindowVisible && document.visibilityState === 'visible'
    if (visible && typeof window.OwAd !== 'function') loadSdk()

    for (const slot of slots) {
      if (!visible || (slot.wide && !wideWindow.matches)) {
        stopSlot(slot)
        continue
      }
      if (slot.ad || typeof window.OwAd !== 'function' || Date.now() < (slot.retryAt || 0)) continue

      const rail = get(slot.rail)
      const container = get(slot.container)
      rail.hidden = false
      try {
        slot.ad = new window.OwAd(container, {
          size: { width: 400, height: slot.height },
          containerId: slot.id,
        })
      } catch (error) {
        slot.retryAt = Date.now() + RETRY_MS
        rail.hidden = true
        container.replaceChildren()
        console.warn('Overwolf ad slot unavailable', error)
      }
    }
  }

  function loadSdk() {
    if (sdkScript || Date.now() < retrySdkAt) return

    const script = document.createElement('script')
    sdkScript = script
    script.src = SDK_URL
    script.async = true
    const timeout = setTimeout(failed, 12000)
    function failed() {
      if (sdkScript !== script) return
      clearTimeout(timeout)
      sdkScript = null
      retrySdkAt = Date.now() + RETRY_MS
      script.remove()
      console.warn('Overwolf Ads SDK unavailable')
    }
    script.onerror = failed
    script.onload = () => {
      if (sdkScript !== script) return
      if (typeof window.OwAd !== 'function') return failed()
      clearTimeout(timeout)
      sdkScript = null
      syncSlots()
    }
    document.head.appendChild(script)
  }

  document.addEventListener('visibilitychange', syncSlots)
  wideWindow.addEventListener('change', syncSlots)
  window.addEventListener('pagehide', () => {
    eligible = false
    syncSlots()
  })
  window.DCDesktopAds = {
    setEligible(canDisplay) {
      eligible = typeof overwolf !== 'undefined' && canDisplay
      syncSlots()
    },
    setWindowVisible(visible) {
      nativeWindowVisible = visible
      syncSlots()
    },
  }
})()
