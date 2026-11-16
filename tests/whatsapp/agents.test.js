import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOwnerCommand, applyOwnerCommand, missionCode, codeFromBody } from '../../src/lib/missionCommands.js'
import { toInternational } from '../../src/lib/whatsapp.js'
import { memDb } from '../helpers.js'
import { isQuietHour, notificationText, deliverToOwner } from '../../server/whatsapp/notify.js'

const mission = (o = {}) => ({ id: 'a1b2c3d4', title: 'Audit SEO', status: 'proposee', agent: 'OpenClaw', taskId: 't1', events: [], ...o })
const state = (m = mission()) => ({ agentMissions: [m], tasks: [{ id: 't1', title: 'x' }] })

test('numéro français converti, code de mission et repère de réponse', () => {
  assert.equal(toInternational('06 52 96 73 88'), '33652967388')
  assert.equal(toInternational('+33 6 52 96 73 88'), '33652967388')
  assert.equal(missionCode('a1b2c3d4'), 'a1b2')
  assert.equal(codeFromBody('texte (réf. a1b2)'), 'a1b2')
  assert.equal(codeFromBody('réf. a1b2 et réf. c3d4'), null)
})

test('OUI / NON / PLUS TARD / JAMAIS / REP appliqués, jamais sur une mission au mauvais statut', () => {
  let s = state(); let r = applyOwnerCommand(s, parseOwnerCommand('OUI a1b2'))
  assert.equal(s.agentMissions[0].status, 'approuvee'); assert.ok(r.changed)
  r = applyOwnerCommand(s, parseOwnerCommand('oui a1b2'))
  assert.equal(r.changed, false)
  s = state(); applyOwnerCommand(s, parseOwnerCommand('Jamais a1b2'))
  assert.equal(s.agentMissions[0].status, 'refusee'); assert.equal(s.tasks[0].agentOptOut, true)
  s = state(); applyOwnerCommand(s, parseOwnerCommand('plus tard a1b2'))
  assert.ok(s.agentMissions[0].snoozeUntil); assert.equal(s.agentMissions[0].status, 'proposee')
  s = state(mission({ status: 'question', question: '?' }))
  assert.equal(applyOwnerCommand(s, parseOwnerCommand('REP a1b2')).changed, false)
  applyOwnerCommand(s, parseOwnerCommand('REP a1b2 la Suisse'))
  assert.equal(s.agentMissions[0].answer, 'la Suisse'); assert.equal(s.agentMissions[0].status, 'en_cours')
})

test('réponse sans code : par le message cité, sinon liste des missions en attente', () => {
  let s = state(); applyOwnerCommand(s, parseOwnerCommand('oui'), 'a1b2')
  assert.equal(s.agentMissions[0].status, 'approuvee')
  s = state(); const r = applyOwnerCommand(s, parseOwnerCommand('oui'))
  assert.equal(r.changed, false); assert.match(r.reply, /OUI a1b2/)
})

test('notification : sans lien, une ligne par champ, heures calmes de Paris', () => {
  const t = notificationText(mission({ title: 'Voir https://evil.example/x' }), 'Nefsy')
  assert.ok(!t.includes('evil.example')); assert.match(t, /réf\. a1b2/)
  assert.equal(isQuietHour(new Date('2026-11-15T21:30:00Z')), true)
  assert.equal(isQuietHour(new Date('2026-11-15T20:30:00Z')), false)
  assert.equal(isQuietHour(new Date('2026-11-16T07:00:00Z')), false)
})

test('livraison : non configuré, heures calmes, fenêtre fermée sans modèle', async () => {
  const base = { db: {}, userId: 'u', ownerPhone: '33600000000', text: 'x', now: new Date('2026-11-16T10:00:00Z') }
  assert.equal(await deliverToOwner({ ...base, env: {} }), 'non_configuree')
  const env = { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p' }
  assert.equal(await deliverToOwner({ ...base, env, now: new Date('2026-11-15T22:30:00Z') }), 'heures_calmes')
  const db = { from: () => { const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: null }) }; return q } }
  assert.equal(await deliverToOwner({ ...base, db, env }), 'hors_fenetre')
})

