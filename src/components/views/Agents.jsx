// Page « Agents » : ce que les agents (OpenClaw, Uly…) proposent, font et livrent.
// Tout ce qui demande une décision est en haut. Rien ne démarre sans un « Oui » donné ici.
import { useMemo, useState } from 'react'
import { Bot, Check, X, Clock, Ban, MessageCircleQuestion, PackageCheck, RotateCcw, Play, ExternalLink, ChevronDown, FileText, Hourglass } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { MISSION_TYPES, MISSION_STATUS, applyTransition, isSnoozed, needsHuman } from '@/lib/missions'
import { timeAgo } from '@/lib/priorities'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/ui/empty-state'

const TITLE = 'text-[34px] font-semibold leading-tight tracking-tight text-[var(--text-primary)]'
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]'
const ME = 'me'

const TONES = {
  proposee: { bg: 'var(--brand-100)', color: 'var(--accent)' },
  question: { bg: 'var(--yellow-bg, rgba(255,214,107,0.25))', color: 'var(--yellow-deep)' },
  a_valider: { bg: 'var(--green-bg)', color: 'var(--green-deep)' },
  approuvee: { bg: 'rgba(var(--ink),0.06)', color: 'var(--text-secondary)' },
  en_cours: { bg: 'var(--brand-100)', color: 'var(--accent)' },
  terminee: { bg: 'var(--green-bg)', color: 'var(--green-deep)' },
  refusee: { bg: 'rgba(var(--ink),0.06)', color: 'var(--text-tertiary)' },
  echec: { bg: 'rgba(255,90,90,0.12)', color: 'var(--red-deep)' },
}

function Pill({ status, children }) {
  const tone = TONES[status] || TONES.approuvee
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: tone.bg, color: tone.color }}>{children}</span>
}

function Block({ label, children }) {
  if (!children) return null
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">{children}</div>
    </div>
  )
}

