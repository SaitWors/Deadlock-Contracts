import { AppearanceProvider } from "../src/Appearance"
// Offline review fixture. Real components with explicit, in-memory demo data.
import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import Bureaus from "../src/community/Bureaus"
import BureauBottomNav from "../src/BureauBottomNav"
import { DEFAULT_APPEARANCE } from "../src/community/BureauIdentity"
import Icon from "../src/icons/Icon"
import { ICON_NODES, type IconName } from "../src/icons/nodes"
import { LanguageProvider, LanguageSwitch } from "../src/i18n"

const names = [
  "Mandarin",
  "Ночной оперативник",
  "Павел",
  "Calico",
  "Очень длинное имя участника из Steam",
  "Violet",
  "Seven",
  "Архивариус",
]
let data = {
  slug: "night-office",
  name: "Deadlock Night Office",
  tagline: "Город меняется. Свои остаются.",
  description:
    "Бюро для тех, кто любит долгие матчи и хорошие истории. Играем вместе, собираем карточки и разбираем сложные контракты.\n\nНеважно, сколько у тебя часов в Deadlock. Важно, что ты готов поддержать команду.",
  rules: "Уважаем друг друга. Помогаем новым игрокам. Договариваемся о матче заранее.",
  theme: "DOSSIER",
  language: "ru",
  recruitment: "APPLICATION",
  member_count: 8,
  capacity: 25,
  status: "ACTIVE",
  my_role: "DIRECTOR",
  can_manage: true,
  can_edit: true,
  application_pending: false,
  applications: [
    {
      id: "application-one",
      display_name: "Новый игрок",
      message: "Ищу людей для вечерних матчей. Люблю играть за Ivy и Dynamo.",
    },
  ],
  bans: [],
  journal: [],
  design_revision: 1,
  listed: true,
  welcome:
    "Обычно собираемся после 20:00. Представьтесь ребятам и напишите, на ком играете. Рады видеть вас в бюро.",
  appearance: DEFAULT_APPEARANCE,
  avatar_url: null as string | null,
  cover_url: null as string | null,
  role_titles: { DIRECTOR: "Архивариус", MODERATOR: "Смотритель", OPERATIVE: "Свой человек" },
  members: names.map((name, i) => ({
    id: `member-${i}`,
    display_name: name,
    avatar_url: null,
    profile_url: null,
    role: i === 0 ? "DIRECTOR" : i === 1 ? "MODERATOR" : "OPERATIVE",
    is_me: i === 0,
  })),
}
let visitor = false
function directory() {
  return [
    data,
    {
      ...data,
      slug: "blue-hour",
      name: "Deadlock Blue Hour",
      tagline: "Здесь всегда найдётся место для ещё одной игры.",
      member_count: 17,
      recruitment: "OPEN",
      appearance: { ...DEFAULT_APPEARANCE, accent: "OCEAN", cover: "GRID", emblem: "moon" },
    },
    {
      ...data,
      slug: "velvet-archive",
      name: "Deadlock Velvet Archive",
      tagline: "Коллекционеры, исследователи и ценители хороших историй.",
      member_count: 12,
      recruitment: "APPLICATION",
      appearance: { ...DEFAULT_APPEARANCE, accent: "PLUM", cover: "ARCHIVE", emblem: "book-open" },
    },
  ]
}
window.fetch = async (input, init = {}) => {
  const url = String(input)
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  const shown = () =>
    visitor
      ? {
          ...data,
          my_role: null,
          can_manage: false,
          can_edit: false,
          welcome: "",
          applications: [],
          members: data.members.map((member, i) =>
            i % 2
              ? { ...member, id: null, display_name: null }
              : { ...member, id: null, is_me: false },
          ),
        }
      : data
  if (init.method === "PUT" && url.endsWith("/customization")) {
    const payload = JSON.parse(String(init.body))
    data = {
      ...data,
      ...payload,
      appearance: payload.appearance,
      design_revision: data.design_revision + 1,
      avatar_url:
        payload.avatar_image === ""
          ? null
          : payload.avatar_image
            ? `data:image/jpeg;base64,${payload.avatar_image}`
            : data.avatar_url,
      cover_url:
        payload.cover_image === ""
          ? null
          : payload.cover_image
            ? `data:image/jpeg;base64,${payload.cover_image}`
            : data.cover_url,
    }
    return reply({ bureau: shown() })
  }
  if (init.method && init.method !== "GET")
    return reply({ detail: "Это действие доступно на сайте. Макет меняет только оформление." }, 400)
  if (url.includes("bureau-reports")) return reply({ items: [] })
  if (url.includes("/operations")) return reply({ items: [], templates: {} })
  if (url.startsWith("/api/bureaus?"))
    return reply({
      items: directory(),
      total: 3,
      my_bureau: visitor ? null : data,
      pending_slugs: [],
    })
  if (url === "/api/bureaus/night-office") return reply({ bureau: shown() })
  const bureau = directory().find((item) => url.endsWith(item.slug))
  if (bureau)
    return reply({
      bureau: {
        ...bureau,
        my_role: null,
        can_manage: false,
        can_edit: false,
        welcome: "",
        applications: [],
      },
    })
  return reply({ detail: "Unknown fixture route" }, 404)
}