const OWNER = '33600000000'
const env = { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p' }
function fakeFetch() {
  const sent = []
  const fn = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ messages: [{ id: `wamid.out${sent.length}` }] }) } }
  fn.sent = sent
  return fn
}
const inbound = (id, from, text, contextId) => ({ entry: [{ changes: [{ value: { contacts: [], messages: [{ id, from, type: 'text', timestamp: '1794816000', text: { body: text }, ...(contextId ? { context: { id: contextId } } : {}) }] } }] }] })

test('webhook : la réponse OUI de l’utilisateur approuve la mission et reçoit une confirmation, une seule fois', async () => {
  const { findOwnerCommands, runOwnerCommands } = await import('../../server/whatsapp/agents.js')
  const { ingestWebhook } = await import('../../server/whatsapp/core.js')
  const db = memDb({ settings: { ownerWhatsApp: OWNER }, agentMissions: [mission()], tasks: [] })
  const fetchImpl = fakeFetch()
  const now = new Date(1794816000 * 1000 + 60000)
  const payload = inbound('wamid.in1', OWNER, 'OUI a1b2')
  const found = await findOwnerCommands(payload, db, 'u')
  await ingestWebhook(payload, db, 'u')
  await runOwnerCommands(found, db, 'u', { now, env, fetchImpl })
  assert.equal(db.tables.user_state[0].state.agentMissions[0].status, 'approuvee')
  assert.equal(fetchImpl.sent.length, 1)
  assert.match(fetchImpl.sent[0].text.body, /Approuvée/)
  assert.equal(db.tables.wa_messages.find(m => m.wa_message_id === 'wamid.in1').read_at !== null, true)
  // Meta renvoie le même événement : rien n'est rejoué.
  const again = await findOwnerCommands(payload, db, 'u')
  assert.equal(again.commands.length, 0)
})

test('webhook : un autre numéro ne peut rien décider', async () => {
  const { findOwnerCommands } = await import('../../server/whatsapp/agents.js')
  const db = memDb({ settings: { ownerWhatsApp: OWNER }, agentMissions: [mission()], tasks: [] })
  assert.equal(await findOwnerCommands(inbound('wamid.x', '33611111111', 'OUI a1b2'), db, 'u'), null)
  const none = memDb({ settings: {}, agentMissions: [mission()], tasks: [] })
  assert.equal(await findOwnerCommands(inbound('wamid.y', OWNER, 'OUI a1b2'), none, 'u'), null)
})

test('un « bonjour » de l’utilisateur renvoie ce qui l’attend', async () => {
  const { findOwnerCommands, runOwnerCommands } = await import('../../server/whatsapp/agents.js')
  const { ingestWebhook } = await import('../../server/whatsapp/core.js')
  const db = memDb({ settings: { ownerWhatsApp: OWNER }, agentMissions: [mission(), mission({ id: 'zz99yy88', title: 'Étude', status: 'question', question: '?' })], tasks: [] })
  const fetchImpl = fakeFetch()
  const payload = inbound('wamid.in2', OWNER, 'Bonjour')
  const found = await findOwnerCommands(payload, db, 'u')
  await ingestWebhook(payload, db, 'u')
  await runOwnerCommands(found, db, 'u', { now: new Date(1794816000 * 1000 + 60000), env, fetchImpl })
  assert.equal(fetchImpl.sent.length, 1)
  assert.match(fetchImpl.sent[0].text.body, /2 décisions/)
  assert.ok(db.tables.user_state[0].state.agentMissions.every(m => m.notified))
})

test('fenêtre fermée : modèle sans paramètre si WHATSAPP_TEMPLATE_PARAMS=0', async () => {
  const db = memDb({})
  const fetchImpl = fakeFetch()
  const status = await deliverToOwner({ db, userId: 'u', ownerPhone: OWNER, text: 'x', now: new Date('2026-11-16T10:00:00Z'), fetchImpl,
    env: { ...env, WHATSAPP_TEMPLATE_NOTIFY: 'hello_world', WHATSAPP_TEMPLATE_LANG: 'en_US', WHATSAPP_TEMPLATE_PARAMS: '0' } })
  assert.equal(status, 'modele')
  assert.deepEqual(fetchImpl.sent[0].template, { name: 'hello_world', language: { code: 'en_US' }, components: [] })
})
