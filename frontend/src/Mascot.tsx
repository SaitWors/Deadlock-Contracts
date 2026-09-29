import { useState } from "react"
import { useLanguage } from "./i18n"
import { useAppearance } from "./Appearance"
import { prefersReducedMotion } from "./motion"
import idle from "./imports/nightshift/mascot-idle.webp"
import welcome from "./imports/nightshift/mascot-welcome.webp"
import dossier from "./imports/nightshift/mascot-dossier.webp"

const poses = ["idle", "welcome", "dossier"] as const
type Pose = (typeof poses)[number]
const images = { idle, welcome, dossier }
export default function Mascot({
  initialPose = "idle",
  className = "",
  priority = false,
}: {
  initialPose?: Pose
  className?: string
  priority?: boolean
}) {
  const { language } = useLanguage(),
    ru = language === "ru"
  const { appearance } = useAppearance()
  const [pose, setPose] = useState<Pose>(initialPose),
    [hovered, setHovered] = useState(false)
  const shown = hovered && pose === "idle" ? "welcome" : pose
  const labels = ru
    ? { idle: "На связи", welcome: "Добро пожаловать", dossier: "За работой" }
    : { idle: "At your service", welcome: "Welcome aboard", dossier: "On the case" }
  return (
    <figure className={`ns-mascot ${className}`} data-pose={shown}>
      <button
        type="button"
        className="ns-mascot-button"
        aria-label={
          ru ? `Маскот: ${labels[shown]}. Сменить позу` : `Mascot: ${labels[shown]}. Change pose`
        }
        onClick={() => {
          setHovered(false)
          setPose(poses[(poses.indexOf(pose) + 1) % poses.length])
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse" && appearance.motion && !prefersReducedMotion())
            setHovered(true)
        }}
        onPointerLeave={() => setHovered(false)}
      >
        {poses.map((p) => (
          <img
            key={p}
            data-pose={p}
            src={images[p]}
            alt=""
            aria-hidden="true"
            width="1024"
            height="1536"
            loading={priority && p === initialPose ? "eager" : "lazy"}
            fetchPriority={priority && p === initialPose ? "high" : "auto"}
            draggable="false"
          />
        ))}
      </button>
      <figcaption>
        <span className="ns-mascot-status">{labels[shown]}</span>
        <div
          className="ns-pose-dots"
          role="group"
          aria-label={ru ? "Позы маскота" : "Mascot poses"}
        >
          {poses.map((p) => (
            <button
              key={p}
              type="button"
              aria-label={labels[p]}
              aria-pressed={pose === p}
              onClick={() => {
                setHovered(false)
                setPose(p)
              }}
            />
          ))}
        </div>
      </figcaption>
    </figure>
  )
}
