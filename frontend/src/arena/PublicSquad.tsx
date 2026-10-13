import { useResource } from "../community/api"
import { useLanguage } from "../i18n"
import CardPreview from "../archive/CardPreview"
import type { Card } from "../archive/types"
export default function PublicSquad({ slug }: { slug: string }) {
  const { language } = useLanguage(),
    ru = language === "ru"
  const data = useResource<{
    showcase: {
      user_id: string
      base_key: string
      budget: number
      heroes: { hero_key: string; rank: string; line: number; position: string; card: Card }[]
    }
  }>(`/api/public/players/${encodeURIComponent(slug)}/arena/showcase`)
  if (!data.data?.showcase) return null
  const showcase = data.data.showcase
  const base = ({
    ORDINARY: ["Обычная база", "Ordinary base"],
    HIDDEN_KING: ["Тайный король · Двор теней", "Hidden King · Court of shadows"],
    ARCHMOTHER: ["Архиматерь · Стеклянный собор", "Archmother · Glass cathedral"],
  }[showcase.base_key] || [showcase.base_key, showcase.base_key])[ru ? 0 : 1]
  return (
    <section className="dossier-module arena-public-showcase">
      <header>
        <h2>{ru ? "Состав арены" : "Arena squad"}</h2>
        <span>{showcase.budget} / 24</span>
      </header>
      <p>{base}</p>
      <p>
        {ru ? "6 героев · 24 карты · 2 победы в раундах" : "6 heroes · 24 cards · 2 round wins"}
      </p>
      <div className="dossier-card-showcase">
        {showcase.heroes.map((hero) => (
          <article key={`${hero.line}:${hero.position}`}>
            <CardPreview card={hero.card} />
            <p>
              {hero.rank} · {ru ? "3 боевые карты" : "3 combat cards"}
            </p>
          </article>
        ))}
      </div>
      <a href={`/#arena/copy/${encodeURIComponent(showcase.user_id)}`}>
        {ru ? "Бой с ботом по копии состава" : "Play bot using squad copy"}
      </a>
    </section>
  )
}
