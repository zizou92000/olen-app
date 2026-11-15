// Prévient quand un agent attend une décision : nouvelle proposition, question ou livraison à valider.
// Chaque élément n'est annoncé qu'une fois, même après un rechargement (cockpit:agent-notified).
import { useEffect, useRef } from 'react'
import { useStore } from '@/store/useStore'
import { needsHuman } from '@/lib/missions'
import { playSound, notify } from '@/lib/sound'
import { toast } from '@/lib/toast'

const KEY = 'cockpit:agent-notified'
const TEXT = {
  proposee: m => [`${m.agent} propose une mission`, m.title],
  question: m => [`${m.agent} a une question`, m.question || m.title],
  a_valider: m => [`${m.agent} a livré`, m.title],
}

function readDone() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export default function AgentNotifications({ onNavigate }) {
  const { state } = useStore()
  const go = useRef(onNavigate)
  useEffect(() => { go.current = onNavigate })
  const missions = state.agentMissions
  const sounds = state.settings?.sounds !== false

  useEffect(() => {
    const done = readDone()
    const fresh = needsHuman(missions).filter(m => !done[`${m.id}:${m.status}`])
    if (!fresh.length) return
    for (const m of fresh) {
      done[`${m.id}:${m.status}`] = Date.now()
      const [title, body] = TEXT[m.status](m)
      toast(title, { description: body, duration: 15000, action: { label: 'Voir', onClick: () => go.current('agents') } })
      notify(title, body)
    }
    playSound('bell', sounds)
    const limit = Date.now() - 30 * 86400000
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(done).filter(([, at]) => at >= limit)))) } catch { /* ignore */ }
  }, [missions, sounds])

  return null
}
