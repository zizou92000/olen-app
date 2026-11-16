// État de la liaison WhatsApp pour la page Intégrations : GET avec le jeton de session Supabase.
// Ne renvoie jamais un secret : seulement ce qui est configuré, et le numéro Business (le tien, pas un secret).
import { serviceClient } from '../../server/mcp/auth.js'
import { resolveOwnerId } from '../../server/whatsapp/core.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1]
  if (!token) return res.status(401).json({ error: 'Connexion requise.' })
  try {
    const db = serviceClient()
    const { data: { user } = {}, error } = await db.auth.getUser(token)
    if (error || !user) return res.status(401).json({ error: 'Session invalide : reconnecte-toi.' })
    if (user.id !== await resolveOwnerId(db)) return res.status(403).json({ error: "Ce compte n'est pas relié au numéro WhatsApp." })
    const env = process.env
    const configured = {
      token: !!env.WHATSAPP_TOKEN, phoneId: !!env.WHATSAPP_PHONE_NUMBER_ID, appSecret: !!env.WHATSAPP_APP_SECRET,
      verifyToken: !!env.WHATSAPP_VERIFY_TOKEN, template: !!env.WHATSAPP_TEMPLATE_NOTIFY, cron: !!env.CRON_SECRET,
    }
    let business = null
    let graphError = null
    if (configured.token && configured.phoneId) {
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } })
        const j = await r.json().catch(() => ({}))
        if (r.ok) business = { phone: String(j.display_phone_number || '').replace(/[^\d]/g, ''), name: j.verified_name || null }
        else graphError = j.error?.message || `Meta a répondu ${r.status}.`
      } catch (err) { graphError = err.message }
    }
    // Le jeton de vérification du webhook n'est montré qu'au propriétaire : il le recopie dans Meta (étape Webhook).
    return res.status(200).json({ configured, business, graphError, verifyToken: env.WHATSAPP_VERIFY_TOKEN || null, ownerEmail: env.WHATSAPP_OWNER_EMAIL || null })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}
