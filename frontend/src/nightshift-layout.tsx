import Icon, { type IconName } from "./icons/Icon"
import { useLanguage } from "./i18n"
import { publicUrl } from "./publicRoutes"
import daybreak from "./imports/nightshift/daybreak-city.webp"
import archive from "./imports/nightshift/archive-room.webp"
import bureau from "./imports/nightshift/bureau-room.webp"

export function NightshiftNav({
  active,
  staff,
  votesEnabled = false,
  user,
  level,
  onNavigate,
}: {
  active: string
  staff: boolean
  votesEnabled?: boolean
  user?: { display_name: string; avatar_url: string | null }
  level?: number
  onNavigate: (tab: string) => void
}) {
  const { language } = useLanguage(),
    ru = language === "ru"
  const groups: { label: string; links: [string, string, IconName][] }[] = [
    {
      label: ru ? "ТВОИ ДЕЛА" : "YOUR CASES",
      links: [
        ["home", ru ? "Главная" : "Home", "house"],
        ["quests", ru ? "Контракты" : "Contracts", "file-text"],
        ["active", ru ? "Активное дело" : "Active case", "briefcase-business"],
        ["history", ru ? "История дел" : "Case history", "archive"],
      ],
    },
    {
      label: ru ? "ГОРОДСКОЙ АРХИВ" : "CITY ARCHIVE",
      links: [
        ["archive", ru ? "Шифры и каталог" : "Ciphers & catalog", "lock-keyhole"],
        ["collection", ru ? "Моя коллекция" : "My collection", "layers"],
        ["packs", ru ? "Конверты" : "Envelopes", "mail"],
        ["studio", ru ? "Мастерская" : "Card studio", "palette"],
        ["wallet", ru ? "История жетонов" : "Token history", "coins"],
      ],
    },
    {
      label: ru ? "СВОИ ЛЮДИ" : "YOUR PEOPLE",
      links: [
        ["bureaus", ru ? "Бюро игроков" : "Player bureaus", "building-2"],
        ["achievements", ru ? "Достижения" : "Achievements", "medal"],
        ["leaderboard", ru ? "Рейтинг" : "Leaderboard", "trophy"],
        ...(votesEnabled
          ? [
              [
                "hero-votes",
                ru ? "Голосование" : "Hero votes",
                "chart-no-axes-column-increasing",
              ] as [string, string, IconName],
            ]
          : []),
        ["profile", ru ? "Моё досье" : "My dossier", "user-round"],
        ...(staff
          ? [
              ["admin", ru ? "Управление" : "Staff console", "shield-check"] as [
                string,
                string,
                IconName,
              ],
            ]
          : []),
      ],
    },
  ]
  return (
    <aside className="ns-sidebar">
      <button
        className="ns-sidebar-brand"
        type="button"
        onClick={() => onNavigate("home")}
        aria-label={ru ? "Deadlock Contracts — главная" : "Deadlock Contracts — home"}
      >
        <span className="ns-brand-icon">
          <Icon name="eye" size={25} />
        </span>
        <span className="ns-brand-wordmark">
          DEADLOCK<small>CONTRACTS</small>
        </span>
      </button>
      <nav aria-label={ru ? "Разделы кабинета" : "Dashboard sections"}>
        {groups.map((group) => (
          <div className="ns-nav-group" key={group.label}>
            <p>{group.label}</p>
            {group.links.map(([id, label, icon]) => (
              <button
                type="button"
                key={id}
                data-nav={id}
                aria-current={active === id ? "page" : undefined}
                onClick={() => onNavigate(id)}
              >
                <Icon name={icon} size={18} />
                <span>{label}</span>
                {active === id && <i />}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <footer>
        <button type="button" onClick={() => onNavigate("profile")}>
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" />
          ) : (
            <span className="ns-sidebar-avatar">
              <Icon name="user-round" size={20} />
            </span>
          )}
          <span>
            <b>{user?.display_name || (ru ? "Моё досье" : "My dossier")}</b>
            <small>
              {ru ? "Оперативник" : "Operative"} / {level ?? 1}
            </small>
          </span>
          <Icon name="arrow-up-right" size={17} />
        </button>
      </footer>
    </aside>
  )
}

export function WorldGallery({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { language } = useLanguage(),
    ru = language === "ru"
  const scenes = [
    {
      id: "contracts",
      tab: "quests",
      page: "contracts" as const,
      image: daybreak,
      tag: ru ? "01 / ТВОЯ ИСТОРИЯ" : "01 / YOUR STORY",
      title: ru ? "Город ждёт нового дела." : "The city has a case for you.",
      action: ru ? "Открыть контракты" : "Explore contracts",
    },
    {
      id: "archive",
      tab: "collection",
      page: "cards" as const,
      image: archive,
      tag: ru ? "02 / ГОРОДСКОЙ АРХИВ" : "02 / CITY ARCHIVE",
      title: ru ? "Истории, которые остаются." : "Stories worth keeping.",
      action: ru ? "Открыть коллекцию" : "Explore the collection",
    },
    {
      id: "bureau",
      tab: "bureaus",
      page: "about" as const,
      image: bureau,
      tag: ru ? "03 / СВОИ ЛЮДИ" : "03 / YOUR PEOPLE",
      title: ru ? "Большие дела делают вместе." : "Great cases take a team.",
      action: ru ? "Заглянуть в бюро" : "Discover the bureau",
    },
  ]
  return (
    <section className="ns-world">
      <header>
        <div>
          <p className="ns-eyebrow">{ru ? "БОЛЬШЕ, ЧЕМ ОДИН МАТЧ" : "MORE THAN ONE MATCH"}</p>
          <h2>{ru ? "У этого города есть истории." : "This city has stories."}</h2>
        </div>
        <span>NEW YORK / AFTER DARK</span>
      </header>
      <div className="ns-world-grid">
        {scenes.map((scene) => {
          const content = (
            <>
              <img src={scene.image} alt="" loading="lazy" width="1536" height="1024" />
              <span className="ns-scene-copy">
                <small>{scene.tag}</small>
                <strong>{scene.title}</strong>
                <span>
                  {scene.action}
                  <Icon name="arrow-up-right" size={18} />
                </span>
              </span>
            </>
          )
          return onNavigate ? (
            <button
              type="button"
              className="ns-world-card"
              key={scene.id}
              onClick={() => onNavigate(scene.tab)}
            >
              {content}
            </button>
          ) : (
            <a className="ns-world-card" key={scene.id} href={publicUrl(scene.page, language)}>
              {content}
            </a>
          )
        })}
      </div>
    </section>
  )
}

export function ArchiveScene() {
  const { language } = useLanguage(),
    ru = language === "ru"
  return (
    <section className="ns-archive-scene">
      <img src={archive} alt="" width="1536" height="1024" />
      <div>
        <p className="ns-eyebrow">{ru ? "ГОРОДСКОЙ АРХИВ" : "CITY ARCHIVE"}</p>
        <h2>{ru ? "У каждого героя — своя история." : "Every hero has a story."}</h2>
        <p>{ru ? "Найди свою. Сохрани в коллекции." : "Find yours. Keep it in your collection."}</p>
      </div>
      <Icon name="archive" size={32} />
    </section>
  )
}
