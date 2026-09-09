import Icon from "../icons/Icon"
import { useState } from "react"
import { useResource } from "../community/api"
import { useLanguage } from "../i18n"
import { Pager } from "./ArchivePage"
import CardPreview from "./CardPreview"
import type { Pack } from "./types"
import type { useTransaction } from "./transactions"

export function PackOdds({ pack }: { pack: Pick<Pack, "odds" | "draws"> }) {
  const { language, locale } = useLanguage()
  const ru = language === "ru"
  return (
    <div className="archive-pack-odds">
      <p>
        {ru
          ? `Карточек в конверте: ${pack.draws}. Каждый слот разыгрывается независимо; возможны дубли. Гарантированного ранга нет.`
          : `${pack.draws} cards per pack. Each slot is drawn independently; duplicates are possible. No guaranteed rank.`}
      </p>
      <div>
        {pack.odds.map((odd) => (
          <span key={odd.rank}>
            <b>{odd.rank}</b> {odd.percent.toLocaleString(locale, { maximumFractionDigits: 4 })}%
          </span>
        ))}
      </div>
      <small>
        {ru
          ? "Шанс ранга в одном слоте. Непоказанные ранги не входят в состав."
          : "Rank probability per slot. Unlisted ranks are not in this pack."}
      </small>
    </div>
  )
}

export default function PackShop({
  revision,
  balance,
  transaction,
}: {
  revision: number
  balance: number
  transaction: ReturnType<typeof useTransaction>
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const data = useResource<{ items: Pack[]; total: number; starter_claimed: boolean }>(
    `/api/archive/packs?offset=${offset}&refresh=${revision}`,
  )
  return (
    <section>
      <h2>{ru ? "Конверты архива" : "Archive envelopes"}</h2>
      <p>
        {ru
          ? "Выбери выпуск и проверь состав перед открытием. Один стартовый конверт на аккаунт — из выпусков, отмеченных владельцем."
          : "Choose a release and inspect its contents before opening. One starter pack per account, from releases marked by the owner."}
      </p>
      {data.error && (
        <p role="alert">
          {data.error} <button onClick={data.reload}>{ru ? "Повторить" : "Retry"}</button>
        </p>
      )}
      {data.loading && <p role="status">{ru ? "Загрузка конвертов…" : "Loading packs…"}</p>}
      {data.data?.total === 0 && (
        <div className="archive-empty">
          <Icon name="mail" size={28} />
          <p>
            {ru
              ? "Владелец ещё не опубликовал конверты. Жетоны сохраняются; карточку можно получить напрямую в каталоге."
              : "No packs have been published yet. Tokens are saved; individual cards are available in the catalogue."}
          </p>
        </div>
      )}
      {selected && (
        <PackDetails
          key={selected}
          id={selected}
          revision={revision}
          balance={balance}
          starterClaimed={!!data.data?.starter_claimed}
          transaction={transaction}
          onClose={() => setSelected(null)}
        />
      )}
      <div className="archive-pack-grid">
        {data.data?.items.map((pack) => (
          <article className="archive-pack-tile" key={pack.id}>
            <div className="archive-envelope-art" aria-hidden="true">
              <Icon name="mail" size={28} />
              <b>{pack.draws}</b>
            </div>
            <small>
              {pack.starter
                ? ru
                  ? "ДОСТУПЕН КАК СТАРТОВЫЙ"
                  : "STARTER ELIGIBLE"
                : "ARCHIVE RELEASE"}
            </small>
            <h3>{pack.title}</h3>
            <p>{pack.description}</p>
            <p>
              {pack.card_count} {ru ? "дизайнов в составе" : "designs in pool"} · {pack.price}{" "}
              <Icon name="coins" size={18} />
            </p>
            {!pack.ready && (
              <p>
                {ru
                  ? "Выдача приостановлена: состав требует обновления."
                  : "Paused: contents require an update."}
              </p>
            )}
            <button onClick={() => setSelected(pack.id)}>
              {ru ? "Состав и открытие" : "Contents & opening"}
            </button>
          </article>
        ))}
      </div>
      {data.data && (
        <Pager offset={offset} total={data.data.total} size={8} setOffset={setOffset} />
      )}
    </section>
  )
}

function PackDetails({
  id,
  revision,
  balance,
  starterClaimed,
  transaction,
  onClose,
}: {
  id: string
  revision: number
  balance: number
  starterClaimed: boolean
  transaction: ReturnType<typeof useTransaction>
  onClose: () => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const data = useResource<{ pack: Pack }>(`/api/archive/packs/${id}?refresh=${revision}`)
  const pack = data.data?.pack
  const locked = transaction.busy || !!transaction.pending || !pack?.ready
  return (
    <section
      className="archive-panel archive-pack-details"
      aria-label={ru ? "Выбранный конверт" : "Selected pack"}
    >
      <button onClick={onClose}>{ru ? "Закрыть состав" : "Close contents"}</button>
      {data.error && (
        <p role="alert">
          {data.error} <button onClick={data.reload}>{ru ? "Обновить" : "Refresh"}</button>
        </p>
      )}
      {data.loading && <p role="status">{ru ? "Загрузка состава…" : "Loading contents…"}</p>}
      {pack && (
        <>
          <h2>{pack.title}</h2>
          <p>{pack.description}</p>
          <PackOdds pack={pack} />
          <div className="archive-actions">
            <button
              className="archive-primary"
              disabled={locked || balance < pack.price}
              onClick={() =>
                void transaction.execute(`/api/archive/packs/${pack.id}/open`, {
                  revision: pack.revision,
                  starter: false,
                })
              }
            >
              {ru ? `Открыть за ${pack.price} жет.` : `Open for ${pack.price} tokens`}
            </button>
            {pack.starter && !starterClaimed && (
              <button
                disabled={locked}
                onClick={() =>
                  void transaction.execute(`/api/archive/packs/${pack.id}/open`, {
                    revision: pack.revision,
                    starter: true,
                  })
                }
              >
                {ru ? "Получить стартовый бесплатно" : "Claim free starter"}
              </button>
            )}
          </div>
          {balance < pack.price && (
            <p>
              {ru
                ? "На платное открытие пока не хватает жетонов. Их можно заработать в шифре бюро."
                : "Earn more tokens in the bureau cipher to pay for this pack."}
            </p>
          )}
          {!pack.ready && (
            <p role="alert">
              {ru
                ? "Одна из карточек недоступна. Открытие приостановлено; жетоны не списываются."
                : "A card is unavailable. Opening is paused; no tokens are charged."}
            </p>
          )}
          <details>
            <summary>
              {ru ? `Все карточки (${pack.card_count})` : `All cards (${pack.card_count})`}
            </summary>
            <div className="archive-pool-grid">
              {pack.entries?.map((entry) => (
                <article key={entry.card_id}>
                  {entry.card && <CardPreview card={entry.card} />}
                  <p>
                    {entry.card?.title || (ru ? "Недоступная карточка" : "Unavailable card")} ·{" "}
                    {entry.percent}%
                  </p>
                </article>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  )
}
