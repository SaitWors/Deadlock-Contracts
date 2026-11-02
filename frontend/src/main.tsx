import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"
import "./vnext.css"
import "./bureau.css"
import "./community/community.css"
import "./announcements/announcements.css"
import "./bureau-stage6.css"
import "./community/guilds.css"
import "./interface-polish.css"
import "./appearance.css"
import "./nightshift-layout.css"
import "./nightshift-surfaces.css"
import "./nightshift-core.css"
import "./admin/nightshift-admin.css"
import "./ritual.css"
import "./ritual-workspace.css"
import "./ritual-foundations.css"
import { applyAppearance, readAppearance } from "./appearance-state"

applyAppearance(readAppearance())

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
