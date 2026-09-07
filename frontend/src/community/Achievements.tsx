import { useState } from "react"
import { useLanguage } from "../i18n"
import { useResource } from "./api"
import { LoadState, PageHead, Seal } from "./Shared"
import type { Collection } from "./types"

export default function Achievements({ onProfile }: { onProfile: () => void }) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  const resource = useResource<Collection>("/api/achievements")
  const [filter, setFilter] = useState("all")
  const data = resource.data
  return (
    <section className="community-page">
      <PageHead
        number="02 / SEAL ARCHIVE"
        title={ru ? "Каждое дело оставляет след." : "Every case leaves a mark."}
        text={
          ru
            ? "Ваши достижения — печати за выполненные контракты. Соберите коллекцию и выберите главную для профиля."
            : "Your achievements are seals earned through contracts. Build a collection and feature your favorite on your profile."
        }
      />
      {resource.loading || resource.error || !data ? (
        <LoadState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <div className="community-collection-summary">
            <span className="community-big-number">
              {String(data.earned).padStart(2, "0")}
              <small> / {data.total}</small>
            </span>
            <div>
              <h2>{ru ? "Коллекция печатей" : "Seal collection"}</h2>
              <p>
                {ru
                  ? "Полученные печати доступны для витрины."
                  : "Earned seals are available for your showcase."}
              </p>
              <progress
                aria-label={ru ? "Печати получены" : "Seals earned"}
                value={data.earned}
                max={data.total}
              />
            </div>
            <button className="dc-ghost" onClick={onProfile}>
              {ru ? "Оформить витрину ↗" : "Edit showcase ↗"}
            </button>
          </div>
          <div
            className="community-tabs"
            role="group"
            aria-label={ru ? "Фильтр достижений" : "Achievement filter"}
          >
            {[
              ["all", ru ? "Все печати" : "All seals"],
              ["earned", ru ? "Получены" : "Earned"],
              ["locked", ru ? "В процессе" : "In progress"],
            ].map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          <div className="achievement-grid">
            {data.items
              .filter(
                (item) => filter === "all" || (filter === "earned" ? item.earned : !item.earned),
              )
              .map((item) => (
                <article
                  key={item.id}
                  className={`achievement-card ${item.earned ? "earned" : ""}`}
                >
                  <Seal item={item} />
                  <p className="community-eyebrow">
                    {item.earned
                      ? ru
                        ? "ПЕЧАТЬ ПОЛУЧЕНА"
                        : "SEAL EARNED"
                      : ru
                        ? "ЕЩЁ ВПЕРЕДИ"
                        : "STILL AHEAD"}
                  </p>
                  <h2>{item.title[language]}</h2>
                  <p>{item.description[language]}</p>
                  <div className="achievement-progress">
                    <progress
                      aria-label={item.title[language]}
                      value={item.current}
                      max={item.target}
                    />
                    <span>
                      {item.current} / {item.target}
                    </span>
                  </div>
                  <small>
                    {item.earned_at
                      ? new Date(item.earned_at).toLocaleDateString(locale)
                      : ru
                        ? "Учитываются контракты с выданной наградой"
                        : "Awarded contracts count toward this seal"}
                  </small>
                </article>
              ))}
          </div>
          {!data.items.some(
            (item) => filter === "all" || (filter === "earned" ? item.earned : !item.earned),
          ) && (
            <p className="community-empty">
              {ru
                ? "Здесь пока нет печатей. Первое дело — хорошее начало."
                : "No seals here yet. Your first case is a good start."}
            </p>
          )}
        </>
      )}
    </section>
  )
}
