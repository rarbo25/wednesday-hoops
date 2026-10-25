let CUR = 'game';
const NY = 'America/New_York';
const fmt = (iso, o) => new Date(iso).toLocaleString('en-US', { timeZone: NY, ...o });
const av = (name, photo) => photo
  ? `<img class="avatar" style="width:36px;height:36px;border-width:2px" src="${esc(photo)}" alt="">`
  : `<span class="avatar" style="width:36px;height:36px;border-width:2px;display:inline-flex;align-items:center;justify-content:center;background:var(--orange);color:var(--cream);font-weight:700">${esc((name || '?')[0])}</span>`;
const prow = (name, sub, photo, extra) => `<div class="row"><div style="display:flex;align-items:center;gap:10px">${av(name, photo)}<div><b>${esc(name)}</b>${sub ? '<br><small>' + esc(sub) + '</small>' : ''}</div></div>${extra || ''}</div>`;

async function renderGame(note) {
  show('<main><div class="card">Loading…</div></main>');
  const gid = await sb.rpc('ensure_game');
  if (gid.error) return show(msg("Could not load this week's game."));
  const id = gid.data;
  const [g, r, p, s, o] = await Promise.all([
    sb.from('games').select('*').eq('id', id).single(),
    sb.from('rsvps').select('*').eq('game_id', id),
    sb.from('players').select('id,name,nickname,photo_url,tier,active'),
    sb.from('settings').select('key,value'),
    sb.rpc('rsvp_open_at', { p_game: id, p_tier: ME.tier })
  ]);
  if (g.error || r.error || p.error || s.error) return show(msg('Could not load the game.'));
  const game = g.data, rsvps = r.data, players = p.data;
  const cfg = {}; s.data.forEach(x => { cfg[x.key] = x.value; });
  const cap = game.cap_override ?? Number(cfg.cap ?? 10);
  const need = Number(cfg.min_to_play ?? 8);
  const by = {}; players.forEach(x => { by[x.id] = x; });
  const isAdmin = ME.role === 'admin';
  const mine = rsvps.find(x => x.player_id === ME.id);
  const my = mine ? mine.status : null;
  const closed = game.status === 'no_court' || game.status === 'canceled';
  const opens = o.data ? new Date(o.data) : null;
  const notOpen = !closed && !isAdmin && opens && new Date() < opens;

  const byTime = (a, b) => new Date(a.updated_at) - new Date(b.updated_at);
  const tierRank = x => (by[x.player_id] && by[x.player_id].tier === 'core') ? 0 : 1;
  const waitSort = (a, b) => tierRank(a) - tierRank(b) || byTime(a, b);
  const list = (st, sorter) => {
    const items = rsvps.filter(x => x.status === st).sort(sorter);
    if (!items.length) return '<p><small>Nobody yet</small></p>';
    return items.map(x => {
      if (x.player_id) {
        const q = by[x.player_id];
        return q ? prow(q.name, q.nickname ? '“' + q.nickname + '”' : '', q.photo_url) : '';
      }
      const host = by[x.host_player_id];
      const rm = (x.host_player_id === ME.id || isAdmin)
        ? `<button class="small" data-g="rmguest" data-id="${x.id}">Remove</button>` : '';
      return prow(x.guest_name + ' (+1)', 'Guest of ' + (host ? host.name : '?'), null, rm);
    }).join('');
  };
  const inCount = rsvps.filter(x => x.status === 'in').length;
  const wl = rsvps.filter(x => x.status === 'waitlist').sort(waitSort);
  const pos = mine && my === 'waitlist' ? wl.findIndex(x => x.id === mine.id) + 1 : 0;
  const answered = new Set(rsvps.filter(x => x.player_id).map(x => x.player_id));
  const silent = players.filter(x => x.active && !answered.has(x.id)).map(x => x.name);

  let banner = '';
  if (game.status === 'no_court') banner = '🚫 NO COURT THIS WEEK. There is no game.';
  else if (game.status === 'canceled') banner = 'This week’s game is canceled.';
  if (banner) banner = `<div class="card" style="background:var(--black);color:var(--cream);font-weight:700">${banner}</div>`;

  const dim = (closed || notOpen) ? 'opacity:.4;' : '';
  const btn = (s, t) => {
    const on = my === s || (s === 'in' && my === 'waitlist');
    return `<button data-g="rsvp" data-s="${s}" ${closed || notOpen ? 'disabled' : ''} style="${dim}${on ? 'background:var(--orange);' : ''}">${t}</button>`;
  };
  let status = '';
  if (notOpen) status = 'RSVPs open for you ' + fmt(opens, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) + ' ET.';
  else if (my === 'waitlist') status = 'You’re on the waitlist (#' + pos + '). You’ll move up if a spot opens.';
  const guestBtn = (my === 'in' && !closed)
    ? '<p><button class="small" data-g="guest">+ Add a guest</button><br><small>A guest only gets in if a spot is open.</small></p>' : '';
  const adminCard = isAdmin ? `<div class="card"><h3>RSVP for someone</h3>
    <label>Player<select id="who">${players.filter(x => x.active).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
    <button class="small" data-g="admin" data-s="in">In</button>
    <button class="small" data-g="admin" data-s="maybe">Maybe</button>
    <button class="small" data-g="admin" data-s="out">Out</button></div>` : '';

  show(`<main>
    ${banner}
    <div class="card">
      <h2>${fmt(game.start_at, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
      <p>${fmt(game.start_at, { hour: 'numeric', minute: '2-digit' })} – ${fmt(game.end_at, { hour: 'numeric', minute: '2-digit' })} ET</p>
      <p><b>${inCount} of ${cap}</b> spots filled · ${need} needed to play</p>
    </div>
    ${note ? `<div class="card">${esc(note)}</div>` : ''}
    <div class="card">
      <h3>Are you in?</h3>
      ${btn('in', 'In')} ${btn('maybe', 'Maybe')} ${btn('out', 'Out')}
      ${status ? `<p>${esc(status)}</p>` : ''}
      <p><small>Maybe doesn’t hold a spot. If the top ${cap} fill up, you may be put on the waitlist.</small></p>
      ${guestBtn}
    </div>
    ${adminCard}
    <div class="card"><h3>In (${inCount}/${cap})</h3>${list('in', byTime)}</div>
    <div class="card"><h3>Waitlist</h3>${list('waitlist', waitSort)}</div>
    <div class="card"><h3>Maybe</h3>${list('maybe', byTime)}</div>
    <div class="card"><h3>Out</h3>${list('out', byTime)}</div>
    <div class="card"><h3>No response yet</h3><p>${silent.length ? esc(silent.join(', ')) : 'Everyone has responded'}</p></div>
  </main>`);

  app.onclick = async e => {
    const b = e.target.closest('button');
    if (!b || !b.dataset.g || b.disabled) return;
    const a = b.dataset.g;
    let res;
    if (a === 'rsvp') {
      res = await sb.rpc('set_rsvp', { p_game: id, p_status: b.dataset.s });
      if (!res.error && b.dataset.s === 'in' && res.data === 'waitlist') {
        return renderGame('The list is full, so you’re on the waitlist.');
      }
    } else if (a === 'admin') {
      res = await sb.rpc('set_rsvp', { p_game: id, p_status: b.dataset.s, p_player: document.getElementById('who').value });
    } else if (a === 'guest') {
      const name = prompt('Guest’s name?');
      if (!name || !name.trim()) return;
      res = await sb.rpc('add_guest', { p_game: id, p_name: name });
    } else if (a === 'rmguest') {
      res = await sb.rpc('remove_guest', { p_rsvp: b.dataset.id });
    } else return;
    renderGame(res.error ? 'Could not do that: ' + res.error.message : '');
  };
}
