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
  go('game');
}

function go(tab) {
  CUR = tab;
  const tabs = [['game', 'Game'], ['me', 'Me']];
  if (ME.role === 'admin') tabs.push(['admin', 'Admin']);
  nav.innerHTML = tabs.map(t =>
    `<button data-t="${t[0]}" style="${t[0] === tab ? 'background:var(--orange)' : ''}">${t[1]}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => { b.onclick = () => go(b.dataset.t); });
  if (tab === 'game') renderGame();
  else if (tab === 'me') renderMe();
  else renderAdmin();
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
    const fresh = await sb.from('players').select('*').eq('id', ME.id).single();
    if (fresh.data) ME = fresh.data;
    renderMe();
  };
}

start();
