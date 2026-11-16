// Base en mémoire : assez de Supabase pour user_state et wa_messages.
export function memDb(state) {
  const tables = { user_state: [{ user_id: 'u', state, updated_at: 't0' }], wa_messages: [], activity_log: [] }
  let n = 0
  return {
    tables,
    from(name) {
      const rows = tables[name]
      const f = []
      let mode = 'select', patch = null, ins = null
      const q = {
        select() { return q }, order() { return q }, limit() { return q },
        eq(k, v) { f.push(r => r[k] === v); return q },
        in(k, vs) { f.push(r => vs.includes(r[k])); return q },
        is(k, v) { f.push(r => (r[k] ?? null) === v); return q },
        update(p) { mode = 'update'; patch = p; return q },
        insert(r) { mode = 'insert'; ins = r; return q },
        upsert(r) { mode = 'upsert'; ins = r; return q },
        run() {
          if (mode === 'insert') { const row = { id: `r${++n}`, ...ins }; rows.push(row); return [row] }
          if (mode === 'upsert') {
            if (rows.some(r => r.wa_message_id === ins.wa_message_id)) return []
            const row = { id: `r${++n}`, ...ins }; rows.push(row); return [row]
          }
          const hit = rows.filter(r => f.every(fn => fn(r)))
          if (mode === 'update') for (const r of hit) Object.assign(r, patch, name === 'user_state' ? { updated_at: `t${++n}` } : {})
          return hit
        },
        async maybeSingle() { return { data: q.run()[0] || null, error: null } },
        async single() { return { data: q.run()[0], error: null } },
        then(res) { res({ data: q.run(), error: null }) },
      }
      return q
    },
  }
}

