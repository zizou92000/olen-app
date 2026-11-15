// Liens d'un dossier client (site, dépôt, préversion…) et contexte du dossier.
// Ce sont ces liens que les agents lisent pour travailler sur le projet du client.
import { useState } from 'react'
import { ExternalLink, Globe, GitBranch, Plus, X, Link2, Bot } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { CLIENT_LINK_KINDS, cleanUrl } from '@/lib/missions'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'

const ICONS = { site: Globe, depot: GitBranch }

function host(url) {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return url }
}

export default function ClientLinks({ client }) {
  const { dispatch } = useStore()
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState('site')
  const [url, setUrl] = useState('')
  const [showBrief, setShowBrief] = useState(false)
  const links = client.links || []

  const save = next => dispatch({ type: 'UPDATE_CLIENT', payload: { id: client.id, links: next } })

  function add(e) {
    e.preventDefault()
    const raw = url.trim()
    const clean = cleanUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!clean) return toast.error('Lien invalide : colle une adresse complète (https://…).')
    if (links.some(l => l.url === clean)) return toast.error('Ce lien est déjà dans le dossier.')
    save([...links, { kind, label: null, url: clean }])
    setUrl('')
    setAdding(false)
  }

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {links.map(l => {
          const Icon = ICONS[l.kind] || Link2
          return (
            <span key={l.url} className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-medium)] bg-[var(--bg-card)] py-1 pl-2.5 pr-1 text-xs">
              <Icon size={12} className="shrink-0 text-[var(--text-tertiary)]" />
              <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-[var(--text-primary)] hover:underline" title={l.url}>
                {l.label || CLIENT_LINK_KINDS[l.kind] || 'Lien'} · {host(l.url)}
              </a>
              <ExternalLink size={10} className="shrink-0 text-[var(--text-tertiary)]" />
              <button type="button" aria-label={`Retirer le lien ${host(l.url)}`} onClick={() => save(links.filter(x => x.url !== l.url))}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[rgba(var(--ink),0.08)] hover:text-[var(--red-deep)]">
                <X size={11} />
              </button>
            </span>
          )
        })}
        {!adding && (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 rounded-full border border-dashed border-[var(--border-strong)] px-2.5 text-xs text-[var(--text-secondary)]" onClick={() => setAdding(true)}>
            <Plus size={12} /> {links.length ? 'Lien' : 'Ajouter le site ou le dépôt'}
          </Button>
        )}
        {client.brief && (
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-2.5 text-xs text-[var(--text-secondary)]" onClick={() => setShowBrief(v => !v)}>
            {showBrief ? 'Masquer le contexte' : 'Voir le contexte'}
          </Button>
        )}
      </div>

      {adding && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <NativeSelect value={kind} onChange={e => setKind(e.target.value)} className="h-9 w-32" aria-label="Type de lien">
            {Object.entries(CLIENT_LINK_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
          <Input autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="h-9 min-w-0 flex-1" aria-label="Adresse du lien" />
          <Button type="submit" size="sm" className="h-9">Ajouter</Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setAdding(false); setUrl('') }}>Annuler</Button>
        </form>
      )}

      {showBrief && client.brief && (
        <div className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-card)] p-3">
          {client.createdBy && (
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-tertiary)]">
              <Bot size={12} /> Contexte rédigé par {client.createdBy} : à relire, certains points restent à confirmer.
            </p>
          )}
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-secondary)]">{client.brief}</p>
        </div>
      )}
    </div>
  )
}
