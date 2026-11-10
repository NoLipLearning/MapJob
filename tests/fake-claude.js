// Shared fake of window.claude (db, user, downloads) for tests. Copied from tests/tracker.js. Shapes follow db.d.ts.
// Set window.__FAKE_OPTS = {noDb, hang, delay, uid} and seed window.__FAKE_STORE = {docs: {"jobs/<id>": {...}}, subs: [], writes: []} before it runs.
const FAKE = `(() => {
  const store = window.__FAKE_STORE = window.__FAKE_STORE || { docs: {}, subs: [], writes: [] };
  const params = window.__FAKE_OPTS || {};
  const parent = p => p.slice(0, p.lastIndexOf('/'));
  const snapDoc = (path, d) => ({ id: path.split('/').pop(), exists: true, data: () => JSON.parse(JSON.stringify(d)), metadata: { fromCache: false, hasPendingWrites: false } });
  const notify = (changes) => store.subs.forEach(s => { const ch = changes.filter(c => parent(c.path) === s.path); if (ch.length) s.next({ docs: [], size: 0, empty: false, metadata: {}, docChanges: () => ch.map(c => ({ type: c.type, doc: snapDoc(c.path, c.data || {}), oldIndex: -1, newIndex: -1 })) }); });
  const col = path => ({ path, doc: id => ({ id, path: path + '/' + id,
      set: async d => { const p = path + '/' + id; const had = p in store.docs; store.docs[p] = JSON.parse(JSON.stringify(d)); store.writes.push(['set', p]); setTimeout(() => notify([{ type: had ? 'modified' : 'added', path: p, data: d }]), 0); },
      update: async d => { const p = path + '/' + id; if (!(p in store.docs)) throw new Error('not-found'); store.docs[p] = Object.assign({}, store.docs[p], JSON.parse(JSON.stringify(d))); store.writes.push(['update', p]); setTimeout(() => notify([{ type: 'modified', path: p, data: store.docs[p] }]), 0); },
      delete: async () => { const p = path + '/' + id; if (p in store.docs) { const d = store.docs[p]; delete store.docs[p]; store.writes.push(['delete', p]); setTimeout(() => notify([{ type: 'removed', path: p, data: d }]), 0); } },
      get: async () => ({ id, exists: path + '/' + id in store.docs, data: () => store.docs[path + '/' + id] }) }),
    onSnapshot(next) { const s = { path, next }; store.subs.push(s); const ch = Object.keys(store.docs).filter(k => parent(k) === path).map(k => ({ type: 'added', path: k, data: store.docs[k] }));
      setTimeout(() => next({ docs: [], size: ch.length, empty: !ch.length, metadata: {}, docChanges: () => ch.map(c => ({ type: 'added', doc: snapDoc(c.path, c.data), oldIndex: -1, newIndex: -1 })) }), params.delay || 0); return () => { store.subs = store.subs.filter(x => x !== s); }; } });
  const caps = { db: { collection: col, doc: () => { throw new Error('unused'); } }, user: { id: async () => params.uid || 'u1', isOwner: async () => true },
    downloads: { save: async r => { (window.__saved = window.__saved || []).push({ filename: r.filename, data: r.data }); return { status: 'saved' }; } } };
  window.claude = { use: async n => { if (params.hang) return new Promise(() => {}); return params.noDb && n === 'db' ? null : (caps[n] || null); } };
})();`;
module.exports = { FAKE };
