import fs from 'node:fs'

const css = fs.readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const palette = block => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})(?![0-9A-Fa-f])/g)].map(match => [match[1], match[2]]))
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
const base = palette(blocks.find(match => match[1].includes(':root'))?.[2] || '')
const themes = Object.fromEntries(['dark', 'light', 'black', 'custom'].map(theme => {
  const block = blocks.find(match => match[1].includes(`[data-theme="${theme}"]`))
  if (!block) throw new Error(`Missing ${theme} theme`)
  return [theme, { ...base, ...palette(block[2]) }]
}))
const token = (name, colors) => {
  if (!colors[name]) throw new Error(`Missing color token --${name}`)
  return colors[name]
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
const foregrounds=['text-primary','text-secondary','text-muted','accent','brass','warning','success','info','danger','provisional']
const backgrounds=['bg-page','bg-panel','bg-elevated','bg-void','bg-hover']
const failures=[]
let count=0
for (const [theme, colors] of Object.entries(themes)) {
  for (const fg of foregrounds) {
    for (const bg of backgrounds) {
      const value=ratio(token(fg,colors),token(bg,colors))
      count++
      if (value < 4.5) failures.push(`${theme}: ${fg} on ${bg}: ${value.toFixed(2)}:1`)
    }
  }
  const buttonRatio=ratio(token('on-accent',colors),token('accent-fill',colors))
  count++
  if (buttonRatio < 4.5) failures.push(`${theme}: primary button: ${buttonRatio.toFixed(2)}:1`)
}
if (failures.length) {
  console.error('[contrast] FAIL\n - '+failures.join('\n - '))
  process.exit(1)
}
console.log(`[contrast] PASS ${count} token pairs across all themes >= 4.5:1 (system resolves to light/dark)`)
