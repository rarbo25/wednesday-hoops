async function renderAdmin() {
  show('<main><div class="card">Loading…</div></main>');
  const [pl, inv] = await Promise.all([
    sb.from('players').select('*').eq('active', true).order('created_at'),
    sb.from('invites').select('*').is('revoked_at', null)
  ]);
  if (pl.error || inv.error) return show(msg('Could not load players.'));
  const byPlayer = {};
  inv.data.forEach(i => { byPlayer[i.player_id] = i; });
  const rows = pl.data.map(p => {
    const i = byPlayer[p.id];
    const mine = p.id === ME.id;
    return `<div class="row"><div><b>${esc(p.name)}</b>${p.nickname ? ' “' + esc(p.nickname) + '”' : ''}<br><small>${p.tier === 'core' ? 'Core' : 'Regular'}${p.role === 'admin' ? ' · Admin' : ''}${p.auth_user_id ? ' · Signed in' : ' · Not yet signed in'}</small></div><div>
      <button class="small" data-a="tier" data-id="${p.id}" data-v="${p.tier}">${p.tier === 'core' ? 'Make regular' : 'Make core'}</button>
      ${i ? `<button class="small" data-a="copy" data-token="${esc(i.token)}">Copy link</button>` : `<button class="small" data-a="newlink" data-id="${p.id}">New link</button>`}
      ${i && !mine ? `<button class="small" data-a="revoke" data-id="${i.id}">Revoke</button>` : ''}
      ${!mine ? `<button class="small" data-a="remove" data-id="${p.id}">Remove</button>` : ''}
    </div></div>`;
  }).join('');
  show(`<main>
    <form id="addf" class="card">
      <h3>Add a player</h3>
      <label>Name<input name="name" required></label>
      <label>Tier<select name="tier"><option value="regular">Regular</option><option value="core">Core</option></select></label>
      <button>Add and make invite link</button>
    </form>
    <div class="card" id="list"><h3>Players</h3>${rows}</div></main>`);

  document.getElementById('addf').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const r = await sb.from('players').insert({ name: fd.get('name').trim(), tier: fd.get('tier') }).select().single();
    if (r.error) return alert('Could not add player.');
    await sb.from('invites').insert({ player_id: r.data.id });
    renderAdmin();
  };

  document.getElementById('list').onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const a = b.dataset.a, id = b.dataset.id;
    if (a === 'copy') {
      const link = location.origin + location.pathname + '?invite=' + b.dataset.token;
      try { await navigator.clipboard.writeText(link); b.textContent = 'Copied!'; }
      catch (err) { prompt('Copy this link:', link); }
      return;
    }
    if (a === 'tier') await sb.from('players').update({ tier: b.dataset.v === 'core' ? 'regular' : 'core' }).eq('id', id);
    if (a === 'newlink') await sb.from('invites').insert({ player_id: id });
    if (a === 'revoke') {
      if (!confirm('Revoke this link? That device loses access.')) return;
      await sb.rpc('revoke_invite', { p_invite: id });
    }
    if (a === 'remove') {
      if (!confirm('Remove this player? Their history stays.')) return;
      const { data: ivs } = await sb.from('invites').select('id').eq('player_id', id).is('revoked_at', null);
      for (const i of ivs || []) await sb.rpc('revoke_invite', { p_invite: i.id });
      await sb.from('players').update({ active: false, removed_at: new Date().toISOString(), auth_user_id: null }).eq('id', id);
    }
    renderAdmin();
  };
}
