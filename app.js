import * as pdfjsLib from './pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';

const D = window.PILZ;
const A = D.arten;
const $main = document.getElementById('main');
const $title = document.getElementById('title');
let pdf = null;

/* ---------- Hilfen ---------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => String(s).toLowerCase().replace(/ß/g,'ss').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ');
const ESS = {essbar:'essbar', giftig:'giftig', toedlich:'tödlich giftig', ungeniessbar:'ungenießbar', unbekannt:'keine Angabe'};
const badge = x => `<span class="badge b-${x.ess}">${ESS[x.ess]}</span>` +
  (x.roh ? `<span class="badge b-giftig">roh giftig</span>` : '') +
  (x.rl ? `<span class="badge b-rl">Rote Liste ${x.rl}</span>` : '') +
  (x.heute ? `<span class="badge b-heute">heute giftig/bedenklich</span>` : '');
const keyPages = new Set(D.runs.flat());
const runOf = p => D.runs.find(r => r.includes(p));
const keyById = id => D.keys.find(k => k.id === id);
const byTextPage = {}; A.forEach(x => (byTextPage[x.pdf] ||= []).push(x));
const textPages = Object.keys(byTextPage).map(Number).sort((a,b)=>a-b);
const mentionedIn = {}; A.forEach(x => x.refs.forEach(r => (mentionedIn[r] ||= []).push(x.id)));
const nebenBei = {}; D.neben.forEach(n => n.bei.forEach(b => (nebenBei[b] ||= []).push(n)));

/* Merkliste */
const store = {
  get(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let merk = new Set(store.get('merk', []));
const toggleMerk = id => { merk.has(id) ? merk.delete(id) : merk.add(id); store.set('merk', [...merk]); };

/* ---------- PDF-Speicher (IndexedDB) ---------- */
function idb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('pilzbuch', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(){
  const db = await idb();
  return new Promise(res => { const q = db.transaction('files').objectStore('files').get('pdf'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
}
async function idbPut(blob){
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('files','readwrite'); t.objectStore('files').put(blob,'pdf'); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function openPdf(blob){
  const doc = await pdfjsLib.getDocument({data: new Uint8Array(await blob.arrayBuffer())}).promise;
  if (doc.numPages !== 362) throw new Error(`Das PDF hat ${doc.numPages} Seiten – erwartet sind 362 (Parey-Scan).`);
  return doc;
}

/* ---------- Seiten rendern ---------- */
const cache = new Map();
const baseWidth = () => Math.min(1500, Math.round(Math.min(innerWidth, 900) * (devicePixelRatio || 1)));
function renderPage(n, w = baseWidth()){
  const key = n + ':' + w;
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const p = (async () => {
    const page = await pdf.getPage(n);
    const vp1 = page.getViewport({scale: 1});
    const vp = page.getViewport({scale: w / vp1.width});
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({canvasContext: c.getContext('2d'), viewport: vp}).promise;
    return c;
  })();
  cache.set(key, p);
  while (cache.size > 14) cache.delete(cache.keys().next().value);
  return p;
}
async function paint(target, n, y0 = 0, y1 = 1, w){
  const src = await renderPage(n, w);
  const sy = Math.round(y0 * src.height), sh = Math.max(1, Math.round((y1 - y0) * src.height));
  target.width = src.width; target.height = sh;
  target.getContext('2d').drawImage(src, 0, sy, src.width, sh, 0, 0, src.width, sh);
}
function zoom(n, y0 = 0, y1 = 1){
  const z = document.getElementById('zoom');
  z.querySelectorAll('canvas').forEach(c => c.remove());
  const c = document.createElement('canvas'); z.appendChild(c); z.style.display = 'block'; z.scrollTo(0,0);
  paint(c, n, y0, y1, 1800);
  history.pushState({zoom:1}, '');
}
document.getElementById('zclose').onclick = () => history.back();
addEventListener('popstate', () => { const z = document.getElementById('zoom'); if (z.style.display === 'block') z.style.display = 'none'; });

/* ---------- Bausteine ---------- */
const item = x => `<li class="item"><a href="#/art/${x.id}"><div class="de">${esc(x.de)}</div><div class="lat">${esc(x.lat)}</div><div>${badge(x)}</div></a>
  <button class="star ${merk.has(x.id)?'on':''}" data-star="${x.id}" aria-label="Merken">${merk.has(x.id)?'★':'☆'}</button></li>`;
const list = xs => `<ul class="list">${xs.map(item).join('')}</ul>`;
function bindStars(root = $main){
  root.querySelectorAll('[data-star]').forEach(b => b.onclick = e => {
    e.preventDefault(); const id = +b.dataset.star; toggleMerk(id);
    b.classList.toggle('on', merk.has(id)); b.textContent = merk.has(id) ? '★' : '☆';
  });
}
const setView = (title, html) => { $title.textContent = title; $main.innerHTML = html; };

/* ---------- Ansichten ---------- */
function viewHome(){
  setView('Pilzbuch', `
    <input type="search" id="q" placeholder="Art suchen (deutsch oder lateinisch) …" autocomplete="off">
    <div id="res"></div>
    <div id="homebtns">
    <a class="btn primary" href="#/schluessel/1"><b>Bestimmen</b><small>Mit dem Bestimmungsschlüssel des Buchs, Schritt für Schritt</small></a>
    <a class="btn" href="#/schluessel"><b>Alle Schlüssel</b><small>Haupt- und Gruppenschlüssel direkt öffnen</small></a>
    <a class="btn" href="#/arten"><b>Alle Arten</b><small>${A.length} Arten nach Doppelseiten, mit Filtern</small></a>
    <a class="btn" href="#/merkliste"><b>Merkliste (${merk.size})</b><small>Deine Kandidaten zum Vergleichen</small></a>
    <div class="note">Speisewert und Rote Liste sind automatisch aus dem Buch (Stand 1988) erkannt. Maßgeblich ist der Originaltext. Manche damals essbaren Arten gelten heute als giftig. Vor dem Essen immer zur Pilzberatung.</div>
    <button class="btn" id="newpdf"><small>PDF neu auswählen</small></button>
    </div>`);
  const q = document.getElementById('q'), res = document.getElementById('res'), hb = document.getElementById('homebtns');
  q.oninput = () => {
    const v = q.value.trim();
    hb.style.display = v ? 'none' : '';
    res.innerHTML = v.length < 2 ? '' : searchHtml(v);
    bindStars(res);
  };
  document.getElementById('newpdf').onclick = pickPdf;
}
function searchHtml(v){
  const t = norm(v).split(/\s+/).filter(Boolean);
  const hit = s => t.every(w => s.includes(w));
  const xs = A.filter(x => hit(norm(x.de + ' ' + x.lat + ' ' + x.gruppe))).slice(0, 80);
  const ns = D.neben.filter(n => hit(norm((n.de || '') + ' ' + n.lat))).slice(0, 30);
  return (xs.length ? list(xs) : '<p class="tiny">Keine Hauptart gefunden.</p>') +
    (ns.length ? `<div class="sect">Nur in anderen Beschreibungen erwähnt</div><ul class="list">${ns.map(n => {
      const h = A[n.bei[0]];
      return `<li class="item"><a href="#/art/${h.id}"><div class="de">${esc(n.de || n.lat)}</div><div class="lat">${n.de ? esc(n.lat) + ' · ' : ''}erwähnt bei ${esc(h.de)}</div></a></li>`;
    }).join('')}</ul>` : '');
}

function viewKeyList(){
  setView('Bestimmungsschlüssel', D.keys.map(k =>
    `<a class="btn ${k.id===1?'primary':''}" href="#/schluessel/${k.id}"><b>${esc(k.label)}</b><small>ab Buchseite ${k.pdf - 1}</small></a>`).join(''));
}

let keyState = null; // {run, pages:{pdf:div}}
function viewKey(kid, n){
  const k = keyById(kid);
  if (!k) return viewKeyList();
  let target = n && k.a[n] ? k.a[n] : null;
  if (n && !target) { // nächstkleinerer Punkt
    const lower = Object.keys(k.a).map(Number).filter(m => m < +n).sort((a,b)=>b-a)[0];
    if (lower) target = k.a[lower];
  }
  if (!target) target = [k.pdf, k.y];
  showRun(target[0], target[1], k.label + (n ? ` · ${n}` : ''));
}
function showRun(p, y, title){
  const run = runOf(p);
  $title.textContent = title;
  if (!keyState || keyState.run !== run || !document.body.contains(keyState.root)) {
    $main.innerHTML = `<div class="tiny" style="margin-bottom:8px">Blaue Flächen antippen: Nummern springen im Schlüssel, Seitenzahlen öffnen die Arten.</div><div id="kr"></div>`;
    const root = document.getElementById('kr');
    const pages = {};
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { fill(e.target); io.unobserve(e.target); } }), {rootMargin: '600px'});
    for (const q of run) {
      const d = document.createElement('div'); d.className = 'pg'; d.dataset.p = q;
      d.innerHTML = `<span class="lbl">S. ${q - 1}</span>`;
      root.appendChild(d); pages[q] = d; io.observe(d);
    }
    keyState = {run, pages, root};
  }
  const d = keyState.pages[p];
  requestAnimationFrame(() => {
    const top = d.getBoundingClientRect().top + scrollY + y * d.offsetHeight - 70;
    scrollTo(0, Math.max(0, top));
    if (y > 0.01) { const f = document.createElement('div'); f.className = 'flash'; f.style.top = (y * 100) + '%'; d.appendChild(f); setTimeout(() => f.remove(), 2600); }
  });
}
async function fill(d){
  const p = +d.dataset.p;
  const c = document.createElement('canvas'); d.prepend(c);
  await paint(c, p);
  for (const h of D.hot[p] || []) {
    const b = document.createElement('button'); b.className = 'hs';
    const [x0,y0,x1,y1] = h.b, pad = 0.004;
    Object.assign(b.style, {left: (x0-pad)*100+'%', top: (y0-pad)*100+'%', width: (x1-x0+2*pad)*100+'%', height: (y1-y0+2*pad)*100+'%'});
    if (h.pg) { b.setAttribute('aria-label', 'Seite ' + h.pg); b.onclick = () => location.hash = `#/seite/${h.pg}`; }
    else { b.setAttribute('aria-label', 'Weiter zu ' + h.n); b.onclick = () => location.hash = `#/schluessel/${h.k}/${h.n}`; }
    d.appendChild(b);
  }
}

function spreadOf(buch){
  const p = buch + 1;
  return p % 2 ? p : p - 1; // Textseite (ungerade PDF-Seite)
}
function viewSeite(buch){
  const p = buch + 1;
  if (keyPages.has(p)) {
    const k = [...D.keys].filter(k => runOf(k.pdf) === runOf(p) && (k.pdf < p || (k.pdf === p && k.y < 0.5))).pop() || D.keys.find(k => runOf(k.pdf) === runOf(p));
    return showRun(p, 0, (k ? k.label : 'Schlüssel') + ` · S. ${buch}`);
  }
  let t = spreadOf(buch);
  if (!byTextPage[t]) t = textPages.find(q => q >= t) ?? textPages[textPages.length - 1];
  viewSpread(t);
}
function viewSpread(t){
  const xs = byTextPage[t] || [];
  const i = textPages.indexOf(t), prev = textPages[i-1], next = textPages[i+1];
  setView(`S. ${t-1}–${t} · ${xs[0]?.gruppe || ''}`, `
    <div class="sect">Mögliche Arten auf dieser Doppelseite (${xs.length})</div>
    ${list(xs)}
    <div class="sect">Tafel S. ${t} <span class="tiny">– antippen zum Vergrößern</span></div>
    <div class="plate" id="pl"><canvas></canvas></div>
    <div class="row">${prev ? `<a class="btn" href="#/doppelseite/${prev}">‹ S. ${prev-1}</a>` : ''}
      <a class="btn" href="#/textseite/${t}">Ganze Textseite</a>
      ${next ? `<a class="btn" href="#/doppelseite/${next}">S. ${next-1} ›</a>` : ''}</div>`);
  bindStars();
  const pl = document.getElementById('pl');
  paint(pl.querySelector('canvas'), t + 1); pl.onclick = () => zoom(t + 1);
}
function viewTextPage(t){
  setView(`Textseite S. ${t-1}`, `<div class="plate" id="tp"><canvas></canvas></div><a class="btn" href="#/doppelseite/${t}">Zur Doppelseite</a>`);
  const tp = document.getElementById('tp'); paint(tp.querySelector('canvas'), t); tp.onclick = () => zoom(t);
}

function viewArt(id){
  const x = A[id];
  if (!x) return viewHome();
  const refs = x.refs.map(i => A[i]);
  const back = (mentionedIn[id] || []).filter(i => !x.refs.includes(i)).map(i => A[i]);
  const same = (byTextPage[x.pdf] || []).filter(y => y.id !== id);
  const neb = nebenBei[id] || [];
  setView(x.de.split(',')[0], `
    <div class="item" style="display:block"><div class="de" style="font-size:20px">${esc(x.de)}</div>
      <div class="lat">${esc(x.lat)} · Buchseite ${x.buch}</div><div style="margin-top:6px">${badge(x)}</div></div>
    ${x.heute ? `<div class="warn">⚠ ${esc(x.heute)}</div>` : ''}
    <div class="row"><button class="btn" id="mk">${merk.has(id) ? '★ Gemerkt' : '☆ Merken'}</button>
      <a class="btn" href="#/doppelseite/${x.pdf}">Doppelseite</a></div>
    <div class="sect">Beschreibung im Buch <span class="tiny">– antippen zum Vergrößern</span></div>
    <div class="crop" id="cr"><canvas></canvas></div>
    <div class="sect">Tafel S. ${x.tafel - 1}</div>
    <div class="plate" id="pl"><canvas></canvas></div>
    ${refs.length ? `<div class="sect">Im Text genannt – Verwechslung/Vergleich</div>${list(refs)}` : ''}
    ${back.length ? `<div class="sect">Wird erwähnt bei</div>${list(back)}` : ''}
    ${neb.length ? `<div class="sect">Hier erwähnte weitere Arten</div><div class="note">${neb.map(n => `<i>${esc(n.lat)}</i>${n.de ? ' – ' + esc(n.de) : ''}`).join('<br>')}</div>` : ''}
    ${same.length ? `<div class="sect">Auf derselben Doppelseite</div>${list(same)}` : ''}
    <div class="note">Speisewert automatisch erkannt (Buchstand 1988). Maßgeblich ist die Beschreibung oben. Vor dem Essen: Pilzberatung.</div>`);
  bindStars();
  const mk = document.getElementById('mk');
  mk.onclick = () => { toggleMerk(id); mk.textContent = merk.has(id) ? '★ Gemerkt' : '☆ Merken'; };
  const cr = document.getElementById('cr'), pl = document.getElementById('pl');
  paint(cr.querySelector('canvas'), x.pdf, x.y0, x.y1); cr.onclick = () => zoom(x.pdf, x.y0, x.y1);
  paint(pl.querySelector('canvas'), x.tafel); pl.onclick = () => zoom(x.tafel);
}

let filt = store.get('filt', {ess: 'alle', rl: false});
function viewArten(){
  const F = [['alle','Alle'],['essbar','essbar'],['giftig','giftig'],['toedlich','tödlich'],['ungeniessbar','ungenießbar'],['unbekannt','k. A.']];
  setView('Alle Arten', `
    <input type="search" id="q" placeholder="Filtern …" autocomplete="off">
    <div class="chips">${F.map(([k,l]) => `<button class="chip ${filt.ess===k?'on':''}" data-f="${k}">${l}</button>`).join('')}
      <button class="chip ${filt.rl?'on':''}" data-rl>Rote Liste</button></div>
    <div id="al"></div>`);
  const q = document.getElementById('q');
  const draw = () => {
    const t = norm(q.value).split(/\s+/).filter(Boolean);
    let html = '', n = 0;
    for (const p of textPages) {
      const xs = byTextPage[p].filter(x => (filt.ess === 'alle' || x.ess === filt.ess || (filt.ess === 'giftig' && x.ess === 'toedlich')) && (!filt.rl || x.rl)
        && t.every(w => norm(x.de + ' ' + x.lat + ' ' + x.gruppe).includes(w)));
      if (!xs.length) continue; n += xs.length;
      html += `<h2><a href="#/doppelseite/${p}">S. ${p-1} · ${esc(xs[0].gruppe)}</a></h2>` + list(xs);
    }
    document.getElementById('al').innerHTML = `<div class="tiny">${n} Arten</div>` + html;
    bindStars();
  };
  $main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filt.ess = b.dataset.f; store.set('filt', filt); viewArten(); });
  $main.querySelector('[data-rl]').onclick = () => { filt.rl = !filt.rl; store.set('filt', filt); viewArten(); };
  q.oninput = draw; draw();
}

function viewMerk(){
  const xs = [...merk].map(i => A[i]).filter(Boolean);
  setView('Merkliste', xs.length ? `${list(xs)}<button class="btn" id="clr"><small>Merkliste leeren</small></button>` :
    `<div class="note">Noch nichts gemerkt. Tippe bei einer Art auf ☆, um sie als Kandidaten zu sammeln.</div>`);
  bindStars();
  const c = document.getElementById('clr');
  if (c) c.onclick = () => { merk.clear(); store.set('merk', []); viewMerk(); };
}

/* ---------- Router ---------- */
function route(){
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (h[0] !== 'schluessel' || !h[1]) keyState = null;
  switch (h[0]) {
    case 'schluessel': return h[1] ? viewKey(+h[1], h[2]) : viewKeyList();
    case 'seite': return viewSeite(+h[1]);
    case 'doppelseite': return viewSpread(+h[1]);
    case 'textseite': return viewTextPage(+h[1]);
    case 'art': return viewArt(+h[1]);
    case 'arten': return viewArten();
    case 'merkliste': return viewMerk();
    default: return viewHome();
  }
}
let lastRoute = '';
addEventListener('hashchange', () => {
  const sameKeyRun = location.hash.startsWith('#/schluessel/') && lastRoute.startsWith('#/schluessel/');
  lastRoute = location.hash; route();
  if (!sameKeyRun && !location.hash.startsWith('#/schluessel/')) scrollTo(0, 0);
});
document.getElementById('back').onclick = () => history.length > 1 ? history.back() : (location.hash = '#/');
document.getElementById('home').onclick = () => location.hash = '#/';

/* ---------- Start ---------- */
function pickPdf(){
  setView('PDF auswählen', `
    <div class="note" style="font-size:15px">Wähle einmalig dein PDF <b>„Pareys Buch der Pilze“</b> aus. Die App speichert es nur hier im Browser auf diesem Gerät. Nichts wird hochgeladen. Danach funktioniert alles offline.</div>
    <label class="btn primary" style="text-align:center"><b>PDF auswählen</b><input type="file" id="f" accept="application/pdf,.pdf" hidden></label>
    <div id="st" class="tiny"></div>`);
  document.getElementById('f').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const st = document.getElementById('st');
    st.innerHTML = '<div class="spinner"></div>Prüfe und speichere …';
    try {
      pdf = await openPdf(f);
      cache.clear();
      await idbPut(f);
      try { await navigator.storage?.persist?.(); } catch {}
      location.hash = '#/'; route();
    } catch (err) { st.textContent = 'Fehler: ' + err.message; }
  };
}
async function start(){
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const blob = await idbGet();
    if (blob) { pdf = await openPdf(blob); lastRoute = location.hash; return route(); }
  } catch (e) { console.warn(e); }
  pickPdf();
}
start();
