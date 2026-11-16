// Prévenir l'utilisateur sur WhatsApp quand une mission d'agent attend une décision de sa part.
// Ce sont ces fonctions du Cockpit qui écrivent, jamais les agents : ils n'ont aucun outil de messagerie.
// Le texte n'embarque que le titre, le dossier et le type (nettoyés, sans lien) : aucun contenu libre d'un agent.
import { sendText, sendTemplate, normalizePhone } from './core.js'
import { mutateState } from '../mcp/state.js'
import { sendMessage as sendTelegram, keyboardFor } from '../telegram/core.js'
import { missionCode } from '../../src/lib/missionCommands.js'
import { MISSION_TYPES, needsHuman } from '../../src/lib/missions.js'

export const NOTIFY_STATUS = ['proposee', 'question', 'a_valider', 'echec']
const QUIET_FROM = 22
const QUIET_TO = 8

// Pas de message la nuit (heure de Paris) : l'élément attend le point du matin (/api/agents-notify).
export function isQuietHour(now = new Date()) {
  const h = parseInt(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(now), 10)
  return h >= QUIET_FROM || h < QUIET_TO
}

const clip = (s, n) => String(s || '').replace(/https?:\/\/\S+/gi, '[lien]').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n)

export function notificationText(mission, clientName = null) {
  const code = missionCode(mission.id)
  const title = clip(mission.title, 120)
  const agent = clip(mission.agent, 30) || 'Un agent'
  const where = clientName ? `\nDossier : ${clip(clientName, 60)}` : ''
  switch (mission.status) {
    case 'proposee':
      return `🤖 ${agent} propose : ${title}${where}\nType : ${MISSION_TYPES[mission.type] || 'Autre'}\n\nRéponds OUI ${code}, NON ${code}, PLUS TARD ${code} ou JAMAIS ${code}.\nDétails dans la page Agents du Cockpit. (réf. ${code})`
    case 'question':
      return `❓ ${agent} a une question sur « ${title} »${where}\n\n${clip(mission.question, 300)}\n\nRéponds : REP ${code} puis ta réponse. (réf. ${code})`
    case 'a_valider':
      return `📦 ${agent} a livré : ${title}${where}\n\nÀ relire et valider dans la page Agents du Cockpit. (réf. ${code})`
    default:
      return `⚠️ Mission en échec : ${title}${where}\n\n${clip(mission.events?.at(-1)?.text, 200)}\nDétails dans la page Agents du Cockpit. (réf. ${code})`
  }
}

const oneLine = text => text.replace(/\n+/g, ' · ')

// Envoie à l'utilisateur : texte libre si la fenêtre de 24 h est ouverte, sinon modèle Meta s'il est configuré.
// Renvoie un statut : envoyee | modele | hors_fenetre | heures_calmes | non_configuree | erreur.
export async function deliverToOwner({ db, userId, ownerPhone, telegramChatId = null, buttons = null, text, line = oneLine(text), ignoreQuiet = false, now = new Date(), env = process.env, fetchImpl = fetch }) {
  const to = normalizePhone(ownerPhone)
  const telegramOk = !!(telegramChatId && env.TELEGRAM_BOT_TOKEN)
  const whatsappOk = !!(to && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID)
  if (!telegramOk && !whatsappOk) return 'non_configuree'
  if (!ignoreQuiet && isQuietHour(now)) return 'heures_calmes'
  // Telegram d'abord (boutons, pas de fenêtre de 24 h) ; WhatsApp en secours.
  if (telegramOk) {
    try {
      await sendTelegram(telegramChatId, text, buttons, { env, fetchImpl })
      return 'envoyee'
    } catch (err) {
      console.error('[telegram] notification impossible :', err.message)
      if (!whatsappOk) return 'erreur'
    }
  }
  const base = { db, userId, to, via: 'cockpit-agents', now, env, fetchImpl }
  try {
    await sendText({ ...base, text })
    return 'envoyee'
  } catch (err) {
    if (err.code !== 'WINDOW_CLOSED') { console.error('[whatsapp] notification impossible :', err.message); return 'erreur' }
  }
  if (!env.WHATSAPP_TEMPLATE_NOTIFY) return 'hors_fenetre'
  try {
    // WHATSAPP_TEMPLATE_PARAMS=0 : modèle sans paramètre (ex. « hello_world » du numéro de test), qui sert juste à te faire répondre.
    const params = env.WHATSAPP_TEMPLATE_PARAMS === '0' ? [] : [line]
    await sendTemplate({ ...base, name: env.WHATSAPP_TEMPLATE_NOTIFY, lang: env.WHATSAPP_TEMPLATE_LANG || 'fr', params, logBody: line })
    return 'modele'
  } catch (err) {
    console.error('[whatsapp] modèle impossible :', err.message)
    return 'erreur'
  }
}

