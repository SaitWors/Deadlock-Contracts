import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { resolvePublicRoute, type PublicRoute } from "./publicRoutes"

type NavigationState = { pathname: string; pending: boolean }
const PublicNavigationContext = createContext<NavigationState | null>(null)

// Fetch the same documents used for direct visits, keeping their copy and SEO
// metadata together while the shared header and animated scenery stay mounted.
const documentMetadata = [
  "title",
  'meta[name="description"]',
  'meta[name="robots"]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
  'link[rel="canonical"]',
  'link[rel="alternate"][hreflang]',
  'script[type="application/ld+json"]',
  "#dc-public-page",
].join(",")

function readDestination(source: string, route: PublicRoute) {
  const destination = new DOMParser().parseFromString(source, "text/html")
  const payload = JSON.parse(
    destination.head.querySelector("#dc-public-page")?.textContent || "null",
  )
  const copy = payload?.content
  if (
    payload?.page !== route.page ||
    payload.language !== route.language ||
    typeof copy?.heading !== "string" ||
    typeof copy.intro !== "string" ||
    !Array.isArray(copy.sections) ||
    !copy.sections.every(
      (section: { heading?: unknown; text?: unknown } | null) =>
        section && typeof section.heading === "string" && typeof section.text === "string",
    )
  )
    throw new Error("Invalid public document")
  return destination
}

function focusAndScroll(url: URL) {
  const main = document.querySelector<HTMLElement>("#main-content, main")
  const heading =
    main?.querySelector<HTMLElement>("h1") || main || document.querySelector<HTMLElement>("h1")
  if (heading) {
    heading.setAttribute("tabindex", "-1")
    heading.focus({ preventScroll: true })
  }
  let target: HTMLElement | null = null
  try {
    if (url.hash) target = document.getElementById(decodeURIComponent(url.hash.slice(1)))
  } catch {
    // An invalid fragment still opens the requested page at the top.
  }
  if (target?.scrollIntoView) target.scrollIntoView({ block: "start", behavior: "instant" })
  else window.scrollTo({ top: 0, left: 0, behavior: "instant" })
}

export function PublicNavigationProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode
  enabled?: boolean
}) {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const [pending, setPending] = useState(false)
  const committed = useRef(window.location.href)
  const scrollDestination = useRef<URL | null>(null)

  useLayoutEffect(() => {
    const url = scrollDestination.current
    if (pending || !url) return
    scrollDestination.current = null
    focusAndScroll(url)
  }, [pathname, pending])

  useEffect(() => {
    if (!enabled || !resolvePublicRoute(window.location.pathname)) return
    let request = 0
    let controller: AbortController | undefined
    let timeout: number | undefined

    const cancel = () => {
      request += 1
      controller?.abort()
      window.clearTimeout(timeout)
    }
    const navigate = async (url: URL, push: boolean) => {
      cancel()
      const currentRequest = request
      const previous = new URL(committed.current)
      if (url.pathname === previous.pathname && url.search === previous.search) {
        if (push) {
          if (url.href !== window.location.href)
            window.history.pushState(null, "", url.pathname + url.search + url.hash)
          focusAndScroll(url)
        }
        // Same-document history traversal keeps the browser's restored scroll.
        committed.current = url.href
        setPending(false)
        return
      }
      const route = resolvePublicRoute(url.pathname)
      if (!route) {
        window.location.assign(url.href)
        return
      }
      const destinationController = new AbortController()
      controller = destinationController
      setPending(true)
      timeout = window.setTimeout(() => destinationController.abort(), 12_000)
      try {
        const response = await fetch(url.href, {
          credentials: "same-origin",
          headers: { Accept: "text/html" },
          signal: destinationController.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const destination = readDestination(await response.text(), route)
        if (request !== currentRequest) return
        document.head.querySelectorAll(documentMetadata).forEach((element) => element.remove())
        destination.head.querySelectorAll(documentMetadata).forEach((element) => {
          document.head.append(document.importNode(element, true))
        })
        document.documentElement.lang = route.language
        document.documentElement.dataset.language = route.language
        if (push) window.history.pushState(null, "", url.pathname + url.search + url.hash)
        committed.current = url.href
        scrollDestination.current = url
        setPathname(url.pathname)
        setPending(false)
      } catch {
        if (request === currentRequest) {
          setPending(false)
          window.location.assign(url.href)
        }
      } finally {
        if (request === currentRequest) window.clearTimeout(timeout)
      }
    }
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]")
      if (
        !anchor ||
        (anchor.target && anchor.target !== "_self") ||
        anchor.hasAttribute("download") ||
        anchor.relList.contains("external")
      )
        return
      const url = new URL(anchor.href, window.location.href)
      if (
        url.origin !== window.location.origin ||
        url.pathname === "/" ||
        !resolvePublicRoute(url.pathname) ||
        (url.pathname === window.location.pathname &&
          url.search === window.location.search &&
          url.hash)
      )
        return
      event.preventDefault()
      void navigate(url, true)
    }
    const pop = () => {
      const url = new URL(window.location.href)
      if (!resolvePublicRoute(url.pathname)) {
        cancel()
        window.location.reload()
        return
      }
      void navigate(url, false)
    }
    document.addEventListener("click", click)
    window.addEventListener("popstate", pop)
    return () => {
      cancel()
      document.removeEventListener("click", click)
      window.removeEventListener("popstate", pop)
    }
  }, [enabled])

  const value = useMemo(() => ({ pathname, pending }), [pathname, pending])
  return (
    <PublicNavigationContext.Provider value={value}>{children}</PublicNavigationContext.Provider>
  )
}

export function usePublicNavigation(): NavigationState {
  return (
    useContext(PublicNavigationContext) || { pathname: window.location.pathname, pending: false }
  )
}
