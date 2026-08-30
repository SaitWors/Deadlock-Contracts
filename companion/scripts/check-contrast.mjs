import fs from 'node:fs'

const css = fs.readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const token = name => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))
  if (!match) throw new Error(`Missing color token --${name}`)
  return match[1]
}
const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255)
const channel = value => value <= 0.04045 ? value/12.92 : ((value+0.055)/1.055)**2.4
const luminance = hex => {
  const [r,g,b] = rgb(hex).map(channel)
  return 0.2126*r + 0.7152*g + 0.0722*b
}
const ratio = (a,b) => {
  const x=luminance(a), y=luminance(b)
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)
}
const foregrounds=['text-primary','text-secondary','text-muted','brass','warning','success','info']
const backgrounds=['bg-page','bg-panel','bg-elevated','bg-void']
const failures=[]
for (const fg of foregrounds) {
  for (const bg of backgrounds) {
    const value=ratio(token(fg),token(bg))
    if (value < 4.5) failures.push(`${fg} on ${bg}: ${value.toFixed(2)}:1`)
  }
}
if (failures.length) {
  console.error('[contrast] FAIL\n - '+failures.join('\n - '))
  process.exit(1)
}
console.log(`[contrast] PASS ${foregrounds.length*backgrounds.length} token pairs >= 4.5:1`)
