if (typeof overwolf !== 'undefined') {
  const origin = window.DCRelease.serverOrigin
  overwolf.utils.openUrlInDefaultBrowser(new URL('/companion/uninstall', origin).href)
}
