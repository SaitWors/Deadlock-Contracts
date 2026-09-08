import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import CardPreview from "../src/archive/CardPreview"
import { RANKS } from "../src/archive/types"

export function mount(element: HTMLElement) {
  const root = createRoot(element)
  root.render(<Layout />)
}

function Layout() {
  const [width, setWidth] = useState(168)
  const [title, setTitle] = useState("Длинное название карточки оперативника")
  const [zoom, setZoom] = useState(1)
  return (
    <div className="dc-dashboard dc-redesign dc-v3 dc-vnext bureau-app community-dashboard">
      <section className="archive-page" style={{ padding: 24 }}>
        <h1>Проверка рамок F–SSS</h1>
        <div className="archive-filters">
          <label>
            Ширина карточки
            <select value={width} onChange={(event) => setWidth(Number(event.target.value))}>
              <option value={168}>168 px · телефон</option>
              <option value={220}>220 px · компьютер</option>
              <option value={360}>360 px · редактор</option>
            </select>
          </label>
          <label>
            Масштаб
            <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
          </label>
          <label>
            Название
            <input
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(3, ${width}px)`, gap: 20 }}>
          {RANKS.map((rank) => (
            <article key={rank}>
              <CardPreview
                card={{
                  rank,
                  hero_name: "Mo & Krill",
                  title,
                  image_url: "art.webp",
                  crop_x: 100,
                  crop_y: 0,
                  zoom,
                }}
              />
              <p>
                {rank} · {width} px
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
