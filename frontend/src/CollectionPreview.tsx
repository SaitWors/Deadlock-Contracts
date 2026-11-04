import ratKing from "./hero-votes/portraits/84.webp"
import solomon from "./hero-votes/portraits/85.webp"
import violet from "./hero-votes/portraits/86.webp"
import Icon from "./icons/Icon"

// Existing Valve portraits; this is an illustration of the collection, not a pack result.
export default function CollectionPreview({ language }: { language: "ru" | "en" }) {
  const ru = language === "ru"
  return (
    <div
      className="ritual-collection-preview"
      role="img"
      aria-label={
        ru
          ? "Герои Deadlock: Крысиный король, Соломон и Вайолет"
          : "Deadlock heroes: Rat King, Solomon and Violet"
      }
    >
      <div className="ritual-collection-preview-head">
        <Icon name="layers" size={16} />
        <span>{ru ? "КОЛЛЕКЦИЯ ГЕРОЕВ" : "HERO COLLECTION"}</span>
      </div>
      <div className="ritual-collection-portraits">
        {[
          [ratKing, ru ? "Крысиный король" : "Rat King"],
          [solomon, ru ? "Соломон" : "Solomon"],
          [violet, ru ? "Вайолет" : "Violet"],
        ].map(([src, name]) => (
          <div className="ritual-portrait" key={name}>
            <img src={src} alt="" width="192" height="256" loading="lazy" />
            <span>{name}</span>
          </div>
        ))}
      </div>
      <p>{ru ? "Знакомые герои — твои новые находки" : "Familiar heroes, new discoveries"}</p>
    </div>
  )
}
