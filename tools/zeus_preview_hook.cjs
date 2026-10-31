// Preloaded into `zeus preview` (node --require) by tools/zeus_preview.sh: Zeus draws the
// preview's QR code in the terminal but never prints its URL, which the test page needs.
// Wraps qrcode-terminal's generate() to print the URL on a line of its own first.
const Module = require('module')
const load = Module._load
Module._load = function (request, ...rest) {
  const m = load.call(this, request, ...rest)
  if (request === 'qrcode-terminal' && m && typeof m.generate === 'function' && !m.__kestrel) {
    const generate = m.generate
    m.generate = function (url, ...args) {
      console.log(`KESTREL_PREVIEW_URL=${url}`)
      return generate.call(this, url, ...args)
    }
    m.__kestrel = true
  }
  return m
}
