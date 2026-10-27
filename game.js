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
  else if (game.status === 'game_on') banner = '🏀 GAME ON! We have enough players. See you on the court.';
  else if (game.status === 'borderline') banner = 'Borderline: ' + inCount + ' confirmed. Still open. Are you good with 3v3, or can you make it 4v4?';
  else if (game.status === 'needs_call') banner = 'Waiting on the final call. Hang tight.';
  if (banner) banner = `<div class="card" style="background:var(--black);color:var(--cream);font-weight:700">${banner}</div>`;

  const dim = (closed || notOpen) ? 'opacity:.4;' : '';
  const btn = (s, t) => {
    const on = my === s || (s === 'in' && my === 'waitlist');
    return `<button data-g="rsvp" data-s="${s}" ${closed || notOpen ? 'disabled' : ''} style="${dim}${on ? 'background:var(--orange);' : ''}">${t}</button>`;
  };
  let status = '';
  if (notOpen) status = 'RSVPs open for you ' + fmt(opens, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) + ' ET.';
  else if (my === 'waitlist') status = (mine.offer_expires_at && new Date(mine.offer_expires_at) > new Date()) ? '🏀 A spot opened for you! Tap In to confirm by ' + fmt(mine.offer_expires_at, { hour: 'numeric', minute: '2-digit' }) + ' ET, or it goes to the next person.' : 'You’re on the waitlist (#' + pos + '). You’ll move up if a spot opens.';
  const hasGuest = rsvps.some(x => x.host_player_id === ME.id);
  const guestBtn = (my === 'in' && !closed && !hasGuest)
    ? '<p><button class="small" data-g="guest">+ Add a guest</button><br><small>A guest only gets in if a spot is open.</small></p>' : '';
  const adminCard = isAdmin ? `<div class="card"><h3>RSVP for someone</h3>
    <label>Player<select id="who">${players.filter(x => x.active).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
    <button class="small" data-g="admin" data-s="in">In</button>
    <button class="small" data-g="admin" data-s="maybe">Maybe</button>
    <button class="small" data-g="admin" data-s="out">Out</button></div>` : '';

  show(`<main>
    ${banner}
    <div class="card">
      <h2>${f
