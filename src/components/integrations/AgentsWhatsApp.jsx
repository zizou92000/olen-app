// Réglage « Agents sur WhatsApp » : ton numéro personnel (celui qui reçoit les propositions et y répond)
// et l'état de la liaison Meta. Le numéro vit dans tes réglages privés, jamais dans le code, et aucun agent ne peut le changer.
import { useEffect, useState } from 'react'
import { Check, X, Send, RefreshCw, Copy } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { useAuth } from '@/contexts/AuthContext'
import { useWhatsApp } from '@/contexts/WhatsAppContext'
import { toInternational, normalizePhone, maskPhone } from '@/lib/whatsapp'
import { toast } from '@/lib/toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

function Row({ ok, children }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ background: ok ? 'var(--green-bg)' : 'var(--yellow-bg)', color: ok ? 'var(--green-deep)' : 'var(--yellow-deep)' }}>
        {ok ? <Check size={10} /> : <X size={10} />}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function Secret({ value }) {
  return (
    <span className="mt-1 flex items-center gap-2 rounded-lg bg-[var(--bg-card-soft)] px-2 py-1 font-mono text-[11px]">
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <button type="button" aria-label="Copier" onClick={() => { navigator.clipboard?.writeText(value).then(() => toast.success('Copié'), () => {}) }}><Copy size={11} /></button>
    </span>
  )
}

export default function AgentsWhatsApp() {
  const { state, dispatch } = useStore()
  const { session, user } = useAuth()
  const wa = useWhatsApp()
  const saved = state.settings?.ownerWhatsApp || ''
  const [draft, setDraft] = useState('')
  const [info, setInfo] = useState(null)
  const [testing, setTesting] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!session?.access_token) return
    let cancelled = false
    fetch('/api/whatsapp/status', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json().then(j => (r.ok ? j : { error: j.error || `Erreur ${r.status}` })))
      .catch(() => ({ error: 'Statut indisponible (les fonctions /api ne tournent que sur Vercel).' }))
      .then(j => { if (!cancelled) setInfo(j) })
    return () => { cancelled = true }
  }, [session?.access_token, reload])

  function save(e) {
    e.preventDefault()
    const phone = toInternational(draft)
    if (phone.length < 10 || phone.length > 15) return toast.error('Numéro invalide : écris-le comme 06 12 34 56 78 ou +33 6 12 34 56 78.')
    if (info?.business?.phone && normalizePhone(info.business.phone) === phone) return toast.error("C'est le numéro qui envoie les messages : WhatsApp ne peut pas t'écrire vers lui-même. Mets le numéro du téléphone qui doit les recevoir.")
    dispatch({ type: 'UPDATE_SETTINGS', payload: { ownerWhatsApp: phone } })
    setDraft('')
    toast.success('Numéro enregistré', { description: 'Écris maintenant « bonjour » au numéro du Cockpit depuis ce téléphone.' })
  }

  async function test() {
    setTesting(true)
    try {
      await wa.send(saved, '✅ Test du Cockpit : tu recevras ici les propositions de tes agents. Réponds OUI, NON ou PLUS TARD suivi du code.')
      toast.success('Message envoyé sur ton WhatsApp')
    } catch (err) {
      toast.error(err.message.includes('24 h') ? "Écris d'abord « bonjour » au numéro du Cockpit depuis ton téléphone : WhatsApp exige que tu aies écrit dans les dernières 24 h." : err.message)
    } finally {
      setTesting(false)
    }
  }

  const c = info?.configured || {}
  const sameNumber = saved && info?.business?.phone && normalizePhone(info.business.phone) === saved

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border-medium)] p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Agents sur WhatsApp</p>
        <p className="text-xs text-[var(--text-tertiary)]">Le Cockpit t'écrit quand un agent propose une mission, pose une question ou livre. Tu réponds OUI, NON, PLUS TARD ou JAMAIS suivi du code. Pas de message entre 22 h et 8 h.</p>
      </div>

      {user?.local ? (
        <p className="text-xs text-[var(--yellow-deep)]">Connecte-toi avec ton compte (pas le mode local) pour activer ce réglage.</p>
      ) : (
        <>
          <form onSubmit={save} className="flex flex-wrap items-center gap-2">
            <Input value={draft} onChange={e => setDraft(e.target.value)} placeholder={saved ? `Actuel : ${maskPhone(saved)}` : 'Ton numéro : 06 12 34 56 78'} className="h-9 min-w-0 flex-1" aria-label="Ton numéro WhatsApp personnel" inputMode="tel" />
            <Button type="submit" size="sm" className="h-9" disabled={!draft.trim()}>{saved ? 'Changer' : 'Enregistrer'}</Button>
            {saved && <Button type="button" size="sm" variant="outline" className="h-9" disabled={testing} onClick={test}><Send size={13} /> Tester</Button>}
          </form>

          <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
            <Row ok={!!saved && !sameNumber}>{sameNumber ? 'Ton numéro est le même que celui qui envoie : choisis un autre numéro d’envoi côté Meta.' : saved ? `Messages envoyés à ${maskPhone(saved)}` : 'Numéro qui reçoit les messages : à renseigner'}</Row>
            {info?.error ? (
              <Row ok={false}>{info.error.includes('WHATSAPP_OWNER_EMAIL') ? <>Ajoute <code>WHATSAPP_OWNER_EMAIL</code> = <code>{user?.email}</code> dans Vercel.</> : info.error}</Row>
            ) : info ? (
              <>
                <Row ok={c.token && c.phoneId && !info.graphError}>
                  {info.business ? `Numéro d'envoi Meta : +${info.business.phone}${info.business.name ? ` (${info.business.name})` : ''}` : info.graphError ? `Meta refuse la connexion : ${info.graphError}` : <>Numéro d'envoi Meta : ajoute <code>WHATSAPP_TOKEN</code> et <code>WHATSAPP_PHONE_NUMBER_ID</code> dans Vercel</>}
                </Row>
                <Row ok={c.appSecret}>{c.appSecret ? 'Signature des messages entrants vérifiée' : <>Ajoute <code>WHATSAPP_APP_SECRET</code> dans Vercel (pour lire tes réponses)</>}</Row>
                <Row ok={!!info.verifyToken}>
                  {info.verifyToken ? <>Jeton de vérification du webhook, à coller dans Meta : <Secret value={info.verifyToken} /></> : <>Ajoute <code>WHATSAPP_VERIFY_TOKEN</code> dans Vercel</>}
                </Row>
                <Row ok={c.template}>{c.template ? 'Modèle Meta configuré : tu es prévenu même après 24 h de silence' : 'Sans modèle Meta, tu es prévenu seulement si tu as écrit au Cockpit dans les dernières 24 h'}</Row>
              </>
            ) : <li className="text-[var(--text-tertiary)]">Vérification de la liaison…</li>}
          </ul>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setReload(n => n + 1)}><RefreshCw size={12} /> Revérifier</Button>
        </>
      )}
    </div>
  )
}
