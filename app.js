const DATA = 'https://raw.githubusercontent.com/chemo77047/olivia-tv/main/data/';
const WIN = 7200, STEP = 1800, HIDE_FAILED = 3 * 86400;
const SECTIONS = [['fav', 'Favorites'], ['recent', 'Recently watched'], ['kids', 'Kids'], ['mx', 'México'], ['es', 'Español (US)'], ['us', 'US'], ['all', 'All Channels']];
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('otv_' + k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('otv_' + k, JSON.stringify(v)); } catch (e) {} }
};
const now = () => Math.floor(Date.now() / 1000);
const fold = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const hm = t => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let all = [], byId = {}, guide = {}, rows = [], section = store.get('section', 'all'), query = '';
let favs = store.get('favs', {}), recent = store.get('recent', []), failed = store.get('failed', {}), best = store.get('best', {});
let ws = 0, row = 0, prog = -1, mode = 'guide';
let hls = null, token = 0, onCh = -1, playing = false, pvTimer = 0, bannerTimer = 0, toastTimer = 0;
let playIdx = -1, prevIdx = -1, skips = 0;
const video = $('#video');

function progs(c) { return guide[c.id] || []; }
function progAt(c, t) { return progs(c).find(p => p[0] <= t && p[1] > t); }
function winProgs(c) { const we = ws + WIN; return progs(c).filter(p => p[1] > ws && p[0] < we); }

