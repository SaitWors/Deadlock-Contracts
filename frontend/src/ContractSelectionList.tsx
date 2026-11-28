import Icon from "./icons/Icon"
import { useLanguage } from "./i18n"

export default function ContractSelectionList({
  items,
  onRemove,
}: {
  items: { id: string; title: string }[]
  onRemove?: (id: string) => void
}) {
  const { language } = useLanguage()
  const ru = language === "ru"
  if (!items.length) return null

  return (
    <ul
      className="dc-motion-selected-pills"
      aria-label={ru ? "Выбранные контракты" : "Selected contracts"}
    >
      {items.map(({ id, title }) => (
        <li key={id}>
          <span>{title}</span>
          {onRemove && (
            <button
              type="button"
              aria-label={ru ? `Убрать контракт «${title}»` : `Remove contract “${title}”`}
              onClick={(event) => {
                if (event.detail === 0) {
                  const item = event.currentTarget.parentElement
                  const next = item?.nextElementSibling ?? item?.previousElementSibling
                  const control =
                    next?.querySelector<HTMLElement>("button") ??
                    item
                      ?.closest(".dc-contract-dossier")
                      ?.querySelector<HTMLElement>(".dc-filter-row [aria-pressed=true]")
                  control?.focus()
                }
                onRemove(id)
              }}
            >
              <Icon name="x" size={15} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
