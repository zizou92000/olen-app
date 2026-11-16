// Telegram (API Bot) : envoi de messages avec boutons, vérification du secret du webhook.
// Pas de fenêtre de 24 h ni de modèle à faire valider, contrairement à WhatsApp.
import { timingSafeEqual } from 'node:crypto'
import { missionCode } from '../../src/lib/missionCommands.js'

const API = 'https://api.telegram.org'

// Telegram renvoie ce secret dans l'en-tête X-Telegram-Bot-Api-Secret-Token de chaque appel du webhook.
export function verifySecret(header, secret) {
  if (!secret || !header) return false
  const a = Buffer.from(String(header))
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function tg(method, body, { env = process.env, fetchImpl = fetch } = {}) {
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN doit être défini.')
  let res
  try {
    res = await fetchImpl(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  } catch (err) {
    // Pas de `cause` : l'erreur d'origine pourrait contenir l'adresse de l'appel, donc le jeton.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(String(err.message).replaceAll(token, '***'))
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new Error(String(json.description || `Telegram a répondu ${res.status}.`).replaceAll(token, '***'))
  return json.result
}

export const sendMessage = (chatId, text, keyboard, deps) =>
  tg('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), link_preview_options: { is_disabled: true }, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) }, deps)

// Boutons d'une proposition : le code de la mission est dans callback_data (64 octets au plus).
export function keyboardFor(mission) {
  if (mission?.status !== 'proposee') return null
  const c = missionCode(mission.id)
  return [
    [{ text: '✅ Oui', callback_data: `oui:${c}` }, { text: '❌ Non', callback_data: `non:${c}` }],
    [{ text: '⏰ Plus tard', callback_data: `tard:${c}` }, { text: '🚫 Jamais', callback_data: `jamais:${c}` }],
  ]
}
