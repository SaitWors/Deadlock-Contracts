import { useState } from "react"
import { createRoot } from "react-dom/client"
import { AppearanceProvider } from "../src/Appearance"
import FoundationOverview from "../src/foundation/FoundationOverview"
import { LanguageProvider, LanguageSwitch } from "../src/i18n"

const idle = { loading: false, error: false, retry: () => {} }

function Fixture() {
  const [destination, setDestination] = useState("none")
  return (
    <LanguageProvider>
      <AppearanceProvider>
        <main
          className="bureau-app ritual-workspace"
          style={{ maxWidth: 1180, margin: "auto", padding: 12 }}
        >
          <LanguageSwitch />
          <p role="status">Preview destination · {destination}</p>
          <FoundationOverview
            accountId="first-visit-preview"
            name="Local Investigator"
            profile={{ xp: 0, avatar_url: null }}
            progression={{
              level: 1,
              level_xp: 0,
              next_level_xp: 130,
              total_xp: 0,
              xp_to_next: 130,
            }}
            progressionError={false}
            retryProgression={idle.retry}
            summary={{
              ...idle,
              data: {
                completed_cases: 0,
                weekly: [],
                collection: { items: 0, designs: 0 },
                bureau: null,
                has_signed_case: false,
                has_verified_result: false,
                has_claimed_daily_pack: false,
              },
            }}
            pack={{
              ...idle,
              data: {
                available: true,
                claimed_at: null,
                operation_id: null,
                next_reset_at: "2026-11-29T00:00:00Z",
                pack: { title: "Night envelopes" },
              },
            }}
            banner={{ card: null, error: false, retry: idle.retry }}
            activeCases={[]}
            recentResult={null}
            isNew
            returning={false}
            boardsPending={false}
            boardsError={false}
            retryBoards={idle.retry}
            companion={null}
            onNavigate={setDestination}
            onBureau={setDestination}
            onCompanion={() => setDestination("profile/companion")}
            onboarding={null}
            recommendation={null}
          />
        </main>
      </AppearanceProvider>
    </LanguageProvider>
  )
}

export function mount(element: HTMLElement) {
  createRoot(element).render(<Fixture />)
}