async function load() {
  const [ch, g] = await Promise.all([
    fetch(DATA + 'channels.json', { cache: 'no-cache' }).then(r => r.json()),
    fetch(DATA + 'roku_guide.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({ ch: {} }))
  ]);
  guide = g.ch || {};
  ch.forEach((c, i) => {
    c.num = i + 1;
    c.web = c.streams.filter(s => s.u.startsWith('https://')).sort((a, b) => (a.ua || a.ref ? 1 : 0) - (b.ua || b.ref ? 1 : 0));
  });
  all = ch.filter(c => c.web.length);
  all.forEach(c => byId[c.id] = c);
  $('#loading').remove();
  drawTabs();
  build();
}

function drawTabs() {
  $('#tabs').innerHTML = SECTIONS.map(([k, n]) => `<button data-s="${k}" class="${k === section ? 'on' : ''}">${n}</button>`).join('');
}

function include(c, t) {
  const f = failed[c.id];
  if (f && t - f < HIDE_FAILED) return false;
  if (section === 'fav') return !!favs[c.id];
  if (section === 'kids') return !!c.kids;
  if (section === 'mx' || section === 'es' || section === 'us') return c.section === section;
  if (section === 'search') return query !== '' && (fold(c.name).includes(query) || progs(c).some(p => p[1] > t && p[0] < t + 43200 && fold(p[2]).includes(query)));
  return true;
}

function build(keepRow) {
  const t = now();
  rows = section === 'recent' ? recent.map(id => byId[id]).filter(Boolean) : all.filter(c => include(c, t));
  ws = t - (t % STEP);
  if (!keepRow) row = 0;
  row = Math.min(row, Math.max(rows.length - 1, 0));
  prog = firstProg();
  render();
  $('#guide').scrollTop = 0;
  focusMoved(true);
}

function firstProg() {
  const c = rows[row]; if (!c) return -1;
  const arr = winProgs(c), t = Math.max(now(), ws);
  const i = arr.findIndex(p => p[0] <= t && p[1] > t);
  return i >= 0 ? i : (arr.length ? 0 : -1);
}

function render() {
  const tr = $('#timeRow');
  let h = '';
  for (let i = 0; i < WIN / STEP; i++) h += `<span style="left:${i * STEP / WIN * 100}%">${hm(ws + i * STEP)}</span>`;
  const t = now();
  if (t >= ws && t < ws + WIN) h += `<div id="nowLine" style="left:${(t - ws) / WIN * 100}%"></div>`;
  tr.innerHTML = h;
  const empty = { fav: 'No favorites yet. Pick a channel and press Favorite.', recent: 'No channels watched yet.', search: 'No channels or shows found.' };
  $('#empty').textContent = rows.length ? '' : (empty[section] || 'No channels.');
  const we = ws + WIN;
  $('#rows').innerHTML = rows.map((c, r) => {
    const arr = winProgs(c);
    let cells = arr.map((p, i) => {
      const s = Math.max(p[0], ws), e = Math.min(p[1], we);
      const cls = p[0] <= t && p[1] > t ? ' now' : '';
      return `<div class="cell${cls}" data-r="${r}" data-p="${i}" style="left:${(s - ws) / WIN * 100}%;width:${(e - s) / WIN * 100}%"><span>${esc(p[2])}</span></div>`;
    }).join('');
    if (!arr.length) cells = `<div class="cell" data-r="${r}" data-p="-1" style="left:0;width:100%"><span>${esc(c.name)}</span></div>`;
    return `<div class="row" data-r="${r}"><div class="chan" data-r="${r}">${c.logo ? `<img loading="lazy" src="${esc(c.logo)}" alt="" onerror="this.style.visibility='hidden'">` : ''}<span class="nm">${c.num}&nbsp; ${esc(c.name)}</span>${favs[c.id] ? '<span class="star">&#9733;</span>' : ''}</div><div class="progs">${cells}</div></div>`;
  }).join('');
}

function focusInfo() {
  const c = rows[row];
  if (!c) return { c: null, p: null };
  const arr = winProgs(c);
  return { c, p: prog >= 0 && prog < arr.length ? arr[prog] : null };
}

function focusMoved(scroll) {
  document.querySelectorAll('.cell.focus,.row.cur').forEach(e => e.classList.remove('focus', 'cur'));
  const rEl = document.querySelector(`.row[data-r="${row}"]`);
  if (rEl) {
    rEl.classList.add('cur');
    const cell = rEl.querySelector(`.cell[data-p="${prog}"]`);
    if (cell) cell.classList.add('focus');
    if (scroll) rEl.scrollIntoView({ block: 'nearest' });
  }
  const { c, p } = focusInfo();
  if (!c) { $('#sTitle').textContent = ''; $('#sTime').textContent = ''; $('#sDesc').textContent = ''; return; }
  $('#sTitle').textContent = p ? p[2] : c.name;
  $('#sTime').textContent = c.num + '  ' + c.name + (p ? '   ' + hm(p[0]) + ' - ' + hm(p[1]) : '');
  $('#sDesc').textContent = p ? (p[3] || '') : '';
  $('#btnFav').textContent = favs[c.id] ? 'Remove Favorite' : 'Favorite';
  schedulePreview(c);
}

function schedulePreview(c) {
  clearTimeout(pvTimer);
  if (mode !== 'guide' || all.indexOf(c) === onCh) return;
  pvTimer = setTimeout(() => startChannel(all.indexOf(c), true), 1200);
}

function streamOrder(c) {
  const order = c.web.map((_, i) => i);
  const b = best[c.id];
  if (b != null && b < order.length) { order.splice(b, 1); order.unshift(b); }
  return order.slice(0, 3);
}

function stopVideo() {
  token++;
  if (hls) { hls.destroy(); hls = null; }
  video.removeAttribute('src'); video.load();
  onCh = -1; playing = false;
}

function startChannel(i, preview) {
  stopVideo();
  const c = all[i]; if (!c) return;
  onCh = i;
  $('#pvLabel').textContent = 'Loading preview...';
  tryStream(c, streamOrder(c), 0, preview);
}

function tryStream(c, order, k, preview) {
  const my = ++token;
  if (k >= order.length) { onDead(c, preview); return; }
  const s = c.web[order[k]];
  let done = false;
  const fail = () => { if (done || my !== token) return; done = true; clearTimeout(to); if (hls) { hls.destroy(); hls = null; } tryStream(c, order, k + 1, preview); };
  const ok = () => {
    if (done || my !== token) return; done = true; clearTimeout(to);
    playing = true; $('#pvLabel').textContent = '';
    best[c.id] = order[k]; store.set('best', best);
    if (failed[c.id]) { delete failed[c.id]; store.set('failed', failed); }
    if (mode === 'player') { $('#status').textContent = ''; markWatched(c); skips = 0; }
  };
  const to = setTimeout(fail, 15000);
  video.onplaying = ok;
  video.onerror = fail;
  if (!/\.mp4(\?|$)/i.test(s.u) && window.Hls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true });
    hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) fail(); });
    hls.loadSource(s.u);
    hls.attachMedia(video);
  } else {
    video.src = s.u;
  }
  play();
}

function play() {
  video.muted = false;
  const p = video.play();
  if (p && p.catch) p.catch(() => { video.muted = true; video.play().catch(() => {}); });
}

function onDead(c, preview) {
  playing = false;
  $('#pvLabel').textContent = 'No preview.';
  if (!preview || mode === 'player') {
    failed[c.id] = now(); store.set('failed', failed);
    if (mode === 'player') {
      skips++;
      if (skips > 8) { $('#status').textContent = "These channels aren't working right now."; return; }
      showToast(c.name + " isn't working right now");
      tune(nextIdx(playIdx, skipDir), skipDir);
    }
  }
}

