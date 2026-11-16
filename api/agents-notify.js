// Cron Vercel quotidien : récapitulatif WhatsApp des décisions d'agents pas encore annoncées (nuit, fenêtre fermée…).
// Protégé par CRON_SECRET (Vercel envoie « Authorization: Bearer <CRON_SECRET> »).
import { serviceClient } from '../server/mcp/auth.js'
import { resolveOwnerId } from '../server/whatsapp/core.js'
import { readState } from '../server/mcp/state.js'
import { sendDigest } from '../server/whatsapp/notify.js'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Non autorisé.' })
  try {
    const db = serviceClient()
    const userId = await resolveOwnerId(db)
    const ctx = { db, userId, actorLabel: 'Cron' }
    const { state } = await readState(ctx)
    return res.status(200).json(await sendDigest(ctx, state))
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
