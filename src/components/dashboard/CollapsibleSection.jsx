import React, { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export default function CollapsibleSection({
  title,
  storageKey,
  defaultCollapsed = false,
  children,
}) {
  const contentId = useId()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = storageKey && localStorage.getItem('section:' + storageKey)
      return saved === 'closed' || (saved !== 'open' && defaultCollapsed)
    } catch {
      return defaultCollapsed
    }
  })
  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    try {
      if (storageKey) localStorage.setItem('section:' + storageKey, next ? 'closed' : 'open')
    } catch {
      /* Storage may be unavailable. */
    }
  }
  const Icon = collapsed ? ChevronRight : ChevronDown
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-4" aria-label={title}>
      <h2 className="text-sm font-semibold text-white">
        {storageKey ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            className="flex w-full items-center gap-2 rounded text-left hover:text-green-300"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
      <div id={contentId} hidden={collapsed} className="space-y-4 pt-4">
        {children}
      </div>
    </section>
  )
}
