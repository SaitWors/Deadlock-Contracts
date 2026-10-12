import BureauHeader from "./BureauHeader"
import { MCGCredit, useLanguage } from "./i18n"
import DossierView from "./community/DossierView"
import { useResource } from "./community/api"
import { LoadState } from "./community/Shared"
import type { Profile } from "./community/types"
import { lazy, Suspense } from "react"
const PublicSquad = lazy(() => import("./arena/PublicSquad"))

export default function PublicDossier({ slug }: { slug: string }) {
  const { language } = useLanguage()
  const ru = language === "ru"
  const resource = useResource<{ profile: Profile }>(
    `/api/public/profiles/${encodeURIComponent(slug)}`,
  )
  return (
    <div className="bureau-public public-dossier-shell">
      <BureauHeader
        active="profile"
        items={[
          { id: "home", label: ru ? "Главная" : "Home" },
          { id: "leaderboards", label: ru ? "Рейтинг" : "Leaderboard" },
        ]}
        onNavigate={(id) => location.assign(`/#${id === "home" ? "home" : "leaderboards"}`)}
        actions={
          <a className="dc-ghost" href="/">
            {ru ? "В бюро" : "Back to bureau"}
          </a>
        }
      />
      <main className="community-page">
        {resource.error ? (
          <div className="community-empty" role="alert">
            <h1>{ru ? "Не удалось открыть профиль" : "Could not open this profile"}</h1>
            <p>
              {ru
                ? "Он может быть скрыт или временно недоступен."
                : "It may be private or temporarily unavailable."}
            </p>
            <button className="dc-ghost" onClick={resource.reload}>
              {ru ? "Повторить" : "Try again"}
            </button>
          </div>
        ) : !resource.data ? (
          <LoadState />
        ) : (
          <>
            <DossierView profile={resource.data.profile} />
            <Suspense fallback={null}>
              <PublicSquad slug={slug} />
            </Suspense>
          </>
        )}
      </main>
      <footer className="community-footer">
        <MCGCredit language={language} />
      </footer>
    </div>
  )
}
