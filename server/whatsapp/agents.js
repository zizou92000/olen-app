// Réponses de l'utilisateur aux missions d'agents, reçues par WhatsApp.
// Garde-fous : le webhook a déjà vérifié la signature Meta ; seul le numéro enregistré par l'utilisateur dans l'app
// (Intégrations) est écouté ; un message déjà reçu n'est jamais rejoué ; aucun outil MCP ne peut changer ce numéro.
import { readState, mutateState } from '../mcp/state.js'
import { sendText, normalizePhone } from './core.js'
import { parseOwnerCommand, applyOwnerCommand, codeFromBody } from '../../src/lib/missionCommands.js'
import { sendDigest } from './notify.js'

// À appeler AVANT l'enregistrement des messages : repère les commandes de l'utilisateur pas encore vues.
export async function findOwnerCommands(payload, db, ownerId) {
  let owner
  try { owner = normalizePhone((await readState({ db, userId: ownerId })).state.settings?.ownerWhatsApp) } catch { return null }
  if (!owner) return null
  const mine = []
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        if (normalizePhone(m.from) === owner) mine.push({ id: m.id, type: m.type, text: m.text?.body || '', contextId: m.context?.id || null })
      }
    }
  }
  if (!mine.length) return null
  const { data } = await db.from('wa_messages').select('wa_message_id').in('wa_message_id', mine.map(m => m.id))
  const seen = new Set((data || []).map(r => r.wa_message_id))
  const fresh = mine.filter(m => !seen.has(m.id))
  const commands = fresh.filter(m => m.type === 'text' && parseOwnerCommand(m.text))
  // Tout autre message de l'utilisateur (« bonjour », « ok »…) ouvre la fenêtre de 24 h : on lui renvoie ce qui l'attend.
  return { owner, commands, others: fresh.length - commands.length }
}

// À appeler APRÈS l'enregistrement : ses propres messages ne comptent pas comme « non lus », puis les commandes sont appliquées.
export async function runOwnerCommands(found, db, ownerId, { now = new Date(), ...deps } = {}) {
  if (!found) return 0
  await db.from('wa_messages').update({ read_at: now.toISOString() })
    .eq('user_id', ownerId).eq('contact_phone', found.owner).eq('direction', 'in').is('read_at', null)
  for (const c of found.commands) {
    let reply
    try {
      let replyCode = null
      if (c.contextId) {
        const { data } = await db.from('wa_messages').select('body').eq('user_id', ownerId).eq('wa_message_id', c.contextId).maybeSingle()
        replyCode = codeFromBody(data?.body)
      }
      const cmd = parseOwnerCommand(c.text)
      reply = await mutateState({ db, userId: ownerId, actorLabel: 'WhatsApp' }, s => applyOwnerCommand(s, cmd, replyCode, now.toISOString()).reply)
    } catch (err) {
      console.error('[whatsapp] commande impossible :', err.message)
      reply = "Je n'ai pas pu traiter ta réponse. Ouvre la page Agents du Cockpit pour décider."
    }
    try { await sendText({ db, userId: ownerId, to: found.owner, text: reply, via: 'cockpit-agents', now, ...deps }) } catch (err) { console.error('[whatsapp] confirmation impossible :', err.message) }
  }
  if (found.others > 0) {
    try {
      const ctx = { db, userId: ownerId, actorLabel: 'WhatsApp' }
      await sendDigest(ctx, (await readState(ctx)).state, { now, all: true, ...deps })
    } catch (err) { console.error('[whatsapp] récapitulatif impossible :', err.message) }
  }
  return found.commands.length
}
