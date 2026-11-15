import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '../../server/mcp/tools.js'
import { handleRpc, annotationsOf } from '../../server/mcp/protocol.js'
import { applyTransition, needsHuman, delegableTasks, doneByAgent, cleanUrl, MAX_PENDING_PROPOSALS } from '../../src/lib/missions.js'

// Faux client Supabase : une ligne user_state (mise à jour optimiste) et un journal d'activité.
function fakeDb(state) {
  const row = { state, updated_at: '2026-01-01T00:00:00.000Z' }
  const log = []
  return {
    row, log,
    from(table) {
      const filters = {}
      let patch = null
      const q = {
        select() { return q },
        update(p) { patch = p; return q },
        insert(r) { if (table === 'activity_log') log.push(r); return Promise.resolve({ error: null }) },
        eq(k, v) { filters[k] = v; return q },
        async maybeSingle() { return { data: row } },
        then(resolve) {
          const ok = !filters.updated_at || filters.updated_at === row.updated_at
          if (patch && ok) Object.assign(row, patch)
          resolve({ data: ok ? [{ user_id: 'u' }] : [], error: null })
        },
      }
      return q
    },
  }
}
const tool = name => TOOLS.find(t => t.name === name)
const base = () => ({
  projects: [{ id: 'p1', name: 'Ulycom' }],
  clients: [{ id: 'c1', name: 'Nefsy', links: [{ kind: 'depot', url: 'https://github.com/FullValue/Nefs' }] }],
  tasks: [{ id: 't1', title: 'Audit SEO', status: 'todo', projectId: 'p1', clientId: 'c1' }, { id: 't2', title: 'Relance', status: 'todo', agentOptOut: true }],
  agentMissions: [],
})
const human = (db, id, action, text) => {
  const s = db.row.state
  s.agentMissions = s.agentMissions.map(m => (m.id === id ? applyTransition(m, action, { actor: 'me', text }) : m))
}

test('aucun outil MCP ne permet d’approuver, refuser ou valider une mission', () => {
  const names = TOOLS.map(t => t.name)
  assert.equal(new Set(names).size, names.length, 'noms d’outils uniques')
  for (const forbidden of ['approuver', 'refuser', 'valider', 'repondre_mission', 'corriger']) {
    assert.ok(!names.some(n => n.includes(forbidden)), `outil interdit : ${forbidden}`)
  }
})

test('cycle complet : proposer, accord humain, démarrer, question, livrer, valider', async () => {
  const db = fakeDb(base())
  const ctx = { db, userId: 'u', actorLabel: 'OpenClaw' }
  const dispo = await tool('taches_delegables').run({}, ctx)
  assert.deepEqual(dispo.taches.map(t => t.id), ['t1'], 'la tâche exclue par l’humain n’est pas proposée')
  assert.equal(dispo.taches[0].client.links[0].url, 'https://github.com/FullValue/Nefs')

  const m = await tool('proposer_mission').run({ title: 'Audit SEO Nefsy', type: 'seo', task_id: 't1', plan: 'Auditer', livrable: 'Rapport en brouillon' }, ctx)
  assert.equal(m.status, 'proposee')
  assert.equal(m.clientId, 'c1', 'le client vient de la tâche')
  await assert.rejects(tool('proposer_mission').run({ title: 'Doublon', type: 'seo', task_id: 't1', plan: 'x', livrable: 'y' }, ctx), /déjà active/)
  await assert.rejects(tool('proposer_mission').run({ title: 'Exclue', type: 'autre', task_id: 't2', plan: 'x', livrable: 'y' }, ctx), /ne plus proposer/)

  // Sans accord humain, l'agent ne peut ni démarrer ni livrer.
  await assert.rejects(tool('demarrer_mission').run({ id: m.id }, ctx), /impossible au statut/)
  await assert.rejects(tool('livrer_mission').run({ id: m.id, resume: 'fait' }, ctx), /impossible au statut/)
  assert.equal(needsHuman(db.row.state.agentMissions).length, 1)

  human(db, m.id, 'approuver')
  // Un autre agent ne peut pas s'emparer de la mission.
  await assert.rejects(tool('demarrer_mission').run({ id: m.id }, { ...ctx, actorLabel: 'Autre' }), /appartient/)
  assert.equal((await tool('demarrer_mission').run({ id: m.id }, ctx)).status, 'en_cours')
  await tool('journaliser_mission').run({ id: m.id, message: 'Crawl terminé' }, ctx)
  assert.equal((await tool('questionner_mission').run({ id: m.id, question: 'Quelle zone cibler ?' }, ctx)).status, 'question')
  human(db, m.id, 'repondre', 'La Suisse romande')
  const detail = await tool('lire_mission').run({ id: m.id }, ctx)
  assert.equal(detail.status, 'en_cours')
  assert.equal(detail.reponse_humaine, 'La Suisse romande')

  const livree = await tool('livrer_mission').run({ id: m.id, resume: 'Rapport prêt', fichiers: ['projects/clients/nefsy/seo.md'], liens: ['https://ex.com/pr/1', 'javascript:alert(1)'] }, ctx)
  assert.equal(livree.status, 'a_valider')
  assert.deepEqual(livree.resultat.links, ['https://ex.com/pr/1'], 'les liens non http(s) sont écartés')
  assert.equal(db.row.state.tasks[0].status, 'todo', 'livrer ne termine pas la tâche')
  human(db, m.id, 'valider')
  assert.equal(db.row.state.agentMissions[0].status, 'terminee')
  assert.equal(delegableTasks(db.row.state).length, 1, 'la tâche redevient disponible une fois la mission close')
})