function Fixture() {
  const [slug, setSlug] = useState("night-office")
  const [asVisitor, setAsVisitor] = useState(false)
  const [icons, setIcons] = useState(false)
  return (
    <div
      className="dc-dashboard dc-redesign dc-v3 dc-vnext bureau-app min-h-screen community-dashboard"
      style={{ minHeight: "100vh", padding: "24px 16px 100px" }}
    >
      <main style={{ maxWidth: 1200, margin: "auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 14,
            borderBottom: "1px solid #ffffff18",
            paddingBottom: 18,
            marginBottom: 18,
          }}
        >
          <Icon name="compass" />
          <b>DEADLOCK CONTRACTS · PR37</b>
          <LanguageSwitch />
        </header>
        <p style={{ font: "13px/1.7 Inter,sans-serif", color: "#afbdad" }}>
          Макет для команды. Данные вымышлены. Можно менять оформление; оно сохраняется только до
          обновления страницы. Проверяйте на телефоне и компьютере.
        </p>
        <div className="community-actions">
          <button
            className="bureau-action"
            onClick={() => {
              setSlug("")
              setIcons(false)
            }}
          >
            Каталог бюро
          </button>
          <button
            className="bureau-action"
            onClick={() => {
              setSlug("night-office")
              setIcons(false)
            }}
          >
            Моё бюро
          </button>
          <button
            className="bureau-action"
            aria-pressed={asVisitor}
            onClick={() => {
              visitor = !asVisitor
              setAsVisitor(visitor)
            }}
          >
            {asVisitor ? "Вернуться к директору" : "Посмотреть как гость"}
          </button>
          <button className="bureau-action" onClick={() => setIcons(!icons)}>
            SVG-иконки
          </button>
          <a className="bureau-action" href="briefing.html">
            Вступление и договор
          </a>
        </div>
        {icons ? (
          <section className="community-page">
            <h1>Единый набор SVG</h1>
            <p>Lucide · ISC / MIT. Оригиналы в папке icons.</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
                gap: 12,
              }}
            >
              {(Object.keys(ICON_NODES) as IconName[]).map((name) => (
                <figure
                  key={name}
                  style={{ background: "#19221b", padding: 22, borderRadius: 16, margin: 0 }}
                >
                  <Icon name={name} size={28} />
                  <figcaption style={{ marginTop: 16, fontSize: 11, overflowWrap: "anywhere" }}>
                    {name}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ) : (
          <Bureaus key={String(asVisitor)} slug={slug} csrf="fixture" onSelect={setSlug} />
        )}
      </main>
      <BureauBottomNav
        active=""
        onNavigate={() => {
          setIcons(false)
          setSlug("night-office")
        }}
      />
    </div>
  )
}
export function mount(element: HTMLElement) {
  const root = createRoot(element)
  root.render(
    <LanguageProvider>
      <AppearanceProvider>
        <Fixture />
      </AppearanceProvider>
    </LanguageProvider>,
  )
  return root
}