let skipDir = 1;
function nextIdx(i, d) {
  const list = rows.length ? rows : all;
  let pos = list.indexOf(all[i]);
  if (pos < 0) pos = 0;
  return all.indexOf(list[(pos + d + list.length) % list.length]);
}

function markWatched(c) {
  store.set('last', c.id);
  recent = [c.id].concat(recent.filter(id => id !== c.id)).slice(0, 10);
  store.set('recent', recent);
}

function openPlayer(i) {
  clearTimeout(pvTimer);
  mode = 'player';
  $('#player').hidden = false;
  video.classList.add('full');
  if (playIdx !== i && playIdx >= 0) prevIdx = playIdx;
  playIdx = i;
  showBanner();
  if (onCh === i && playing) { video.muted = false; markWatched(all[i]); $('#status').textContent = ''; }
  else { $('#status').textContent = 'Tuning...'; startChannel(i, false); }
}

function tune(i, d) {
  skipDir = d || 1;
  if (playIdx >= 0 && playIdx !== i) prevIdx = playIdx;
  playIdx = i;
  $('#status').textContent = 'Tuning...';
  showBanner();
  startChannel(i, false);
}

function closePlayer() {
  mode = 'guide';
  $('#player').hidden = true;
  video.classList.remove('full');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const r = rows.indexOf(all[playIdx]);
  if (r >= 0) { row = r; prog = firstProg(); }
  render();
  focusMoved(true);
}

function showBanner() {
  const c = all[playIdx]; if (!c) return;
  const t = now(), cur = progAt(c, t), nxt = cur ? progAt(c, cur[1]) : null;
  $('#bLogo').src = c.logo || '';
  $('#bName').textContent = c.num + '  ' + c.name + (favs[c.id] ? '  \u2605' : '');
  $('#bNow').textContent = cur ? 'Now: ' + cur[2] + '  (' + hm(cur[0]) + ' - ' + hm(cur[1]) + ')' : '';
  $('#bNext').textContent = nxt ? 'Next: ' + nxt[2] + '  ' + hm(nxt[0]) : '';
  $('#banner').classList.remove('hide');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $('#banner').classList.add('hide'), 5000);
}

function toggleFav(c) {
  if (!c) return;
  if (favs[c.id]) { delete favs[c.id]; showToast(c.name + ' removed from Favorites'); }
  else { favs[c.id] = true; showToast(c.name + ' added to Favorites'); }
  store.set('favs', favs);
  if (mode === 'player') showBanner();
  else { const sc = $('#guide').scrollTop; render(); $('#guide').scrollTop = sc; focusMoved(false); }
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 2500);
}

function activate() {
  const { c, p } = focusInfo(); if (!c) return;
  const t = now();
  if (!p || (p[0] <= t && p[1] > t)) openPlayer(all.indexOf(c));
  else openInfo(c, p);
}

let infoCh = null;
function openInfo(c, p) {
  infoCh = c; mode = 'info';
  $('#iTitle').textContent = p[2];
  $('#iChan').textContent = c.num + '  ' + c.name;
  const d = new Date(p[0] * 1000);
  $('#iTime').textContent = d.toLocaleDateString([], { weekday: 'long' }) + '  ' + hm(p[0]) + ' - ' + hm(p[1]);
  $('#iDesc').textContent = p[3] || '';
  $('#iFav').textContent = favs[c.id] ? 'Remove Favorite' : 'Add to Favorites';
  $('#info').hidden = false;
  $('#iWatch').focus();
}
function closeInfo() { $('#info').hidden = true; mode = 'guide'; }

function moveRow(d) {
  if (!rows.length) return;
  const t = focusInfo().p;
  const ref = t ? Math.max(t[0], ws) : Math.max(now(), ws);
  row = Math.max(0, Math.min(rows.length - 1, row + d));
  const arr = winProgs(rows[row]);
  const i = arr.findIndex(p => p[0] <= ref && p[1] > ref);
  prog = i >= 0 ? i : (arr.length ? 0 : -1);
  focusMoved(true);
}

function moveProg(d) {
  const c = rows[row]; if (!c) return;
  const arr = winProgs(c);
  if (prog + d >= 0 && prog + d < arr.length) { prog += d; focusMoved(false); return; }
  const t = now(), minWs = t - (t % STEP);
  const nws = ws + d * STEP;
  if (nws < minWs || nws > minWs + 86400) return;
  const cur = focusInfo().p;
  ws = nws;
  const sc = $('#guide').scrollTop;
  render();
  $('#guide').scrollTop = sc;
  const na = winProgs(c);
  if (cur) { const i = na.findIndex(p => p[0] === cur[0]); prog = i >= 0 ? Math.max(0, Math.min(na.length - 1, i + d)) : (na.length ? 0 : -1); }
  else prog = na.length ? 0 : -1;
  focusMoved(false);
}