test('le nombre de propositions en attente est plafonné', async () => {
  const s = base()
  s.tasks = Array.from({ length: MAX_PENDING_PROPOSALS + 1 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, status: 'todo' }))
  const db = fakeDb(s)
  const ctx = { db, userId: 'u', actorLabel: 'OpenClaw' }
  for (let i = 0; i < MAX_PENDING_PROPOSALS; i++) await tool('proposer_mission').run({ title: `M${i}`, type: 'autre', task_id: `t${i}`, plan: 'p', livrable: 'l' }, ctx)
  await assert.rejects(tool('proposer_mission').run({ title: 'Trop', type: 'autre', task_id: `t${MAX_PENDING_PROPOSALS}`, plan: 'p', livrable: 'l' }, ctx), /en attente de décision/)
  assert.equal((await tool('taches_delegables').run({}, ctx)).peut_proposer, false)
  // Une proposition reportée (« Plus tard ») ne bloque pas les suivantes.
  db.row.state.agentMissions[0].snoozeUntil = new Date(Date.now() + 86400000).toISOString()
  assert.equal((await tool('taches_delegables').run({}, ctx)).peut_proposer, true)
})

test('fiches clients : création, doublon refusé, liens nettoyés et complétés', async () => {
  const db = fakeDb(base())
  const ctx = { db, userId: 'u', actorLabel: 'Claude' }
  const c = await tool('creer_client').run({ name: 'Vanora', project_id: 'p1', links: [{ kind: 'depot', url: 'https://github.com/FullValue/VANORA-APP' }, { url: 'ftp://x' }] }, ctx)
  assert.equal(c.links.length, 1)
  assert.equal(c.createdBy, 'Claude')
  await assert.rejects(tool('creer_client').run({ name: 'vanora' }, ctx), /existe déjà/)
  const up = await tool('modifier_client').run({ id: c.id, ajouter_liens: [{ kind: 'site', url: 'https://vanora.example' }, { kind: 'depot', url: 'https://github.com/FullValue/VANORA-APP' }] }, ctx)
  assert.equal(up.links.length, 2, 'pas de doublon de lien')
  const t = await tool('creer_tache').run({ title: 'Cartes cadeaux', client_id: c.id }, ctx)
  assert.equal(t.clientId, c.id)
  await assert.rejects(tool('creer_tache').run({ title: 'x', client_id: 'nope' }, ctx), /Client introuvable/)
  assert.equal(cleanUrl('javascript:alert(1)'), null)
})

test('une tâche terminée par un agent est marquée et ne compte pas pour l’utilisateur', async () => {
  const db = fakeDb(base())
  const ctx = { db, userId: 'u', actorLabel: 'OpenClaw' }
  const t = await tool('modifier_tache').run({ id: 't1', status: 'done' }, ctx)
  assert.equal(t.completedBy, 'OpenClaw')
  assert.equal(doneByAgent(t), true)
  assert.equal(doneByAgent({ status: 'done', completedBy: null }), false)
  const back = await tool('modifier_tache').run({ id: 't1', status: 'todo' }, ctx)
  assert.equal(back.completedBy, null)
})

test('les assets créés par MCP arrivent dans la collection lue par l’app', async () => {
  const db = fakeDb({ projects: [], creativeAssets: [] })
  const ctx = { db, userId: 'u', actorLabel: 'OpenClaw' }
  await tool('ajouter_asset').run({ title: 'Script 1', kind: 'texte', contenu: 'Hook…' }, ctx)
  assert.equal(db.row.state.creativeAssets.length, 1)
  assert.equal(db.row.state.assets, undefined)
  assert.equal((await tool('lister_assets').run({}, ctx)).length, 1)
  assert.equal((await tool('tableau_de_bord').run({}, ctx)).studio.assets, 1)
})

test('chaque écriture sur le store est journalisée au nom de l’agent, pas les lectures ni les échecs', async () => {
  const db = fakeDb(base())
  const ctx = { db, userId: 'u', actorLabel: 'OpenClaw' }
  const call = (name, args) => handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx)
  await call('lister_clients', {})
  assert.equal(db.log.length, 0)
  const ok = await call('creer_tache', { title: 'Nouvelle tâche' })
  assert.ok(!ok.result.isError)
  assert.equal(db.log.length, 1)
  assert.equal(db.log[0].actor_label, 'OpenClaw')
  assert.equal(db.log[0].action, 'creer_tache')
  const ko = await call('demarrer_mission', { id: 'inconnue' })
  assert.ok(ko.result.isError)
  assert.equal(db.log.length, 1)
})

test('annotations MCP : un outil qui écrit n’est jamais annoncé en lecture seule', async () => {
  for (const t of TOOLS) {
    if (t.writes) assert.equal(annotationsOf(t.name).readOnlyHint, false, t.name)
    if (annotationsOf(t.name).readOnlyHint) assert.ok(/^(lister|lire|voir|tableau|journal|taches|etsy)/.test(t.name), t.name)
  }
  for (const n of ['creer_projet_client', 'modifier_projet_client', 'envoyer_demande', 'repondre_demande', 'repondre_whatsapp', 'etsy_noter_fiche']) {
    assert.equal(annotationsOf(n).readOnlyHint, false, n)
  }
  const list = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {})
  assert.ok(list.result.tools.every(t => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'))
})
