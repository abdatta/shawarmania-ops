import { ChevronDown, Laptop } from 'lucide-react'
import { useContext } from 'react'
import { useLocation } from 'react-router'

import { DEMO_SENDER_SCENES, type DemoSenderScene } from '@/data-access/mock/campaigns'

import { DemoSenderContext } from './demo-sender-context'

/**
 * What the demo says the campaign sender is doing
 * (a-campaign-goes-out-on-whatsapp, design D15).
 *
 * The sender is a program on the owner's laptop, and the demo has no laptop.
 * Without this, the Campaigns pages could only ever be seen with the sender
 * online and half-way through a batch, and the states that matter most to get
 * right, offline since yesterday, halted, not linked, could not be looked at.
 *
 * The same pill as the counter's connectivity and the check-in place beside
 * it. **It sends nothing and releases nothing**: it changes what the pages are
 * told the laptop last said, which is all the app ever knows about it.
 *
 * Shown on the Campaigns pages only, and so only to the owner, who alone has
 * them.
 */
const SCENES: Record<DemoSenderScene, string> = {
  sending: 'Sender: sending a batch',
  waiting: 'Sender: batch waiting on the laptop',
  outside_hours: 'Sender: outside sending hours',
  offline: 'Sender: offline since yesterday',
  halted: 'Sender: halted by WhatsApp',
  not_linked: 'Sender: not linked',
}

export function DemoSender() {
  const control = useContext(DemoSenderContext)
  const { pathname } = useLocation()
  if (!control || !/\/campaigns(\/|$)/.test(pathname)) return null
  return (
    <span
      data-testid="demo-sender"
      className="relative flex shrink-0 items-center rounded bg-on-warning/15 has-[:focus-visible]:focus-ring"
    >
      <span
        aria-hidden
        className="flex items-center gap-1 px-1.5 py-1 text-xs font-semibold sm:gap-0.5 sm:px-2"
      >
        <Laptop size={14} className="shrink-0" />
        <span className="hidden sm:inline">{SCENES[control.scene]}</span>
        <ChevronDown size={12} className="hidden sm:inline-block" />
      </span>
      <select
        aria-label="Demo campaign sender"
        value={control.scene}
        onChange={(event) => control.set(event.target.value as DemoSenderScene)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-transparent outline-none"
      >
        {DEMO_SENDER_SCENES.map((scene) => (
          <option key={scene} value={scene} className="bg-surface text-content">
            {SCENES[scene]}
          </option>
        ))}
      </select>
    </span>
  )
}
