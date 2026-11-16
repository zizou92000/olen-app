// Réponses de l'utilisateur à une mission d'agent par message (WhatsApp) : « OUI a1b2 », « NON a1b2 trop cher »,
// « PLUS TARD a1b2 », « JAMAIS a1b2 », « REP a1b2 la Suisse romande ». Logique pure, partagée et testable.
// Seul le webhook, après vérification de la signature Meta et du numéro de l'utilisateur, appelle applyOwnerCommand.
import { applyTransition, withEvent, MISSION_STATUS } from './missions.js'

const VERB = /^(oui|non|jamais|plus tard|plustard|tard|r[ée]p(?:onse|ondre)?)(?![a-zà-ÿ0-9])[\s:,.!-]*/i
const SNOOZE_DAYS = 3

export const missionCode = id => String(id || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4)

// « Réf. a1b2 » : repère glissé dans chaque notification, pour relier une réponse (« répondre à ce message ») à sa mission.
export function codeFromBody(body) {
  const found = [...String(body || '').matchAll(/r[ée]f\.\s*([a-z0-9]{4})\b/gi)].map(m => m[1].toLowerCase())
  return found.length === 1 ? found[0] : null
}

export function parseOwnerCommand(text) {
  const m = VERB.exec(String(text || '').trim())
  if (!m) return null
  const w = m[1].toLowerCase().replace('é', 'e').replace(/\s/g, '')
  const verb = w === 'oui' || w === 'non' || w === 'jamais' ? w : w === 'plustard' || w === 'tard' ? 'tard' : 'rep'
  return { verb, rest: String(text).trim().slice(m[0].length).trim() }
}

// Retrouve la mission visée : par son code dans le message, sinon par le message auquel l'utilisateur répond.
export function resolveCommand(missions, cmd, replyCode = null) {
  const wanted = cmd.verb === 'rep' ? 'question' : 'proposee'
  const eligible = missions.filter(m => m.status === wanted)
  const named = /^#?([a-z0-9]{4})(?![a-z0-9])[\s:,-]*([\s\S]*)$/i.exec(cmd.rest)
  const withCode = code => missions.filter(m => missionCode(m.id) === code.toLowerCase())
  let matches = []
  let text = cmd.rest
  if (named && withCode(named[1]).length) {
    const all = withCode(named[1])
    matches = all.filter(m => m.status === wanted)
    text = named[2].trim()
    if (!matches.length) return { error: 'statut', mission: all[0] }
  } else if (replyCode) {
    matches = eligible.filter(m => missionCode(m.id) === replyCode)
  }
  if (matches.length === 1) return { mission: matches[0], text }
  if (matches.length > 1) return { error: 'ambigu' }
  return { error: 'inconnu', eligible }
}

function pendingList(eligible, verb) {
  if (!eligible.length) return "Aucune mission n'attend ta réponse."
  const example = verb === 'rep' ? 'REP' : 'OUI'
  return ['Je ne sais pas à quelle mission tu réponds. En attente :', ...eligible.slice(0, 5).map(m => `• ${m.title} : ${example} ${missionCode(m.id)}`)].join('\n')
}

// Modifie `s` (copie du store) en place et renvoie le message de confirmation.
export function applyOwnerCommand(s, cmd, replyCode = null, now = new Date().toISOString()) {
  const hit = resolveCommand(s.agentMissions || [], cmd, replyCode)
  if (hit.error === 'statut') return { changed: false, reply: `« ${hit.mission.title} » n'attend plus de réponse (${MISSION_STATUS[hit.mission.status] || hit.mission.status}).` }
  if (hit.error === 'ambigu') return { changed: false, reply: 'Plusieurs missions portent ce code : ouvre la page Agents du Cockpit.' }
  if (hit.error) return { changed: false, reply: pendingList(hit.eligible, cmd.verb) }
  const { mission: m, text } = hit
  const note = text ? `${text} (WhatsApp)` : 'via WhatsApp'
  const opts = { actor: 'me', text: note, now }
  switch (cmd.verb) {
    case 'oui':
      Object.assign(m, applyTransition(m, 'approuver', opts))
      return { changed: true, reply: `✅ Approuvée : « ${m.title} ». ${m.agent} la démarre à son prochain passage.` }
    case 'non':
      Object.assign(m, applyTransition(m, 'refuser', opts))
      return { changed: true, reply: `🚫 Refusée : « ${m.title} ».` }
    case 'tard': {
      Object.assign(m, withEvent({ ...m, snoozeUntil: new Date(new Date(now).getTime() + SNOOZE_DAYS * 86400000).toISOString() }, 'reporter', 'me', 'via WhatsApp', now))
      return { changed: true, reply: `⏰ Reportée de ${SNOOZE_DAYS} jours : « ${m.title} ».` }
    }
    case 'jamais': {
      Object.assign(m, applyTransition(m, 'refuser', { ...opts, text: 'Ne plus proposer cette tâche (WhatsApp).' }))
      const task = (s.tasks || []).find(t => t.id === m.taskId)
      if (task) { task.agentOptOut = true; task.updatedAt = now }
      return { changed: true, reply: `🚫 Refusée, et plus jamais proposée : « ${m.title} ».` }
    }
    default:
      if (!text) return { changed: false, reply: `Écris ta réponse après le code, par exemple : REP ${missionCode(m.id)} la Suisse romande.` }
      Object.assign(m, applyTransition(m, 'repondre', { ...opts, text }))
      return { changed: true, reply: `✅ Réponse transmise à ${m.agent} pour « ${m.title} ».` }
  }
}
