import { useEffect, useRef, useState, type CSSProperties } from "react"
import { useReducedMotion } from "./Appearance"
import "./bureau-atmosphere.css"

const asset = (file: string) => `${import.meta.env.BASE_URL}assets/ritual/${file}`

export default function BureauAtmosphere() {
  const reduced = useReducedMotion()
  const video = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", change)
    return () => document.removeEventListener("visibilitychange", change)
  }, [])
  useEffect(() => {
    const element = video.current
    if (!element) return
    let active = true
    if (reduced || !visible) {
      element.pause()
      setPlaying(false)
    } else {
      try {
        element.play()?.catch(() => {
          if (active) setPlaying(false)
        })
      } catch {
        setPlaying(false)
      }
    }
    return () => {
      active = false
      element.pause()
    }
  }, [reduced, visible])
  return (
    <div
      className="bureau-atmosphere"
      aria-hidden="true"
      data-moving={!reduced && visible}
      data-playing={playing}
    >
      <div className="bureau-atmosphere-film">
        <img src={asset("bureau-atmosphere.avif")} alt="" decoding="async" />
        {!reduced && (
          <video
            ref={video}
            src={asset("bureau-atmosphere.mp4")}
            muted
            loop
            playsInline
            preload="none"
            tabIndex={-1}
            onPlaying={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setPlaying(false)}
          />
        )}
      </div>
      <div className="bureau-atmosphere-glow" />
      <div className="bureau-soul-motes">
        {Array.from({ length: 18 }, (_, index) => (
          <i
            key={index}
            style={
              {
                "--mote-x": `${(index * 43 + 7) % 100}%`,
                "--mote-y": `${(index * 31 + 11) % 100}%`,
                "--mote-time": `${14 + (index % 7)}s`,
                "--mote-delay": `${-index * 2.7}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}
