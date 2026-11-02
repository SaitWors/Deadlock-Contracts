import { useState } from "react"
import { request } from "../community/api"
import { useLanguage } from "../i18n"
import CardPreview from "./CardPreview"
import { RANKS, STATUS, type Card, type Meta, type Rank } from "./types"

import { prepareImage } from "../image-upload"
export { prepareImage } from "../image-upload"

export default function CardStudio({
  card,
  meta,
  csrf,
  onSaved,
  onCancel,
}: {
  card?: Card
  meta: Meta
  csrf: string
  onSaved: (card: Card) => void
  onCancel: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [form, setForm] = useState({
    hero: card?.hero || meta.heroes[0].key,
    rank: card?.rank || ("F" as Rank),
    title: card?.title || "",
    description: card?.description || "",
    artist: card?.artist || "",
    source_url: card?.source_url || "",
    rights_confirmed: card?.rights_confirmed || false,
    crop_x: card?.crop_x ?? 50,
    crop_y: card?.crop_y ?? 50,
    zoom: card?.zoom || 1,
  })
  const [image, setImage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const change = (values: Partial<typeof form>) => setForm((old) => ({ ...old, ...values }))
  const base = form.rank === "EX",
    subjects = base ? meta.bases || [] : meta.heroes
  const save = async () => {
    setBusy(true)
    setError("")
    try {
      const data = await request<{ card: Card }>(
        "/api/archive/cards" + (card ? `/${card.id}` : ""),
        csrf,
        {
          method: card ? "PUT" : "POST",
          body: JSON.stringify({
            ...form,
            ...(card ? { revision: card.revision } : {}),
            ...(image ? { image: image.split(",")[1] } : {}),
          }),
        },
      )
      onSaved(data.card)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="archive-editor">
      <div className="archive-editor-preview">
        <span className="archive-studio-eyebrow">{ru ? "ЖИВОЙ ПРЕДПРОСМОТР" : "LIVE PREVIEW"}</span>
        <CardPreview
          card={{
            ...form,
            id: image ? undefined : card?.id,
            release_poster: image ? false : card?.release_poster,
            hero_name: subjects.find((h) => h.key === form.hero)?.name || "",
            image_url: image || card?.image_url || null,
          }}
        />
        <p>
          {ru
            ? "Рамка накладывается на изображение. Ранг не меняет XP."
            : "A reusable frame overlays the image. Rank does not affect XP."}
        </p>
      </div>
      <form
        className="archive-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <header>
          <small>CARD STUDIO / 01</small>
          <h2>{ru ? "Создатель карточек" : "Card studio"}</h2>
          <p>
            {ru
              ? "Собери дизайн, сохрани черновик и отправь администратору."
              : "Compose your design, save a draft and submit it for review."}
          </p>
        </header>
        {card?.review_note && <p className="archive-review-note">{card.review_note}</p>}
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={busy}>
          {!!meta.bases?.length && (
            <label>
              {ru ? "Тип карточки" : "Card type"}
              <select
                value={base ? "BASE" : "HERO"}
                onChange={(event) =>
                  change({
                    rank: event.target.value === "BASE" ? "EX" : "F",
                    hero: event.target.value === "BASE" ? meta.bases![0].key : meta.heroes[0].key,
                  })
                }
              >
                <option value="HERO">{ru ? "Герой" : "Hero"}</option>
                <option value="BASE">{ru ? "База EX" : "EX base"}</option>
              </select>
            </label>
          )}
          <label>
            {base ? (ru ? "Покровитель" : "Patron") : ru ? "Герой" : "Hero"}
            <select value={form.hero} onChange={(e) => change({ hero: e.target.value })}>
              {subjects.map((hero) => (
                <option key={hero.key} value={hero.key}>
                  {hero.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {ru ? "Ранг рамки" : "Frame rank"}
            <select value={form.rank} onChange={(e) => change({ rank: e.target.value as Rank })}>
              {(base ? ["EX"] : RANKS).map((rank) => (
                <option key={rank}>{rank}</option>
              ))}
            </select>
          </label>
          <p>
            {ru
              ? "Выбери героя и ранг рамки для коллекционного дизайна."
              : "Choose a hero and frame rank for this collectible design."}
          </p>
          <label>
            {ru ? "Название варианта" : "Variant title"}
            <input
              required
              minLength={2}
              maxLength={80}
              value={form.title}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label className="archive-upload">
            {ru ? "Изображение · PNG, JPEG, WebP" : "Artwork · PNG, JPEG, WebP"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setBusy(true)
                setError("")
                try {
                  setImage(await prepareImage(file))
                } catch (reason) {
                  setError((reason as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            />
          </label>
          <p className="archive-help">
            {ru
              ? "До 8 МБ. Перед загрузкой изображение уменьшается; сервер сохраняет очищенную копию."
              : "Up to 8 MB. The image is resized before upload and sanitized on the server."}
          </p>
          <div className="archive-crop-controls">
            {(["crop_x", "crop_y", "zoom"] as const).map((key, i) => (
              <label key={key}>
                {
                  [
                    ru ? "Горизонталь" : "Horizontal",
                    ru ? "Вертикаль" : "Vertical",
                    ru ? "Масштаб" : "Zoom",
                  ][i]
                }
                <input
                  type="range"
                  min={i === 2 ? 1 : 0}
                  max={i === 2 ? 2 : 100}
                  step={i === 2 ? 0.05 : 1}
                  value={form[key]}
                  onChange={(e) => change({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <label>
            {ru ? "Описание" : "Description"}
            <textarea
              maxLength={600}
              rows={3}
              value={form.description}
              onChange={(e) => change({ description: e.target.value })}
            />
          </label>
          <label>
            {ru ? "Автор изображения / подпись" : "Artwork author / credit"}
            <input
              maxLength={100}
              value={form.artist}
              onChange={(e) => change({ artist: e.target.value })}
            />
          </label>
          <label>
            {ru ? "Источник (HTTPS, если есть)" : "Source (HTTPS, optional)"}
            <input
              type="url"
              maxLength={500}
              value={form.source_url}
              onChange={(e) => change({ source_url: e.target.value })}
            />
          </label>
          <label className="archive-check">
            <input
              type="checkbox"
              checked={form.rights_confirmed}
              onChange={(e) => change({ rights_confirmed: e.target.checked })}
            />
            {ru
              ? "У меня есть право использовать изображение. Согласен на публикацию дизайна и указанной подписи."
              : "I may use this artwork and agree to publish the design and its credit."}
          </label>
          <div className="archive-actions">
            <button className="archive-primary" type="submit">
              {busy ? "…" : ru ? "Сохранить черновик" : "Save draft"}
            </button>
            <button type="button" onClick={onCancel}>
              {ru ? "Назад" : "Back"}
            </button>
          </div>
        </fieldset>
        <p className="archive-help">
          {ru
            ? "Публикация доступна администратору и владельцу после проверки готового дизайна."
            : "Admins and the owner can publish after reviewing the finished design."}
        </p>
      </form>
    </section>
  )
}

export function CardStatus({ card }: { card: Card }) {
  const { language } = useLanguage()
  return (
    <span className="archive-status" data-status={card.status}>
      {STATUS[card.status]?.[language === "ru" ? 0 : 1] || card.status}
    </span>
  )
}
