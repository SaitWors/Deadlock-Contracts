import type { ReactNode } from "react"
import { BureauEmblem, appearanceOf } from "./BureauIdentity"
import { contractTitle, useLanguage } from "../i18n"
import { Seal } from "./Shared"
import type { Module, Profile } from "./types"
import CardPreview from "../archive/CardPreview"

export function visibleProfile(profile: Profile): Profile {
  const achievements =
    profile.show_stats && profile.show_achievements
      ? profile.achievements.filter((item) => item.earned)
      : []
  return {
    ...profile,
    stats: profile.show_stats ? profile.stats : null,
    player: {
      ...profile.player,
      xp: profile.show_stats ? profile.player.xp : null,
      level_xp: profile.show_stats ? profile.player.level_xp : null,
      next_level_xp: profile.show_stats ? profile.player.next_level_xp : null,
    },
    achievements,
    featured_achievement: achievements.some((item) => item.id === profile.featured_achievement)
      ? profile.featured_achievement
      : null,
    showcase: profile.show_showcase ? profile.showcase : [],
    cards: profile.show_cards ? profile.cards : [],
    bureau: profile.show_bureau ? profile.bureau : null,
    links: profile.show_links ? profile.links : {},
  }
}
const roleNames: Record<string, [string, string]> = {
  CREATOR: ["Создатель", "Creator"],
  ADMIN: ["Администратор", "Admin"],
  DEVELOPER: ["Разработчик", "Developer"],
  STREAMER: ["Стример", "Streamer"],
  EARLY_TESTER: ["Ранний тестировщик", "Early tester"],
  TESTER: ["Тестировщик", "Tester"],
  CONTRIBUTOR: ["Участник проекта", "Contributor"],
}

const modeNames: Record<string, string> = {
  STANDARD: "Standard",
  RANKED: "Ranked",
  STREET_BRAWL: "Street Brawl",
}

export function dossierMode(mode: string) {
  return modeNames[mode] ?? mode.replace(/_/g, " ")
}