function playPrev() {
  if (prevIdx < 0) return;
  if (mode === 'player') tune(prevIdx, 1); else openPlayer(prevIdx);
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key;
  if (mode === 'info') {
    if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack') { closeInfo(); e.preventDefault(); }
    return;
  }
  if (mode === 'player') {
    const map = {
      ArrowUp: () => tune(nextIdx(playIdx, -1), -1), ChannelUp: () => tune(nextIdx(playIdx, -1), -1), PageUp: () => tune(nextIdx(playIdx, -1), -1),
      ArrowDown: () => tune(nextIdx(playIdx, 1), 1), ChannelDown: () => tune(nextIdx(playIdx, 1), 1), PageDown: () => tune(nextIdx(playIdx, 1), 1),
      Escape: closePlayer, Backspace: closePlayer, BrowserBack: closePlayer, g: closePlayer,
      Enter: showBanner, ' ': showBanner, f: () => toggleFav(all[playIdx]), MediaPlayPause: () => toggleFav(all[playIdx]),
      r: playPrev, MediaTrackPrevious: playPrev
    };
    if (map[k]) { map[k](); e.preventDefault(); }
    return;
  }
  const map = {
    ArrowUp: () => moveRow(-1), ArrowDown: () => moveRow(1), PageUp: () => moveRow(-7), PageDown: () => moveRow(7),
    ArrowLeft: () => moveProg(-1), ArrowRight: () => moveProg(1), Enter: activate,
    f: () => toggleFav(rows[row]), MediaPlayPause: () => toggleFav(rows[row]), r: playPrev, MediaTrackPrevious: playPrev,
    '/': () => $('#search').focus()
  };
  if (map[k]) { map[k](); e.preventDefault(); }
});

$('#rows').addEventListener('click', e => {
  const cell = e.target.closest('.cell'), chan = e.target.closest('.chan');
  if (!cell && !chan) return;
  const r = +(cell || chan).dataset.r;
  if (cell) {
    const p = +cell.dataset.p;
    if (r === row && p === prog) { activate(); return; }
    row = r; prog = p;
  } else {
    if (r === row) { openPlayer(all.indexOf(rows[r])); return; }
    row = r; prog = firstProg();
  }
  focusMoved(false);
});
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  section = b.dataset.s; store.set('section', section); $('#search').value = ''; drawTabs(); build();
});
$('#searchForm').addEventListener('submit', e => {
  e.preventDefault();
  query = fold($('#search').value.trim());
  if (!query) return;
  section = 'search'; drawTabs(); build(); $('#search').blur();
});
$('#btnWatch').onclick = () => { const c = rows[row]; if (c) openPlayer(all.indexOf(c)); };
$('#btnFav').onclick = () => toggleFav(rows[row]);
$('#prevWin').onclick = () => moveProg(-99);
$('#nextWin').onclick = () => moveProg(99);
$('#iWatch').onclick = () => { closeInfo(); openPlayer(all.indexOf(infoCh)); };
$('#iFav').onclick = () => { toggleFav(infoCh); $('#iFav').textContent = favs[infoCh.id] ? 'Remove Favorite' : 'Add to Favorites'; };
$('#iClose').onclick = closeInfo;
$('#info').addEventListener('click', e => { if (e.target.id === 'info') closeInfo(); });
document.querySelector('.bBtns').addEventListener('click', e => {
  const a = (e.target.closest('button') || {}).dataset; if (!a) return;
  ({
    up: () => tune(nextIdx(playIdx, -1), -1), down: () => tune(nextIdx(playIdx, 1), 1),
    fav: () => toggleFav(all[playIdx]), prev: playPrev, guide: closePlayer,
    fs: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})
  }[a.act] || (() => {}))();
});
$('#player').addEventListener('mousemove', showBanner);
video.addEventListener('click', () => { if (mode === 'player') showBanner(); else { const c = all[onCh]; if (c) openPlayer(onCh); } });

function tick() {
  $('#clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const t = now(), nl = $('#nowLine');
  if (nl) nl.style.left = (t - ws) / WIN * 100 + '%';
}
setInterval(tick, 15000); tick();

load().catch(() => { $('#loading').textContent = "Couldn't load channels. Check your internet and refresh."; });
