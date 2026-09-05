import type { Announcement } from "./announcement-types"
import AnnouncementContent from "./AnnouncementContent"

export default function AnnouncementBanner({
  item,
  serverNow,
  onDismiss,
  onAcknowledge,
}: {
  item: Announcement
  serverNow: () => number
  onDismiss: () => void
  onAcknowledge: () => void
}) {
  return (
    <div className="dc-announcement-banner">
      <AnnouncementContent
        item={item}
        serverNow={serverNow}
        onDismiss={onDismiss}
        onAcknowledge={onAcknowledge}
      />
    </div>
  )
}