export default function DossierView({
  profile,
  toolbar,
  onBureau,
  onCollection,
}: {
  profile: Profile
  toolbar?: ReactNode
  onBureau?: (slug: string) => void
  onCollection?: () => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const { player, stats, bureau } = profile
  const earned = profile.achievements.filter((item) => item.earned)
  const featured = earned.find((item) => item.id === profile.featured_achievement)
  const cards = profile.show_cards || onCollection ? profile.cards : undefined
  const hasCards = Boolean(cards?.length)
  const links = Object.entries(profile.links).filter(([, href]) => /^https:\/\//i.test(href))
  const { level_xp: levelXp, next_level_xp: nextLevelXp } = player
  const order: Module[] = profile.showcase_order || ["contracts", "achievements", "bureau"]
  const modules: Record<Module, ReactNode> = {
    contracts: profile.show_showcase && (
      <section className="dossier-module">
        <header>
          <h2>{ru ? "Избранные контракты" : "Featured contracts"}</h2>
          <span>{profile.showcase.length} / 3</span>
        </header>
        {profile.showcase.length ? (
          <ul className="dossier-cases">
            {profile.showcase.map((item) => (
              <li key={item.id}>
                <div>
                  <h3>{item.title_i18n?.[language] || contractTitle(item.title, language)}</h3>
                  <span>{dossierMode(item.mode)}</span>
                </div>
                <b>+{item.reward_xp.toLocaleString(locale)} XP</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dossier-empty">
            {ru ? "Пока нет завершённых контрактов." : "No completed contracts yet."}
          </p>
        )}
      </section>
    ),
    achievements: profile.show_achievements && profile.show_stats && (
      <section className="dossier-module">
        <header>
          <h2>{ru ? "Печати" : "Seals"}</h2>
          <span>{earned.length}</span>
        </header>
        {earned.length ? (
          <ul className="dossier-seals">
            {earned.map((item) => (
              <li key={item.id} title={item.description[language]}>
                <Seal item={item} />
                <span>{item.title[language]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dossier-empty">
            {ru ? "Пока нет полученных печатей." : "No seals earned yet."}
          </p>
        )}
      </section>
    ),
    bureau: bureau && (
      <section className="dossier-module">
        <header>
          <h2>{ru ? "Бюро" : "Bureau"}</h2>
          <span>
            {bureau.member_count} / {bureau.capacity}
          </span>
        </header>
        <div className={`dossier-bureau accent-${appearanceOf(bureau).accent.toLowerCase()}`}>
          <BureauEmblem item={bureau} />
          <div>
            <h3>{bureau.name}</h3>
            {bureau.tagline && <p>{bureau.tagline}</p>}
          </div>
          {onBureau ? (
            <button
              type="button"
              className="dc-ghost dossier-compact"
              onClick={() => onBureau(bureau.slug)}
            >
              {ru ? "Открыть бюро" : "Open bureau"}
            </button>
          ) : (
            <a className="dc-ghost dossier-compact" href={`/#bureaus/${bureau.slug}`}>
              {ru ? "Открыть бюро" : "Open bureau"}
            </a>
          )}
        </div>
      </section>
    ),
  }

  return (
    <article className={`dossier-view theme-${profile.theme.toLowerCase()}`}>
      <div className="dossier-header">
        <div className="dossier-cover" aria-hidden="true" />
        <div className="dossier-identity">
          {player.avatar_url ? (
            <img className="dossier-avatar" src={player.avatar_url} alt="" />
          ) : (
            <span className="dossier-avatar dossier-avatar-fallback" aria-hidden="true">
              DC
            </span>
          )}
          <div>
            <h1>{player.display_name}</h1>
            <div className="dossier-handle">
              <span>@{profile.slug}</span>
              {player.badges
                .filter((badge) => badge !== "PLAYER")
                .map((badge) => (
                  <span className="dossier-role" key={badge}>
                    {roleNames[badge]?.[ru ? 0 : 1] ?? badge}
                  </span>
                ))}
            </div>
            {profile.headline && <p>{profile.headline}</p>}
          </div>
          <div className="dossier-level">
            <p>
              {ru ? "Уровень" : "Level"} <strong>{player.level.toLocaleString(locale)}</strong>
            </p>
            {player.xp !== null && levelXp != null && nextLevelXp != null && nextLevelXp > 0 && (
              <>
                <progress
                  value={levelXp}
                  max={nextLevelXp}
                  aria-label={ru ? "Опыт текущего уровня" : "Current level experience"}
                />
                <span>
                  {levelXp.toLocaleString(locale)} / {nextLevelXp.toLocaleString(locale)} XP
                </span>
              </>
            )}
          </div>
        </div>
        {toolbar && <div className="dossier-toolbar">{toolbar}</div>}
      </div>
      <div className="dossier-columns">
        <div className="dossier-main">
          {profile.bio && <p className="dossier-bio">{profile.bio}</p>}
          {(hasCards || onCollection) && (
            <section className="dossier-module">
              <header>
                <div>
                  <h2>{ru ? "Витрина карточек" : "Card showcase"}</h2>
                  {!profile.show_cards && hasCards && (
                    <small>{ru ? "Скрыта от посетителей" : "Hidden from visitors"}</small>
                  )}
                </div>
                {onCollection && (
                  <button type="button" className="dc-ghost dossier-compact" onClick={onCollection}>
                    {ru ? "Коллекция" : "Collection"}
                  </button>
                )}
              </header>
              {cards?.length ? (
                <div className="dossier-card-showcase">
                  {cards.map((card) => (
                    <CardPreview key={card.id} card={card} />
                  ))}
                </div>
              ) : (
                <p className="dossier-empty">
                  {ru
                    ? "Выберите до трёх карточек для профиля в коллекции."
                    : "Choose up to three cards for your profile in your collection."}
                </p>
              )}
            </section>
          )}
          {order
            .filter((key) => modules[key])
            .map((key) => (
              <div key={key}>{modules[key]}</div>
            ))}
        </div>
        {(featured || stats || links.length > 0) && (
          <aside className="dossier-sidebar">
            {featured && (
              <section className="dossier-featured-seal">
                <h2>{ru ? "Главная печать" : "Featured seal"}</h2>
                <div>
                  <Seal item={featured} />
                  <div>
                    <h3>{featured.title[language]}</h3>
                    <p>{featured.description[language]}</p>
                  </div>
                </div>
              </section>
            )}
            {stats && (
              <section>
                <h2>{ru ? "Статистика" : "Stats"}</h2>
                <dl>
                  <div>
                    <dt>{ru ? "Контракты завершены" : "Contracts completed"}</dt>
                    <dd>{stats.contracts_completed.toLocaleString(locale)}</dd>
                  </div>
                  {player.xp !== null && (
                    <div>
                      <dt>{ru ? "Всего опыта" : "Total experience"}</dt>
                      <dd>{player.xp.toLocaleString(locale)} XP</dd>
                    </div>
                  )}
                  {profile.show_achievements && (
                    <div>
                      <dt>{ru ? "Печати" : "Seals"}</dt>
                      <dd>{earned.length.toLocaleString(locale)}</dd>
                    </div>
                  )}
                  {Object.entries(stats.mode_stats).map(([mode, stat]) => (
                    <div key={mode}>
                      <dt>{dossierMode(mode)}</dt>
                      <dd>{stat.completed.toLocaleString(locale)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {links.length > 0 && (
              <section>
                <h2>{ru ? "Ссылки" : "Links"}</h2>
                <div className="dossier-links">
                  {links.map(([key, href]) => (
                    <a
                      key={key}
                      className="dc-ghost dossier-compact"
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {key}
                    </a>
                  ))}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>
    </article>
  )
}
