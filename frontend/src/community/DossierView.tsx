import type { ReactNode } from "react"
import mark from "@/imports/mark.svg"
import Regalia from "../regalia/Regalia"
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
    player: { ...profile.player, xp: profile.show_stats ? profile.player.xp : null },
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
export default function DossierView({
  profile,
  toolbar,
  onBureau,
}: {
  profile: Profile
  toolbar?: ReactNode
  onBureau?: (slug: string) => void
}) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const featured = profile.achievements.find(
    (item) => item.id === profile.featured_achievement && item.earned,
  )
  const names: Record<Module, string> = {
    contracts: ru ? "Витрина дел" : "Case showcase",
    achievements: ru ? "Медали и печати" : "Medals & seals",
    bureau: ru ? "Моё бюро" : "My bureau",
  }
  const modules: Record<Module, ReactNode> = {
    contracts: profile.show_showcase && (
      <section className="dossier-module">
        <header>
          <h2>{names.contracts}</h2>
          <span>{profile.showcase.length} / 3</span>
        </header>
        <div className="dossier-cases">
          {profile.showcase.map((item, index) => (
            <article key={item.id} className={index === 0 ? "featured-case" : ""}>
              <p className="community-eyebrow">
                {ru ? "ДЕЛО ЗАКРЫТО" : "CASE CLOSED"} / {item.mode.replace(/_/g, " ")}
              </p>
              <h3>{item.title_i18n?.[language] || contractTitle(item.title, language)}</h3>
              <footer>
                <span>
                  {item.rarity} · {item.difficulty}
                </span>
                <b>+{item.reward_xp} XP</b>
              </footer>
            </article>
          ))}
          {!profile.showcase.length && (
            <div className="community-empty">
              <img src={mark} alt="" />
              <p>
                {ru
                  ? "Здесь будут дела, которыми вы гордитесь."
                  : "A place for the cases you are proud of."}
              </p>
              <small>
                {ru
                  ? "Завершите контракт, чтобы открыть витрину."
                  : "Complete a contract to start your showcase."}
              </small>
            </div>
          )}
        </div>
      </section>
    ),
    achievements: profile.show_achievements && profile.show_stats && (
      <section className="dossier-module">
        <header>
          <h2>{names.achievements}</h2>
          <span>{profile.achievements.filter((item) => item.earned).length}</span>
        </header>
        <div className="dossier-seals">
          {profile.achievements
            .filter((item) => item.earned)
            .map((item) => (
              <div key={item.id} title={item.description[language]}>
                <Seal item={item} />
                <span>{item.title[language]}</span>
              </div>
            ))}
          {!profile.achievements.some((item) => item.earned) && (
            <p className="community-muted">
              {ru
                ? "Первый завершённый контракт откроет первую медаль."
                : "Your first completed contract unlocks your first medal."}
            </p>
          )}
        </div>
      </section>
    ),
    bureau: profile.bureau && (
      <section className="dossier-module">
        <header>
          <h2>{names.bureau}</h2>
          <span>
            {profile.bureau.member_count} / {profile.bureau.capacity}
          </span>
        </header>
        <div className="dossier-bureau">
          <Regalia id="seal-team" />
          <div>
            <h3>{profile.bureau.name}</h3>
            <p>
              {profile.bureau.tagline ||
                (ru ? "Свои люди. Общие дела." : "Your people. Shared purpose.")}
            </p>
            {onBureau ? (
              <button onClick={() => onBureau(profile.bureau!.slug)}>
                {ru ? "Открыть бюро ↗" : "Open bureau ↗"}
              </button>
            ) : (
              <a href={`/#bureaus/${profile.bureau.slug}`}>
                {ru ? "Посмотреть бюро ↗" : "View bureau ↗"}
              </a>
            )}
          </div>
        </div>
      </section>
    ),
  }
  return (
    <article className={`dossier-view theme-${profile.theme.toLowerCase()}`}>
      <div className="dossier-cover">
        <img src={mark} alt="" />
        <p>
          DEADLOCK CONTRACTS <span>{ru ? "ЛИЧНОЕ ДЕЛО" : "PERSONAL FILE"}</span>
        </p>
        <span className="dossier-cover-id">@{profile.slug}</span>
      </div>
      <div className="dossier-identity">
        {profile.player.avatar_url ? (
          <img
            className="dossier-avatar"
            src={profile.player.avatar_url}
            alt={ru ? "Аватар Steam" : "Steam avatar"}
          />
        ) : (
          <div className="dossier-avatar dossier-avatar-fallback">DC</div>
        )}
        <div>
          <p className="community-eyebrow">{ru ? "ОПЕРАТИВНИК" : "OPERATIVE"}</p>
          <h1>{profile.player.display_name}</h1>
          <p>
            {profile.headline ||
              (ru
                ? "В городе всегда найдётся новое дело."
                : "There is always another case in the city.")}
          </p>
          <div className="dossier-badges">
            {profile.player.badges
              .filter((badge) => badge !== "PLAYER")
              .map((badge) => (
                <span key={badge}>{badge}</span>
              ))}
          </div>
        </div>
        <div className="dossier-level">
          <span>{ru ? "Уровень" : "Level"}</span>
          <b>{profile.player.level}</b>
          <small>Deadlock Contracts</small>
        </div>
      </div>
      {toolbar && <div className="dossier-toolbar">{toolbar}</div>}
      <div className="dossier-columns">
        <div className="dossier-main">
          {profile.bio && (
            <section className="dossier-bio">
              <p>{profile.bio}</p>
            </section>
          )}
          {(profile.showcase_order || ["contracts", "achievements", "bureau"]).map((key) => (
            <div key={key}>{modules[key]}</div>
          ))}
          {profile.show_cards && !!profile.cards?.length && (
            <section className="dossier-module">
              <header>
                <h2>{ru ? "Коллекция карточек" : "Card showcase"}</h2>
                <span>{profile.cards.length} / 3</span>
              </header>
              <div className="dossier-card-showcase">
                {profile.cards.map((card) => (
                  <CardPreview key={card.id} card={card} />
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="dossier-sidebar">
          {featured && (
            <section className="dossier-featured-seal">
              <p className="community-eyebrow">{ru ? "ГЛАВНАЯ ПЕЧАТЬ" : "FEATURED SEAL"}</p>
              <Seal item={featured} />
              <h2>{featured.title[language]}</h2>
              <p>{featured.description[language]}</p>
            </section>
          )}
          {profile.stats && (
            <section>
              <h2>{ru ? "Послужной список" : "Service record"}</h2>
              <dl>
                <div>
                  <dt>{ru ? "Контракты" : "Contracts"}</dt>
                  <dd>{profile.stats.contracts_completed}</dd>
                </div>
                <div>
                  <dt>{ru ? "Опыт" : "Experience"}</dt>
                  <dd>{(profile.player.xp ?? 0).toLocaleString(locale)} XP</dd>
                </div>
                <div>
                  <dt>{ru ? "Печати" : "Seals"}</dt>
                  <dd>{profile.achievements.filter((item) => item.earned).length}</dd>
                </div>
              </dl>
              <div className="dossier-modes">
                {Object.entries(profile.stats.mode_stats).map(([mode, stat]) => (
                  <p key={mode}>
                    <span>{mode.replace(/_/g, " ")}</span>
                    <b>{stat.completed}</b>
                  </p>
                ))}
              </div>
            </section>
          )}
          {Object.keys(profile.links).length > 0 && (
            <section>
              <h2>{ru ? "На связи" : "Find me"}</h2>
              <div className="dossier-links">
                {Object.entries(profile.links)
                  .filter(([, href]) => /^https:\/\//i.test(href))
                  .map(([key, href]) => (
                    <a key={key} href={href} target="_blank" rel="noreferrer">
                      {key} ↗
                    </a>
                  ))}
              </div>
            </section>
          )}
          <p className="community-footnote">
            {ru
              ? "Уровень и печати относятся к Deadlock Contracts."
              : "Level and seals belong to Deadlock Contracts."}
          </p>
        </aside>
      </div>
    </article>
  )
}
