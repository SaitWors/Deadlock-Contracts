(function attachReleaseMeta(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.DCRelease = api
})(typeof window !== 'undefined' ? window : globalThis, () => Object.freeze({
  productVersion: '0.5.2-alpha.17',
  manifestVersion: '0.5.2.17',
  evidenceSchemaVersion: 9,
  bootstrapSchemaVersion: 2,
  bootstrapCompatVersions: Object.freeze([1,2]),
  productionWebVersion: '0.10.1-alpha.11',
  productionBootstrapSchemaVersion: 1,
}))
