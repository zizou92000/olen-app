// Logique WhatsApp partagée entre le navigateur et le serveur (sans dépendance Node).

// WhatsApp n'autorise un message libre que dans les 24 h qui suivent le dernier message du client.
export const WINDOW_MS = 24 * 3600 * 1000

export function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '').replace(/^00/, '')
}

// Numéro saisi par l'utilisateur -> format international sans « + » (06 12 34 56 78 devient 33612345678).
export function toInternational(input, countryCode = '33') {
  const digits = String(input || '').replace(/[^\d]/g, '')
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('0') && digits.length === 10) return countryCode + digits.slice(1)
  return digits
}

// +33 6 •• •• •• 88 : pour afficher un numéro sans l'exposer en entier.
export function maskPhone(phone) {
  const p = normalizePhone(phone)
  return p.length < 6 ? '' : `+${p.slice(0, 2)} ${p.slice(2, 3)} •• •• •• ${p.slice(-2)}`
}

// Conversations : dernier message, nombre de non lus et ouverture de la fenêtre de 24 h.
export function summarizeConversations(rows, now = new Date()) {
  const byPhone = new Map()
  for (const m of [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
    const c = byPhone.get(m.contact_phone) || { contact_phone: m.contact_phone, contact_name: null, last: m, unread: 0, lastInboundAt: null }
    if (!c.contact_name && m.contact_name) c.contact_name = m.contact_name
    if (m.direction === 'in') {
      if (!m.read_at) c.unread++
      if (!c.lastInboundAt) c.lastInboundAt = m.created_at
    }
    byPhone.set(m.contact_phone, c)
  }
  return [...byPhone.values()].map(c => ({
    ...c,
    windowOpen: !!c.lastInboundAt && now - new Date(c.lastInboundAt) < WINDOW_MS,
  }))
}
