import { useEffect, useState } from "react"
import { useLanguage } from "../i18n"
import CardPreview from "../archive/CardPreview"
import type { Bootstrap, Patron, Slot, Squad } from "./types"
import { localized } from "./types"
import { accessReason } from "../archive/battleAccess"
export default function SquadEditor({
  data,
  busy,
  onSave,
  onTrial,
  onReady,
}: {
  data: Bootstrap
  busy: boolean
  onSave: (squad: Squad) => void
  onTrial: (patron: Patron) => void
  onReady?: (ready: boolean) => void
}) {
  const { language } = useLanguage(),
    ru = language === "ru"
  const [slots, setSlots] = useState<Slot[]>(data.squad.slots)
  const [base, setBase] = useState<string | null>(data.squad.base_item_id)
  useEffect(() => {
    setSlots(data.squad.slots)
    setBase(data.squad.base_item_id)
  }, [data.squad.revision, data.squad.scope])
  const heroes = data.inventory.filter((item) => item.category === "HERO")
  const selected = slots
    .map((slot) => heroes.find((item) => item.item_id === slot.item_id))
    .filter((item) => !!item)
  const baseItem = data.inventory.find((item) => item.item_id === base)
  const cost = selected.reduce((sum, item) => sum + item.stats.cost, base ? 2 : 0)
  const duplicates = selected.length - new Set(selected.map((item) => item.hero_key)).size
  const sss = selected.filter((item) => item.card.rank === "SSS").length
  const valid =
    selected.length === 6 &&
    !duplicates &&
    sss <= 2 &&
    cost <= data.rules.budget &&
    selected.every((item) => !item.reserved) &&
    (!base || (!!baseItem && !baseItem.reserved))
  const setSlot = (line: number, position: Slot["position"], item_id: string) =>
    setSlots((previous) => [
      ...previous.filter((slot) => !(slot.line === line && slot.position === position)),
      ...(item_id ? [{ item_id, line, position }] : []),
    ])
  const unchanged =
    base === data.squad.base_item_id &&
    JSON.stringify(
      [...slots].sort((a, b) => a.line - b.line || a.position.localeCompare(b.position)),
    ) ===
      JSON.stringify(
        [...data.squad.slots].sort(
          (a, b) => a.line - b.line || a.position.localeCompare(b.position),
        ),
      )
  useEffect(() => onReady?.(valid && unchanged), [valid, unchanged, onReady])
  return (
    <section className="arena-panel arena-editor">
      <h2>{ru ? "Состав и покровитель" : "Squad & patron"}</h2>
      <div className="arena-budget" role="status">
        <b>
          {selected.length} / 6 {ru ? "героев" : "heroes"}
        </b>
        <b>
          {cost} / {data.rules.budget} {ru ? "очков" : "budget"}
        </b>
        <span>SSS: {sss} / 2</span>
      </div>
      <p>
        {ru
          ? "Шесть разных героев. Ранг усиливает только HP и обычную атаку. EX занимает 2 очка из 24."
          : "Six distinct heroes. Rank scales HP and basic attack only. EX uses 2 of 24 budget points."}
      </p>
      {!!data.unavailable_inventory?.length && (
        <aside className="arena-notice">
          <h3>{ru ? "Карты без доступа к арене" : "Cards without arena access"}</h3>
          <p>
            {ru
              ? "Эти карты остаются в вашей коллекции. В состав можно выбрать карты с одобренными правилами боя."
              : "These cards remain in your collection. You can choose cards with approved battle rules for your squad."}
          </p>
          <ul>
            {data.unavailable_inventory.map((item) => (
              <li key={item.item_id}>
                <b>
                  {item.card.hero_name} · {item.card.title} · {item.card.rank}
                </b>{" "}
                {item.reason === "UNSUPPORTED_HERO"
                  ? ru
                    ? "Для этого героя пока нет одобренных правил боя."
                    : "This hero has no approved battle rules yet."
                  : ru
                    ? "Эта карта ещё не одобрена для боёв."
                    : "This card is not yet approved for battles."}
              </li>
            ))}
          </ul>
        </aside>
      )}
      <div className="arena-patrons" aria-label={ru ? "Выбор покровителя" : "Patron selection"}>
        {(["ORDINARY", "HIDDEN_KING", "ARCHMOTHER"] as Patron[]).map((key) => {
          const owned = data.inventory.filter(
              (item) => item.category === "BASE" && item.definition_key === key,
            ),
            preview =
              owned.find((item) => item.item_id === base) ||
              owned.find((item) => !item.reserved) ||
              owned[0],
            definition = preview?.definition?.rules || data.rules.bases[key],
            access = data.progression.ex_access[key],
            chosen = key === "ORDINARY" ? !base : baseItem?.definition_key === key
          return (
            <article key={key} className="arena-patron" data-patron={key} data-selected={chosen}>
              <small>
                {key === "ORDINARY" ? (ru ? "ОБЫЧНАЯ БАЗА" : "ORDINARY BASE") : "EX · BASE"}
              </small>
              <h3>{localized(definition?.name, language) || key}</h3>
              <p>
                HP {preview?.stats.max_hp || 1000} · {ru ? "Стражи" : "Guardians"} 3 × 240 ·{" "}
                {ru ? "Стоимость состава" : "Squad cost"} {key === "ORDINARY" ? 0 : 2}
              </p>
              {preview?.card && <CardPreview card={preview.card} />}
              {owned.length > 1 && (
                <label>
                  {ru ? "Экземпляр базы" : "Base instance"}
                  <select
                    aria-label={`${localized(definition?.name, language)} · ${ru ? "экземпляр" : "instance"}`}
                    disabled={busy}
                    value={preview?.item_id || ""}
                    onChange={(event) => setBase(event.target.value)}
                  >
                    {owned.map((item) => (
                      <option key={item.item_id} value={item.item_id} disabled={item.reserved}>
                        {item.card.title}
                        {item.definition ? ` · v${item.definition.version}` : ""}
                        {item.reserved ? (ru ? " · В бою" : " · In battle") : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {definition?.passive && <p>{localized(definition.passive, language)}</p>}
              {definition?.ability && (
                <p>
                  <b>{localized(definition.ability.name, language)}</b> ·{" "}
                  {localized(definition.ability.description, language)} · ⚡3 ·{" "}
                  {ru ? "Перезарядка 3 раунда" : "Cooldown 3 rounds"}
                </p>
              )}
              {key !== "ORDINARY" && (
                <>
                  <p>
                    {ru
                      ? "Доступ: 7 дней · 20 контрактов или 15 наградных PvE-побед · своё испытание · покупка 1800."
                      : "Access: 7 days · 20 contracts or 15 reward-eligible PvE wins · own trial · 1800 coin purchase."}
                  </p>
                  <p>
                    {data.progression.account_days}/7 {ru ? "дней" : "days"} ·{" "}
                    {data.progression.confirmed_contracts}/20 {ru ? "контрактов" : "contracts"} ·{" "}
                    {data.progression.eligible_pve_wins}/15 PvE
                  </p>
                  {access?.reasons.map((reason) => (
                    <p key={reason}>{accessReason(reason, ru)}</p>
                  ))}
                  <button disabled={busy} onClick={() => onTrial(key)}>
                    {ru ? "Пройти испытание" : "Play patron trial"}
                  </button>
                  {!owned.length && (
                    <a href="#archive">
                      {ru ? "Приобрести в каталоге · 1800" : "Acquire in catalogue · 1800"}
                    </a>
                  )}
                </>
              )}
              <button
                aria-pressed={chosen}
                disabled={busy || (key !== "ORDINARY" && !owned.some((item) => !item.reserved))}
                onClick={() =>
                  setBase(key === "ORDINARY" ? null : owned.find((item) => !item.reserved)!.item_id)
                }
              >
                {chosen ? (ru ? "Выбрана" : "Selected") : ru ? "Выбрать базу" : "Select base"}
              </button>
            </article>
          )
        })}
      </div>
      <div className="arena-squad-lines">
        {[0, 1, 2].map((line) => (
          <fieldset key={line}>
            <legend>
              {ru ? "Линия" : "Lane"} {line + 1}
            </legend>
            {(["FRONT", "BACK"] as const).map((position) => {
              const slot = slots.find(
                  (value) => value.line === line && value.position === position,
                ),
                item = heroes.find((value) => value.item_id === slot?.item_id)
              return (
                <div key={position}>
                  <label>
                    {position === "FRONT"
                      ? ru
                        ? "Передний ряд"
                        : "Front"
                      : ru
                        ? "Задний ряд"
                        : "Back"}
                    <select
                      aria-label={`${ru ? "Линия" : "Lane"} ${line + 1} ${position}`}
                      value={slot?.item_id || ""}
                      onChange={(event) => setSlot(line, position, event.target.value)}
                      disabled={busy}
                    >
                      <option value="">{ru ? "Выберите героя" : "Choose hero"}</option>
                      {heroes.map((hero) => (
                        <option key={hero.item_id} value={hero.item_id} disabled={hero.reserved}>
                          {hero.card.hero_name} · {hero.card.rank} · {hero.stats.cost}{" "}
                          {ru ? "очк." : "pts"}
                          {hero.reserved ? (ru ? " · В бою" : " · In battle") : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {item && (
                    <>
                      <CardPreview card={item.card} />
                      <p>
                        HP {item.stats.max_hp} · ⚔ {item.stats.attack} · {ru ? "Броня" : "Armor"}{" "}
                        {item.stats.armor}% · {ru ? "Цена состава" : "Cost"} {item.stats.cost}
                      </p>
                      <p>
                        {localized(
                          (item.definition?.rules || data.rules.heroes[item.hero_key])?.role,
                          language,
                        )}
                      </p>
                      <p>
                        {localized(
                          (item.definition?.rules || data.rules.heroes[item.hero_key])?.ability
                            ?.description,
                          language,
                        )}
                      </p>
                      {item.definition && (
                        <small>
                          {ru ? "Одобренный вариант" : "Approved definition"} · v
                          {item.definition.version}
                        </small>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </fieldset>
        ))}
      </div>
      {duplicates > 0 && (
        <p role="alert">
          {ru
            ? "Повторяется герой: выберите шесть разных героев."
            : "Duplicate hero: choose six distinct heroes."}
        </p>
      )}
      {cost > data.rules.budget && (
        <p role="alert">{ru ? "Превышен бюджет состава." : "Squad budget exceeded."}</p>
      )}
      {sss > 2 && <p role="alert">{ru ? "Не больше двух SSS." : "At most two SSS heroes."}</p>}
      <button
        className="arena-primary"
        disabled={busy || !valid}
        onClick={() => onSave({ ...data.squad, slots, base_item_id: base })}
      >
        {ru ? "Сохранить состав" : "Save squad"}
      </button>
    </section>
  )
}
