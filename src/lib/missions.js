// Missions d'agents (OpenClaw aujourd'hui, Uly demain) : logique pure, partagée par l'app et le serveur MCP.
// Une mission est une proposition de travail faite par un agent sur une tâche ou un dossier client.
// Règle centrale : seul l'humain, depuis l'app, approuve, refuse, répond et valide. Aucun outil MCP ne le fait.

export const MISSION_TYPES = {
  code: 'Programmation',
  seo: 'SEO',
  dossier: 'Dossier client',
  etude: 'Étude de marché',
  marketing: 'Marketing et contenu',
  autre: 'Autre',
}

export const MISSION_STATUS = {
  proposee: 'À décider',
  approuvee: 'Approuvée',
  en_cours: 'En cours',
  question: 'Question en attente',
  a_valider: 'À valider',
  terminee: 'Terminée',
  refusee: 'Refusée',
  echec: 'Échec',
}

// Une mission « active » occupe sa tâche : on n'en propose pas une seconde.
export const ACTIVE_STATUS = ['proposee', 'approuvee', 'en_cours', 'question', 'a_valider']
export const MAX_PENDING_PROPOSALS = 5
export const MAX_EVENTS = 60

const TRANSITIONS = {
  // Humain (app)
  approuver: { from: ['proposee'], to: 'approuvee', by: 'human' },
  refuser: { from: ['proposee', 'approuvee'], to: 'refusee', by: 'human' },
  repondre: { from: ['question'], to: 'en_cours', by: 'human' },
  valider: { from: ['a_valider'], to: 'terminee', by: 'human' },
  corriger: { from: ['a_valider'], to: 'approuvee', by: 'human' },
  // Agent (MCP)
  demarrer: { from: ['approuvee'], to: 'en_cours', by: 'agent' },
  questionner: { from: ['en_cours'], to: 'question', by: 'agent' },
  livrer: { from: ['en_cours'], to: 'a_valider', by: 'agent' },
  echouer: { from: ['approuvee', 'en_cours', 'question'], to: 'echec', by: 'agent' },
}

export function canTransition(mission, action) {
  const t = TRANSITIONS[action]
  return !!t && !!mission && t.from.includes(mission.status)
}

function event(type, actor, text, now) {
  return { at: now, type, actor, text: text || '' }
}

export function withEvent(mission, type, actor, text, now = new Date().toISOString()) {
  const events = [...(mission.events || []), event(type, actor, text, now)].slice(-MAX_EVENTS)
  return { ...mission, events, updatedAt: now }
}

// Applique une transition et renvoie la mission modifiée. Lève une erreur claire si elle est interdite.
export function applyTransition(mission, action, { actor, text = '', now = new Date().toISOString() } = {}) {
  const t = TRANSITIONS[action]
  if (!t) throw new Error(`Action inconnue : ${action}`)
  if (!t.from.includes(mission.status)) {
    throw new Error(`Mission « ${mission.title} » : action « ${action} » impossible au statut « ${MISSION_STATUS[mission.status] || mission.status} ».`)
  }
  const next = withEvent({ ...mission, status: t.to }, action, actor, text, now)
  if (action === 'approuver' || action === 'refuser') next.decision = { action, by: actor, at: now, note: text || '' }
  if (action === 'questionner') next.question = text
  if (action === 'repondre') { next.answer = text; next.question = null }
  if (action === 'corriger') next.feedback = text
  if (action === 'valider') next.validatedAt = now
  if (action === 'demarrer') next.startedAt = next.startedAt || now
  return next
}

export function isSnoozed(mission, now = new Date().toISOString()) {
  return mission.status === 'proposee' && !!mission.snoozeUntil && mission.snoozeUntil > now
}

// Ce qui attend une décision humaine : propositions (hors reportées), questions, livraisons à valider.
export function needsHuman(missions, now = new Date().toISOString()) {
  return (missions || []).filter(m => (m.status === 'proposee' && !isSnoozed(m, now)) || m.status === 'question' || m.status === 'a_valider')
}

export function activeMissionForTask(missions, taskId) {
  if (!taskId) return null
  return (missions || []).find(m => m.taskId === taskId && ACTIVE_STATUS.includes(m.status)) || null
}

// Une tâche est délégable si elle est ouverte, n'a pas été exclue par l'humain et n'a pas déjà une mission active.
export function delegableTasks(state) {
  const missions = state.agentMissions || []
  return (state.tasks || []).filter(t => t.status !== 'done' && !t.agentOptOut && !activeMissionForTask(missions, t.id))
}

// Une tâche terminée par un agent ne compte pas dans l'XP ni les séries de l'humain.
export function doneByAgent(task) {
  return !!task?.completedBy && task.completedBy !== 'me'
}

export const CLIENT_LINK_KINDS = { site: 'Site', depot: 'Dépôt', preprod: 'Préversion', boutique: 'Boutique', store: 'Store', autre: 'Lien' }

export function cleanUrl(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!/^https?:\/\/[^\s]+$/i.test(v)) return null
  return v.slice(0, 500)
}

export function slugify(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}
