import Icon from "../icons/Icon"
import { useLanguage } from "../i18n"

export default function ArchiveNextStep({
  onNavigate,
}: {
  revision?: number
  onNavigate: (destination: "packs" | "collection" | "bureaus") => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  return (
    <section className="ritual-next-step" aria-labelledby="archive-next-title">
      <Icon name="mail" size={36} />
      <div>
        <small>{ru ? "ДЛЯ ТВОЕЙ КОЛЛЕКЦИИ" : "FOR YOUR COLLECTION"}</small>
        <h2 id="archive-next-title">
          {ru ? "Каждый день — новый конверт" : "A new pack every day"}
        </h2>
        <p>
          {ru
            ? "Бесплатные карточки героев. Доступность обновляется в полночь UTC."
            : "Free hero cards. Availability resets at midnight UTC."}
        </p>
      </div>
      <button className="dc-primary" type="button" onClick={() => onNavigate("packs")}>
        {ru ? "Открыть конверт" : "Open daily pack"}
        <Icon name="arrow-up-right" size={18} />
      </button>
    </section>
  )
}