async function markNotified(ctx, items, status, now) {
  await mutateState(ctx, s => {
    for (const it of items) {
      const m = (s.agentMissions || []).find(x => x.id === it.id)
      if (m) m.notified = { status: it.status, at: now.toISOString(), via: status }
    }
  }).catch(err => console.error('[whatsapp] suivi des notifications :', err.message))
}

// Appelé après chaque écriture d'un agent sur une mission. Ne lève jamais : le résultat est un simple statut.
export async function notifyMission(ctx, snap, opts = {}) {
  try {
    const m = snap?.mission
    if (!m || !NOTIFY_STATUS.includes(m.status)) return 'sans_objet'
    const now = opts.now || new Date()
    const status = await deliverToOwner({ db: ctx.db, userId: ctx.userId, ownerPhone: snap.ownerPhone, telegramChatId: snap.telegramChatId, buttons: keyboardFor(m), text: notificationText(m, snap.client), now, ...opts })
    if (status === 'envoyee' || status === 'modele') await markNotified(ctx, [m], status, now)
    return status
  } catch (err) {
    console.error('[whatsapp] notifyMission :', err.message)
    return 'erreur'
  }
}

// Récapitulatif des décisions pas encore annoncées (point du matin, ou heures calmes terminées).
// all = true : tout ce qui attend (réponse à un « bonjour » de l'utilisateur), même déjà annoncé.
export async function sendDigest(ctx, state, { now = new Date(), all = false, ...opts } = {}) {
  const ownerPhone = state.settings?.ownerWhatsApp
  const telegramChatId = state.settings?.telegramChatId || null
  if (!ownerPhone && !telegramChatId) return { skipped: 'ni Telegram ni WhatsApp relié dans Intégrations' }
  const todo = needsHuman(state.agentMissions, now.toISOString()).filter(m => all || m.notified?.status !== m.status)
  if (!todo.length) {
    if (!all) return { skipped: 'rien de nouveau à signaler' }
    return { status: await deliverToOwner({ db: ctx.db, userId: ctx.userId, ownerPhone, telegramChatId, text: "✅ Le Cockpit est bien relié. Aucune décision d'agent n'attend ta réponse pour l'instant.", ignoreQuiet: true, now, ...opts }), decisions: 0 }
  }
  const label = { proposee: 'Proposition', question: 'Question', a_valider: 'À valider' }
  const items = todo.slice(0, 6).map(m => `• ${label[m.status]} : ${clip(m.title, 80)} (${missionCode(m.id)})`)
  const more = todo.length > items.length ? `\n…et ${todo.length - items.length} autre(s).` : ''
  const text = `🤖 ${todo.length} décision${todo.length > 1 ? 's' : ''} t'attend${todo.length > 1 ? 'ent' : ''} dans le Cockpit :\n${items.join('\n')}${more}\n\nRéponds OUI, NON, PLUS TARD ou JAMAIS suivi du code, ou ouvre la page Agents.`
  const status = await deliverToOwner({ db: ctx.db, userId: ctx.userId, ownerPhone, telegramChatId, text, ignoreQuiet: true, now, ...opts })
  if (status === 'envoyee' || status === 'modele') await markNotified(ctx, todo, status, now)
  return { status, decisions: todo.length }
}
