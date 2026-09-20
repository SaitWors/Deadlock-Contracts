import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { readFileSync } from "node:fs"
import { resolvePublicRoute } from "./src/publicRoutes"

export default defineConfig({
  base: "/static/",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "public-content-dev",
      apply: "serve",
      transformIndexHtml(html, context) {
        const route = resolvePublicRoute(context.originalUrl?.split("?")[0] || context.path)
        if (!route) return html
        const pages = JSON.parse(
          readFileSync(path.resolve(import.meta.dirname, "../shared/public-pages.json"), "utf8"),
        )
        const payload = JSON.stringify({
          ...route,
          content: pages[route.page][route.language],
        }).replace(/</g, "\\u003c")
        return {
          html,
          tags: [
            {
              tag: "script",
              attrs: { id: "dc-public-page", type: "application/json" },
              children: payload,
              injectTo: "head",
            },
          ],
        }
      },
    },
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  build: {
    sourcemap: false,
    minify: true,
    assetsDir: "assets",
    emptyOutDir: true,
  },
})
