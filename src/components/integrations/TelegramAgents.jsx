// Telegram : le Cockpit t'écrit quand un agent propose, questionne ou livre, avec des boutons pour décider.
// Le bot ne répond qu'au chat relié par un code à usage unique (15 min) généré ici.
import { useEffect, useState } from 'react'
import { Check, X, Send, RefreshCw, ExternalLink, Copy } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const PAIR_MINUTES = 15

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return [...crypto.getRandomValues(new Uint8Array(10))].map(n => alphabet[n % alphabet.length]).join('')
}

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

export default function TelegramAgents() {
  const { state, dispatch } = useStore()
  const { session, user } = useAuth()
  const chatId = state.settings?.telegramChatId
  const pairing = state.settings?.telegramPairing
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const token = session?.access_token

  async function call(method, body) {
    const res = await fetch('/api/telegram/setup', { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`)
    return json
  }

  useEffect(() => {
    if (!token) return
    let cancelled = false
    call('GET').catch(err => ({ error: err.message })).then(j => { if (!cancelled) setInfo(j) })
    return () => { cancelled = true }
  }, [token, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  // Une fois relié, le code à usage unique n'a plus lieu d'être.
  useEffect(() => { if (chatId && pairing) dispatch({ type: 'UPDATE_SETTINGS', payload: { telegramPairing: null } }) }, [chatId, pairing, dispatch])

  async function act(action, okMessage) {
    setBusy(true)
    try { setInfo(await call('POST', { action })); toast.success(okMessage) } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  function startPairing() {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { telegramPairing: { code: randomCode(), expiresAt: new Date(Date.now() + PAIR_MINUTES * 60000).toISOString() } } })
  }

  const c = info?.configured || {}
  const connected = !!info?.webhook?.url
  const live = pairing && new Date(pairing.expiresAt) > new Date()
  const link = live && info?.bot ? `https://t.me/${info.bot.username}?start=${pairing.code}` : null

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: '#229ED922', color: '#229ED9' }}><Send size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[var(--text-primary)]">Telegram · agents</p>
          <p className="text-xs text-[var(--text-tertiary)]">Tes agents te proposent une mission avec des boutons [Oui] [Non] [Plus tard] [Jamais]. Réponds directement à une question pour y répondre. Pas de message entre 22 h et 8 h.</p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={chatId ? { background: 'var(--green-bg)', color: 'var(--green-deep)' } : { background: 'var(--yellow-bg)', color: 'var(--yellow-deep)' }}>{chatId ? 'Relié' : 'À configurer'}</span>
      </div>

      {user?.local ? (
        <p className="text-xs text-[var(--yellow-deep)]">Connecte-toi avec ton compte (pas le mode local) pour activer Telegram.</p>
      ) : (
        <>
          <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
            {info?.error ? <Row ok={false}>{info.error}</Row> : !info ? <li className="text-[var(--text-tertiary)]">Vérification…</li> : (
              <>
                <Row ok={c.token}>{c.token ? `Bot Telegram : @${info.bot?.username}` : <>Crée un bot avec <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> (<code>/newbot</code>), puis ajoute son jeton dans Vercel : <code>TELEGRAM_BOT_TOKEN</code>.</>}</Row>
                {c.token && <Row ok={c.secret}>{c.secret ? 'Secret du webhook configuré' : <>Ajoute <code>TELEGRAM_WEBHOOK_SECRET</code> dans Vercel.</>}</Row>}
                {c.token && c.secret && <Row ok={connected && !info.webhook.lastError}>{connected ? (info.webhook.lastError ? `Webhook en erreur : ${info.webhook.lastError}` : 'Webhook connecté') : 'Webhook pas encore connecté'}</Row>}
                <Row ok={!!chatId}>{chatId ? 'Ton Telegram est relié' : 'Ton Telegram n’est pas encore relié'}</Row>
              </>
            )}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            {c.token && c.secret && !connected && <Button size="sm" disabled={busy} onClick={() => act('connect', 'Webhook connecté')}>Connecter le bot</Button>}
            {c.token && connected && !live && <Button size="sm" variant={chatId ? 'outline' : 'default'} onClick={startPairing}>{chatId ? 'Relier un autre Telegram' : 'Relier mon Telegram'}</Button>}
            {chatId && <Button size="sm" variant="outline" disabled={busy} onClick={() => act('test', 'Message de test envoyé sur Telegram')}><Send size={13} /> Tester</Button>}
            <Button size="sm" variant="ghost" className="px-2" aria-label="Revérifier" onClick={() => setReload(n => n + 1)}><RefreshCw size={13} /></Button>
          </div>

          {link && (
            <div className="space-y-2 rounded-xl bg-[var(--bg-card-soft)] p-3 text-xs text-[var(--text-secondary)]">
              <p>Ouvre ce lien depuis ton téléphone (ou ton ordinateur) et appuie sur <b>Démarrer</b>. Valable {PAIR_MINUTES} minutes, une seule fois.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" asChild><a href={link} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ouvrir Telegram</a></Button>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(link).then(() => toast.success('Lien copié'), () => {}) }}><Copy size={13} /> Copier le lien</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
