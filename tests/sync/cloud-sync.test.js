import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStates, trackChanges } from '../../src/lib/cloudSync.js'

const task = (id, extra = {}) => ({ id, title: id, createdAt: '2026-01-01T00:00:00.000Z', ...extra })

test('une modification est datée et une suppression laisse une trace', () => {
  const prev = { tasks: [task('a'), task('b')], _deleted: {} }
  const edited = trackChanges(prev, { ...prev, tasks: [{ ...prev.tasks[0], title: 'x' }, prev.tasks[1]] }, '2026-02-01T00:00:00.000Z')
  assert.equal(edited.tasks[0].updatedAt, '2026-02-01T00:00:00.000Z')
  assert.equal(edited.tasks[1], prev.tasks[1])
  const removed = trackChanges(prev, { ...prev, tasks: [prev.tasks[0]] }, '2026-02-02T00:00:00.000Z')
  assert.deepEqual(removed._deleted, { b: '2026-02-02T00:00:00.000Z' })
})

test('un élément supprimé sur un appareil ne revient pas à la fusion', () => {
  const now = new Date().toISOString()
  const local = { tasks: [task('a'), task('b')], _deleted: {} }
  const remote = { tasks: [task('a')], _deleted: { b: now } }
  assert.deepEqual(mergeStates(local, remote).tasks.map(t => t.id), ['a'])
  assert.deepEqual(mergeStates(remote, local).tasks.map(t => t.id), ['a'])
})

test('annuler une suppression fait revivre l\'élément, même face à une trace distante', () => {
  const t0 = new Date(Date.now() - 60000).toISOString()
  const t1 = new Date().toISOString()
  const afterDelete = trackChanges({ tasks: [task('a')], _deleted: {} }, { tasks: [], _deleted: {} }, t0)
  const restored = trackChanges(afterDelete, { ...afterDelete, tasks: [task('a')] }, t1)
  assert.deepEqual(restored._deleted, {})
  const merged = mergeStates(restored, { tasks: [], _deleted: { a: t0 } })
  assert.deepEqual(merged.tasks.map(t => t.id), ['a'])
  assert.deepEqual(merged._deleted, {})
})

test('en conflit, la version modifiée le plus récemment gagne', () => {
  const local = { tasks: [task('a', { title: 'ancien' })] }
  const remote = { tasks: [task('a', { title: 'récent', updatedAt: '2026-03-01T00:00:00.000Z' })] }
  assert.equal(mergeStates(local, remote).tasks[0].title, 'récent')
})

test('missions : la décision humaine la plus récente survit à une fusion avec une copie distante plus ancienne', () => {
  const proposed = { id: 'm1', title: 'Audit', status: 'proposee', updatedAt: '2026-11-15T08:00:00.000Z' }
  const approved = { ...proposed, status: 'approuvee', updatedAt: '2026-11-15T09:00:00.000Z' }
  assert.equal(mergeStates({ agentMissions: [approved] }, { agentMissions: [proposed] }).agentMissions[0].status, 'approuvee')
  // Et l'avancée de l'agent, plus récente que la copie locale, l'emporte dans l'autre sens.
  const delivered = { ...approved, status: 'a_valider', updatedAt: '2026-11-15T10:00:00.000Z' }
  assert.equal(mergeStates({ agentMissions: [approved] }, { agentMissions: [delivered] }).agentMissions[0].status, 'a_valider')
  // Une mission créée par un agent pendant que l'app était hors ligne n'est pas perdue.
  assert.equal(mergeStates({ agentMissions: [] }, { agentMissions: [proposed] }).agentMissions.length, 1)
})
