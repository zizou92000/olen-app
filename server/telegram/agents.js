// Décisions de l'utilisateur sur les missions d'agents, reçues par Telegram.
// Garde-fous : le webhook a déjà vérifié le secret Telegram ; seul le chat relié par un code à usage unique
// (généré dans l'app, valable 15 min) est écouté ; chaque update n'est traitée qu'une fois ; seule la conversation
// privée compte ; aucun outil MCP ne peut lire ou changer ces réglages.
import { readState, mutateState } from '../mcp/state.js'
import { tg, sendMessage } from './core.js'
import { sendDigest } from '../whatsapp/notify.js'
import { parseOwnerCommand, applyOwnerCommand, codeFromBody } from '../../src/lib/missionCommands.js'

export async function handleTelegramUpdate(update, { db, ownerId, env = process.env, fetchImpl = fetch, now = new Date() }) {
  const deps = { env, fetchImpl }
  const ctx = { db, userId: ownerId, actorLabel: 'Telegram' }
  const cb = update?.callback_query
  const msg = update?.message
  const chat = cb ? cb.message?.chat : msg?.chat
  if (!chat || chat.type !== 'private' || !Number.isFinite(update.update_id)) return 'ignore'
  const text = cb ? '' : String(msg?.text || '')
  const pair = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,32})\s*$/.exec(text)

  const out = await mutateState(ctx, s => {
    const st = s.settings || (s.settings = {})
    if (pair) {
      const p = st.telegramPairing
      if (p?.code === pair[1] && new Date(p.expiresAt) > now) {
        st.telegramChatId = String(chat.id)
        st.telegramPairing = null
        st.telegramLastUpdate = update.update_id
        return { reply: '✅ Relié. Tu recevras ici les propositions de tes agents, avec des boutons pour décider.' }
      }
      return { reply: 'Code invalide ou expiré. Génère-en un nouveau dans Intégrations du Cockpit.' }
    }
    if (String(chat.id) !== String(st.telegramChatId || '')) return { ignore: true }
    if (update.update_id <= (st.telegramLastUpdate || 0)) return { ignore: true }
    st.telegramLastUpdate = update.update_id
    let cmd
    let replyCode = null
    if (cb) {
      const [verb, code] = String(cb.data || '').split(':')
      if (!['oui', 'non', 'tard', 'jamais'].includes(verb)) return { ignore: true }
      cmd = { verb, rest: code || '' }
    } else {
      cmd = parseOwnerCommand(text)
      replyCode = codeFromBody(msg.reply_to_message?.text)
      // Répondre directement à la question d'un agent suffit : pas besoin de taper « REP code ».
      if (!cmd && replyCode && text && !text.startsWith('/')) cmd = { verb: 'rep', rest: `${replyCode} ${text}` }
    }
    if (!cmd) return { other: true }
    return applyOwnerCommand(s, cmd, replyCode, now.toISOString())
  })

  if (out.ignore) return 'ignore'
  try {
    if (cb) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: out.changed ? 'Fait' : 'Déjà traité' }, deps).catch(() => {})
      await tg('editMessageReplyMarkup', { chat_id: chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }, deps).catch(() => {})
    }
    if (out.other) await sendDigest(ctx, (await readState(ctx)).state, { now, all: true, ...deps })
    else await sendMessage(chat.id, out.reply, null, deps)
  } catch (err) {
    console.error('[telegram] réponse impossible :', err.message)
  }
  return pair ? 'appairage' : out.other ? 'recap' : out.changed ? 'applique' : 'sans_effet'
}
