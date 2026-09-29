import { useCallback } from "react"

export const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === "reduced" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

export function useRipple() {
  return useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (prefersReducedMotion() || event.detail === 0) return
    const button = event.currentTarget
    const rect = button.getBoundingClientRect()
    const ripple = document.createElement("span")
    ripple.className = "ripple-span"
    ripple.setAttribute("aria-hidden", "true")
    ripple.style.left = `${event.clientX - rect.left}px`
    ripple.style.top = `${event.clientY - rect.top}px`
    button.appendChild(ripple)
    window.setTimeout(() => ripple.remove(), 700)
  }, [])
}

export function useTilt(intensity = 2) {
  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (
        prefersReducedMotion() ||
        !window.matchMedia("(hover: hover) and (pointer: fine)").matches
      )
        return
      const element = event.currentTarget
      if (element.matches(":disabled")) return
      const rect = element.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width - 0.5
      const y = (event.clientY - rect.top) / rect.height - 0.5
      element.style.transform = `perspective(1000px) rotateY(${x * intensity}deg) rotateX(${-y * intensity}deg) translateY(-2px)`
    },
    [intensity],
  )
  const onMouseLeave = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.style.transform = ""
  }, [])
  return { onMouseMove, onMouseLeave }
}
