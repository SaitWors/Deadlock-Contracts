import { useCallback, useLayoutEffect, type RefObject } from "react"

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

// A short first-screen sequence. Content is visible by default, including
// browsers without WAAPI. No selection or navigation waits for this motion.
export function useSceneEntrance(
  ref: RefObject<HTMLElement | null>,
  scene: string,
  reduced: boolean,
) {
  useLayoutEffect(() => {
    if (!ref.current || reduced || prefersReducedMotion()) return
    const animations = Array.from(ref.current.querySelectorAll<HTMLElement>("[data-intro]"))
      .filter((element) => typeof element.animate === "function")
      .map((element, index) =>
        element.animate(
          [
            { opacity: 0, transform: "translate3d(0,22px,0)" },
            { opacity: 1, transform: "translate3d(0,0,0)" },
          ],
          {
            duration: 520,
            delay: Math.min(index * 80, 160),
            easing: "cubic-bezier(.2,.75,.25,1)",
            fill: "backwards",
          },
        ),
      )
    return () => animations.forEach((animation) => animation.cancel())
  }, [ref, scene, reduced])
}
