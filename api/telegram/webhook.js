// Webhook Telegram : POST avec le secret TELEGRAM_WEBHOOK_SECRET (en-tête X-Telegram-Bot-Api-Secret-Token).
// Répond toujours 200 une fois le secret vérifié : Telegram ne doit pas rejouer une décision.
import { serviceClient } from '../../server/mcp/auth.js'
import { resolveOwnerId } from '../../server/whatsapp/core.js'
import { verifySecret } from '../../server/telegram/core.js'
import { handleTelegramUpdate } from '../../server/telegram/agents.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!verifySecret(req.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_WEBHOOK_SECRET)) return res.status(401).end()
  try {
    const db = serviceClient()
    const ownerId = await resolveOwnerId(db)
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    await handleTelegramUpdate(update, { db, ownerId })
  } catch (err) {
    console.error('[telegram] webhook :', err.message)
  }
  return res.status(200).json({ ok: true })
}
