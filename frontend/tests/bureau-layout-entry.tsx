import { AppearanceProvider } from "../src/Appearance"
import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import BureauGuide from "../src/BureauGuide"
import BureauBottomNav from "../src/BureauBottomNav"
import ContractSigning from "../src/ContractSigning"
import ModeSelector, { type MatchMode } from "../src/ModeSelector"
import Regalia from "../src/regalia/Regalia"
import { REGALIA, type RegaliaId } from "../src/regalia/catalog"
import { LanguageProvider, LanguageSwitch } from "../src/i18n"

function Fixture() {
  const [guide, setGuide] = useState(false)
  const [signing, setSigning] = useState(false)
  const [mode, setMode] = useState<MatchMode>("STANDARD")
  const [active, setActive] = useState("home")
  return (
    <div
      className="dc-dashboard dc-redesign dc-v3 dc-vnext bureau-app min-h-screen community-dashboard"
      style={{ padding: "24px 16px 100px", minHeight: "100vh" }}
    >
      <main style={{ maxWidth: 1100, margin: "auto" }}>
        <h1>PR37 · визуальная приёмка</h1>
        <p>
          Реальные компоненты. Ширину окна меняйте средствами браузера. Здесь нет авторизации и
          начисления наград.
        </p>
        <LanguageSwitch />
        <div className="archive-actions" style={{ marginBottom: 24 }}>
          <button className="bureau-action" onClick={() => setGuide(true)}>
            Открыть вступление
          </button>
          <button className="bureau-action" onClick={() => setSigning(true)}>
            Открыть договор
          </button>
        </div>
        <ModeSelector
          value={mode}
          onChange={setMode}
          statuses={{ STANDARD: "Доступно", RANKED: "Доступно", STREET_BRAWL: "Доступно" }}
        />
        <p>
          Выбран режим: {mode}. Раздел: {active}.
        </p>
        <section className="dc-home-archive-callout">
          <div>
            <span className="bureau-callout-label">ДОСТУПНО БЕЗ КОМПАНЬОНА</span>
            <strong>Сегодня в бюро</strong>
            <p>Разберите шифр, заработайте жетоны и начните коллекцию карточек героев.</p>
          </div>
          <div className="bureau-callout-actions">
            <button className="bureau-action" onClick={() => setActive("archive")}>
              Разобрать шифр
            </button>
            <button
              className="bureau-action bureau-action-secondary"
              onClick={() => setActive("studio")}
            >
              Создать карточку с длинным названием
            </button>
          </div>
        </section>
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: 20,
          }}
        >
          {(Object.entries(REGALIA) as [RegaliaId, (typeof REGALIA)[RegaliaId]][]).map(
            ([id, art]) => (
              <figure
                key={id}
                style={{
                  padding: 16,
                  margin: 0,
                  background: "#162219",
                  border: "1px solid #43523e",
                  minWidth: 0,
                }}
              >
                <Regalia id={id} />
                <figcaption>
                  <strong>{art.label}</strong>
                  <p style={{ overflowWrap: "anywhere" }}>{id}</p>
                  <small>Lucide · SVG</small>
                </figcaption>
              </figure>
            ),
          )}
        </section>
      </main>
      <BureauBottomNav active={active} onNavigate={setActive} />
      {guide && (
        <BureauGuide
          onClose={() => setGuide(false)}
          onNavigate={(tab) => {
            setActive(tab)
            setGuide(false)
          }}
        />
      )}
      {signing && (
        <ContractSigning
          preview
          mode={mode}
          operator="Игрок с очень длинным именем из Steam"
          changed={false}
          onClose={() => setSigning(false)}
          onSignIn={() => setSigning(false)}
          options={[
            {
              id: "one",
              title: "Контрольный выстрел",
              description: "В следующем подходящем матче нанесите героям не менее 13 000 урона.",
              reward: 55,
            },
            {
              id: "two",
              title: "Оперативная отметка",
              description: "Победите в матче выбранного режима.",
              reward: 140,
            },
            {
              id: "three",
              title: "Длинное название контракта для проверки переноса текста",
              description:
                "Проверьте, что название, описание и награда остаются внутри документа при увеличении масштаба и на узком телефоне.",
              reward: 75,
            },
          ]}
        />
      )}
    </div>
  )
}
export function mount(element: HTMLElement) {
  createRoot(element).render(
    <LanguageProvider>
      <AppearanceProvider>
        <Fixture />
      </AppearanceProvider>
    </LanguageProvider>,
  )
}