function useMissionActions() {
  const { state, dispatch } = useStore()
  const patch = (id, next) => dispatch({ type: 'UPDATE_ENTITY', payload: { collection: 'agentMissions', id, patch: next } })
  function run(mission, action, text = '') {
    try {
      patch(mission.id, applyTransition(mission, action, { actor: ME, text }))
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }
  return {
    approve: (m, note) => run(m, 'approuver', note) && toast.success('Mission approuvée', { description: `${m.agent} la démarrera à son prochain passage.` }),
    refuse: (m, note) => run(m, 'refuser', note) && toast('Mission refusée'),
    never: m => {
      if (!run(m, 'refuser', 'Ne plus proposer cette tâche.')) return
      if (m.taskId) dispatch({ type: 'UPDATE_TASK', payload: { id: m.taskId, agentOptOut: true } })
      toast('Compris', { description: 'Cette tâche ne sera plus proposée par un agent.' })
    },
    later: m => {
      const until = new Date(Date.now() + 3 * 86400000).toISOString()
      patch(m.id, { snoozeUntil: until })
      toast('Reportée de 3 jours')
    },
    answer: (m, text) => run(m, 'repondre', text) && toast.success('Réponse transmise'),
    validate: (m, closeTask) => {
      if (!run(m, 'valider')) return
      const task = state.tasks.find(t => t.id === m.taskId)
      if (closeTask && task && task.status !== 'done') {
        dispatch({ type: 'UPDATE_TASK', payload: { id: task.id, status: 'done', completedAt: new Date().toISOString(), completedBy: m.agent } })
      }
      toast.success('Livraison validée')
    },
    rework: (m, text) => run(m, 'corriger', text) && toast('Corrections demandées', { description: `${m.agent} reprendra la mission avec tes remarques.` }),
  }
}

function MissionCard({ mission, actions }) {
  const { state } = useStore()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(['proposee', 'question', 'a_valider'].includes(mission.status))
  const [closeTask, setCloseTask] = useState(true)
  const task = state.tasks.find(t => t.id === mission.taskId)
  const client = state.clients.find(c => c.id === mission.clientId)
  const project = state.projects.find(p => p.id === mission.projectId)
  const result = mission.result
  const snoozed = isSnoozed(mission)

  return (
    <Card className="p-5">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--brand-100)', color: 'var(--accent)' }}><Bot size={17} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Pill status={mission.status}>{snoozed ? 'Reportée' : MISSION_STATUS[mission.status]}</Pill>
            <span className="text-[11px] font-medium text-[var(--text-tertiary)]">{MISSION_TYPES[mission.type] || mission.type} · {mission.agent} · {timeAgo(new Date(mission.updatedAt || mission.createdAt).getTime())}</span>
          </span>
          <span className="mt-1 block text-[15px] font-semibold leading-snug text-[var(--text-primary)]">{mission.title}</span>
          <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">
            {[client?.name, project && `${project.emoji || ''} ${project.name}`.trim(), task && `Tâche : ${task.title}`].filter(Boolean).join(' · ') || 'Sans dossier rattaché'}
          </span>
        </span>
        <ChevronDown size={16} className={`mt-1 shrink-0 text-[var(--text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-[var(--border-medium)] pt-4">
          {mission.status === 'question' && (
            <div className="rounded-xl p-3" style={{ background: TONES.question.bg }}>
              <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: TONES.question.color }}><MessageCircleQuestion size={13} /> {mission.agent} a besoin d'une réponse</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-primary)]">{mission.question}</p>
            </div>
          )}

          {result && (
            <div className="space-y-3 rounded-xl border border-[var(--border-medium)] p-3">
              <Block label="Résultat">{result.summary}</Block>
              {(result.files?.length > 0 || result.links?.length > 0) && (
                <div>
                  <p className={LABEL}>Livrables</p>
                  <ul className="mt-1 space-y-1">
                    {(result.links || []).map(l => (
                      <li key={l}><a href={l} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:underline"><ExternalLink size={12} className="shrink-0" /><span className="truncate">{l}</span></a></li>
                    ))}
                    {(result.files || []).map(f => (
                      <li key={f} className="flex items-center gap-1.5 font-mono text-xs text-[var(--text-secondary)]"><FileText size={12} className="shrink-0" /><span className="break-all">{f}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              <Block label="Preuves et contrôles">{result.evidence}</Block>
              <Block label="Non vérifié ou incertain">{result.limits}</Block>
            </div>
          )}

          <Block label="Ce que l'agent fera">{mission.plan}</Block>
          <Block label="Ce que tu recevras">{mission.deliverable}</Block>
          {mission.missing?.length > 0 && (
            <div>
              <p className={LABEL}>Il lui manque</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--text-secondary)]">{mission.missing.map(x => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          <Block label="Ce qu'il ne fera pas">{mission.limits}</Block>
          {mission.feedback && mission.status !== 'terminee' && <Block label="Tes corrections">{mission.feedback}</Block>}
          {mission.decision?.note && <Block label="Ta note">{mission.decision.note}</Block>}

          {mission.status === 'proposee' && (
            <div className="space-y-2">
              <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Précision ou raison du refus (facultatif)" aria-label="Note pour l'agent" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => actions.approve(mission, text.trim())}><Check size={14} /> Oui, vas-y</Button>
                <Button size="sm" variant="outline" onClick={() => actions.refuse(mission, text)}><X size={14} /> Non</Button>
                <Button size="sm" variant="ghost" onClick={() => actions.later(mission)}><Clock size={14} /> Plus tard</Button>
                {mission.taskId && <Button size="sm" variant="ghost" onClick={() => actions.never(mission)}><Ban size={14} /> Jamais pour cette tâche</Button>}
              </div>
            </div>
          )}

          {mission.status === 'question' && (
            <div className="space-y-2">
              <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Ta réponse" aria-label="Réponse à l'agent" />
              <Button size="sm" disabled={!text.trim()} onClick={() => actions.answer(mission, text.trim())}><Check size={14} /> Envoyer la réponse</Button>
            </div>
          )}

          {mission.status === 'a_valider' && (
            <div className="space-y-2">
              {task && task.status !== 'done' && (
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input type="checkbox" checked={closeTask} onChange={e => setCloseTask(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                  Terminer aussi la tâche « {task.title} »
                </label>
              )}
              <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Corrections à apporter (si tu en demandes)" aria-label="Corrections" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => actions.validate(mission, closeTask)}><PackageCheck size={14} /> Valider la livraison</Button>
                <Button size="sm" variant="outline" disabled={!text.trim()} onClick={() => actions.rework(mission, text.trim())}><RotateCcw size={14} /> Demander des corrections</Button>
              </div>
            </div>
          )}

          {mission.status === 'approuvee' && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]"><Hourglass size={14} /> En attente du prochain passage de {mission.agent}.</p>
              <Button size="sm" variant="ghost" onClick={() => actions.refuse(mission, 'Accord retiré avant le démarrage.')}><X size={14} /> Retirer mon accord</Button>
            </div>
          )}

          {mission.events?.length > 0 && (
            <details className="text-xs text-[var(--text-tertiary)]">
              <summary className="cursor-pointer select-none font-medium">Historique ({mission.events.length})</summary>
              <ul className="mt-2 space-y-1">
                {mission.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex gap-2">
                    <span className="shrink-0 font-mono">{new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="min-w-0 break-words"><span className="font-semibold">{e.actor === ME ? 'Toi' : e.actor}</span> · {e.type}{e.text ? ` : ${e.text}` : ''}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  )
}

function Section({ title, hint, missions, actions }) {
  if (!missions.length) return null
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title} <span className="text-[var(--text-tertiary)]">{missions.length}</span></h2>
        {hint && <p className="text-sm text-[var(--text-tertiary)]">{hint}</p>}
      </div>
      {missions.map(m => <MissionCard key={m.id} mission={m} actions={actions} />)}
    </section>
  )
}

export default function Agents({ onNavigate }) {
  const { state } = useStore()
  const actions = useMissionActions()
  const groups = useMemo(() => {
    const all = [...(state.agentMissions || [])].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    const todo = needsHuman(all)
    const todoIds = new Set(todo.map(m => m.id))
    return {
      todo,
      running: all.filter(m => ['approuvee', 'en_cours'].includes(m.status)),
      snoozed: all.filter(m => m.status === 'proposee' && !todoIds.has(m.id)),
      done: all.filter(m => ['terminee', 'refusee', 'echec'].includes(m.status)).slice(0, 30),
      total: all.length,
    }
  }, [state.agentMissions])

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={TITLE}>Agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            Les agents lisent tes tâches et tes dossiers clients, puis proposent de s'en charger. Rien ne démarre sans ton accord, et chaque livraison reste un brouillon jusqu'à ta validation.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" onClick={() => onNavigate('integrations')}><Play size={13} /> Connexion des agents</Button>
          <span className="text-[11px] text-[var(--text-tertiary)]">{state.settings?.telegramChatId ? 'Prévenu sur Telegram' : state.settings?.ownerWhatsApp ? 'Prévenu sur WhatsApp' : 'Pas encore prévenu sur ton téléphone'}</span>
        </div>
      </header>

      {groups.total === 0 && (
        <EmptyState
          icon={Bot}
          title="Aucune mission pour l'instant"
          description="Quand un agent connecté au Cockpit proposera de prendre une tâche, sa proposition apparaîtra ici avec son plan, son livrable et ce qu'il lui manque."
        />
      )}

      <Section title="À décider" hint="Propositions, questions et livraisons qui attendent ta réponse." missions={groups.todo} actions={actions} />
      <Section title="En cours" hint="Missions approuvées : en attente de démarrage ou en train d'être réalisées." missions={groups.running} actions={actions} />
      <Section title="Reportées" missions={groups.snoozed} actions={actions} />
      <Section title="Historique" missions={groups.done} actions={actions} />
    </div>
  )
}
