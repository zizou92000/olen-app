// Réglage du bot Telegram depuis la page Intégrations (jeton de session Supabase, compte propriétaire uniquement).
//   GET  → état : jeton et secret configurés, nom du bot, webhook enregistré
//   POST { action: 'connect' } → enregistre le webhook auprès de Telegram
//   POST { action: 'test' }    → envoie un message de test au chat relié
import { serviceClient } from '../../server/mcp/auth.js'
import { resolveOwnerId } from '../../server/whatsapp/core.js'
import { readState } from '../../server/mcp/state.js'
import { tg, sendMessage } from '../../server/telegram/core.js'

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).end()
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1]
  if (!token) return res.status(401).json({ error: 'Connexion requise.' })
  try {
    const db = serviceClient()
    const { data: { user } = {}, error } = await db.auth.getUser(token)
    if (error || !user) return res.status(401).json({ error: 'Session invalide : reconnecte-toi.' })
    const ownerId = await resolveOwnerId(db)
    if (user.id !== ownerId) return res.status(403).json({ error: "Ce compte n'est pas le propriétaire du Cockpit." })
    const env = process.env
    const configured = { token: !!env.TELEGRAM_BOT_TOKEN, secret: !!env.TELEGRAM_WEBHOOK_SECRET }
    if (!configured.token) return res.status(200).json({ configured, bot: null, webhook: null })

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
      if (body.action === 'connect') {
        if (!configured.secret) throw new Error('TELEGRAM_WEBHOOK_SECRET doit être défini.')
        const host = req.headers['x-forwarded-host'] || req.headers.host
        await tg('setWebhook', { url: `https://${host}/api/telegram/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true })
      } else if (body.action === 'test') {
        const chatId = (await readState({ db, userId: ownerId })).state.settings?.telegramChatId
        if (!chatId) throw new Error("Aucun Telegram relié : génère d'abord un code.")
        await sendMessage(chatId, '✅ Test du Cockpit : tu recevras ici les propositions de tes agents.')
      } else {
        throw new Error('Action inconnue.')
      }
    }
    const [me, info] = await Promise.all([tg('getMe'), tg('getWebhookInfo')])
    return res.status(200).json({
      configured,
      bot: { username: me.username, name: me.first_name },
      webhook: { url: info.url || null, pending: info.pending_update_count || 0, lastError: info.last_error_message || null },
    })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}
