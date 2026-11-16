import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memDb } from '../helpers.js'
import { verifySecret, keyboardFor, tg } from '../../server/telegram/core.js'
import { handleTelegramUpdate } from '../../server/telegram/agents.js'
import { deliverToOwner } from '../../server/whatsapp/notify.js'

const CHAT = 4242
const env = { TELEGRAM_BOT_TOKEN: 'bot:SECRET' }
const now = new Date('2026-11-16T10:00:00Z')
const mission = (o = {}) => ({ id: 'a1b2c3d4', title: 'Audit SEO', status: 'proposee', agent: 'OpenClaw', taskId: 't1', events: [], ...o })
const fakeFetch = () => { const calls = []; const fn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true, result: {} }) } }; fn.calls = calls; return fn }
const msg = (id, text, extra = {}) => ({ update_id: id, message: { chat: { id: CHAT, type: 'private' }, text, ...extra } })
const click = (id, data) => ({ update_id: id, callback_query: { id: 'cb1', data, message: { message_id: 9, chat: { id: CHAT, type: 'private' } } } })
const setup = (settings, missions = [mission()]) => memDb({ settings, agentMissions: missions, tasks: [{ id: 't1', title: 'x' }] })
const st = db => db.tables.user_state[0].state

test('secret du webhook : comparaison exacte', () => {
  assert.equal(verifySecret('abc', 'abc'), true)
  assert.equal(verifySecret('abd', 'abc'), false)
  assert.equal(verifySecret(undefined, 'abc'), false)
  assert.equal(verifySecret('abc', undefined), false)
})

test('appairage : le code à usage unique relie le chat, un mauvais code ou un code expiré non', async () => {
  const future = new Date(now.getTime() + 600000).toISOString()
  let db = setup({ telegramPairing: { code: 'ABC12345', expiresAt: future } }); let f = fakeFetch()
  assert.equal(await handleTelegramUpdate(msg(1, '/start WRONG123'), { db, ownerId: 'u', env, fetchImpl: f, now }), 'appairage')
  assert.equal(st(db).settings.telegramChatId, undefined)
  assert.match(f.calls[0].body.text, /invalide/)
  f = fakeFetch()
  await handleTelegramUpdate(msg(2, '/start ABC12345'), { db, ownerId: 'u', env, fetchImpl: f, now })
  assert.equal(st(db).settings.telegramChatId, String(CHAT)); assert.equal(st(db).settings.telegramPairing, null)
  // Le même code ne sert qu'une fois.
  const other = { update_id: 3, message: { chat: { id: 999, type: 'private' }, text: '/start ABC12345' } }
  await handleTelegramUpdate(other, { db, ownerId: 'u', env, fetchImpl: fakeFetch(), now })
  assert.equal(st(db).settings.telegramChatId, String(CHAT))
  db = setup({ telegramPairing: { code: 'ABC12345', expiresAt: new Date(now.getTime() - 1000).toISOString() } })
  await handleTelegramUpdate(msg(1, '/start ABC12345'), { db, ownerId: 'u', env, fetchImpl: fakeFetch(), now })
  assert.equal(st(db).settings.telegramChatId, undefined)
})

test('boutons et texte : décision appliquée, une seule fois, clavier retiré', async () => {
  const db = setup({ telegramChatId: String(CHAT) }); const f = fakeFetch()
  assert.equal(await handleTelegramUpdate(click(10, 'oui:a1b2'), { db, ownerId: 'u', env, fetchImpl: f, now }), 'applique')
  assert.equal(st(db).agentMissions[0].status, 'approuvee')
  assert.deepEqual(f.calls.map(c => c.url.split('/').pop()), ['answerCallbackQuery', 'editMessageReplyMarkup', 'sendMessage'])
  // Telegram rejoue la même update : rien ne bouge, rien n'est renvoyé.
  const again = fakeFetch()
  assert.equal(await handleTelegramUpdate(click(10, 'oui:a1b2'), { db, ownerId: 'u', env, fetchImpl: again, now }), 'ignore')
  assert.equal(again.calls.length, 0)
  const db2 = setup({ telegramChatId: String(CHAT) })
  await handleTelegramUpdate(msg(11, 'JAMAIS a1b2'), { db: db2, ownerId: 'u', env, fetchImpl: fakeFetch(), now })
  assert.equal(st(db2).agentMissions[0].status, 'refusee'); assert.equal(st(db2).tasks[0].agentOptOut, true)
})

test('répondre au message de la question suffit ; un autre chat ou un groupe est ignoré', async () => {
  const db = setup({ telegramChatId: String(CHAT) }, [mission({ status: 'question', question: '?' })])
  await handleTelegramUpdate(msg(20, 'La Suisse romande', { reply_to_message: { text: 'Une question (réf. a1b2)' } }), { db, ownerId: 'u', env, fetchImpl: fakeFetch(), now })
  assert.equal(st(db).agentMissions[0].answer, 'La Suisse romande'); assert.equal(st(db).agentMissions[0].status, 'en_cours')
  const db2 = setup({ telegramChatId: String(CHAT) }); const f = fakeFetch()
  assert.equal(await handleTelegramUpdate({ update_id: 1, message: { chat: { id: 777, type: 'private' }, text: 'OUI a1b2' } }, { db: db2, ownerId: 'u', env, fetchImpl: f, now }), 'ignore')
  assert.equal(await handleTelegramUpdate({ update_id: 2, message: { chat: { id: CHAT, type: 'group' }, text: 'OUI a1b2' } }, { db: db2, ownerId: 'u', env, fetchImpl: f, now }), 'ignore')
  assert.equal(st(db2).agentMissions[0].status, 'proposee'); assert.equal(f.calls.length, 0)
})

test('un message libre renvoie ce qui attend ; la livraison passe par Telegram avec boutons', async () => {
  const db = setup({ telegramChatId: String(CHAT) }); const f = fakeFetch()
  assert.equal(await handleTelegramUpdate(msg(30, 'salut'), { db, ownerId: 'u', env, fetchImpl: f, now }), 'recap')
  assert.match(f.calls[0].body.text, /1 décision/)
  const f2 = fakeFetch()
  const status = await deliverToOwner({ db, userId: 'u', telegramChatId: String(CHAT), buttons: keyboardFor(mission()), text: 'x', env, fetchImpl: f2, now })
  assert.equal(status, 'envoyee'); assert.equal(f2.calls[0].body.reply_markup.inline_keyboard[0][0].callback_data, 'oui:a1b2')
  assert.equal(await deliverToOwner({ db, userId: 'u', telegramChatId: String(CHAT), text: 'x', env, fetchImpl: f2, now: new Date('2026-11-15T22:30:00Z') }), 'heures_calmes')
  assert.equal(keyboardFor(mission({ status: 'question' })), null)
})

test('le jeton du bot n’apparaît jamais dans une erreur', async () => {
  const boom = async () => { throw new Error('connect ECONNREFUSED https://api.telegram.org/botbot:SECRET/sendMessage') }
  await assert.rejects(tg('getMe', {}, { env, fetchImpl: boom }), err => !err.message.includes('bot:SECRET'))
})
