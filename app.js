const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById('app');
const nav = document.getElementById('nav');
let ME = null, UID = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show = html => { app.innerHTML = html; };
const msg = t => '<main><div class="card">' + esc(t) + '</div></main>';

async function start() {
  const token = new URLSearchParams(location.search).get('invite');
  let { data: { session } } = await sb.auth.getSession();
  if (!session) {
    if (!token) return show(msg('Open your personal invite link to get in.'));
    const r = await sb.auth.signInAnonymously();
    if (r.error) return show(msg('Could not sign in. Please try again.'));
    session = r.data.session;
  }
  if (token) {
    const { error } = await sb.rpc('redeem_invite', { p_token: token });
    history.replaceState(null, '', location.pathname);
    if (error) return show(msg('That invite link is not valid. Ask your organizer for a new one.'));
  }
  const { data: me } = await sb.from('players').select('*').eq('auth_user_id', session.user.id).maybeSingle();
  if (!me) return show(msg('This device is not signed in. Open your invite link again.'));
  ME = me; UID = session.user.id;
  buildNav();
  renderMe();
}

function buildNav() {
  if (ME.role !== 'admin') { nav.innerHTML = ''; return; }
  nav.innerHTML = '<button data-t="me">Me</button><button data-t="admin">Admin</button>';
  nav.querySelectorAll('button').forEach(b => {
    b.onclick = () => (b.dataset.t === 'admin' ? renderAdmin() : renderMe());
  });
}

function resize(file, max) {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? ok(b) : bad(new Error('resize failed')), 'image/jpeg', 0.85);
    };
    img.onerror = bad;
    img.src = URL.createObjectURL(file);
  });
}

function renderMe() {
  const me = ME;
  show(`<main>
    <div class="card">
      ${me.photo_url ? `<img class="avatar" src="${esc(me.photo_url)}" alt="">` : ''}
      <h2>${esc(me.name)}${me.nickname ? ' “' + esc(me.nickname) + '”' : ''}</h2>
      <p>Age ${me.age ?? '?'} · Height ${esc(me.height || '?')}</p>
    </div>
    <form id="f" class="card">
      <h3>Your profile</h3>
      <label>Name<input name="name" required value="${esc(me.name)}"></label>
      <label>Nickname<input name="nickname" value="${esc(me.nickname)}"></label>
      <label>Age (optional)<input name="age" type="number" min="10" max="99" value="${esc(me.age)}"></label>
      <label>Height (optional)<input name="height" placeholder="5'11&quot;" value="${esc(me.height)}"></label>
      <label>Photo (optional)<input type="file" id="photo" accept="image/*"></label>
      <button>Save</button>
      <p id="status"></p>
    </form></main>`);
  const f = document.getElementById('f');
  f.onsubmit = async e => {
    e.preventDefault();
    const st = document.getElementById('status');
    st.textContent = 'Saving…';
    let photo = me.photo_url;
    const file = document.getElementById('photo').files[0];
    if (file) {
      try {
        const blob = await resize(file, 400);
        const path = UID + '/' + Date.now() + '.jpg';
        const up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        photo = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      } catch (err) { st.textContent = 'Photo upload failed.'; return; }
    }
    const fd = new FormData(f);
    const age = parseInt(fd.get('age'), 10);
    const { error } = await sb.rpc('update_my_profile', {
      p_name: fd.get('name').trim(),
      p_nickname: fd.get('nickname').trim() || null,
      p_photo_url: photo,
      p_age: isNaN(age) ? null : age,
      p_height: fd.get('height').trim() || null
    });
    if (error) { st.textContent = 'Could not save.'; return; }
    start();
  };
}

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

start();
