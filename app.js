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
Object.values(byTextPage).forEach(xs => xs.sort((a, b) => a.y0 - b.y0));
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
let dbP = null;
function idb(){
  return dbP ||= new Promise((res, rej) => {
    const r = indexedDB.open('pilzbuch', 2);
    r.onupgradeneeded = () => { for (const s of ['files', 'funde', 'fotos']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function dbAll(s){
  const db = await idb();
  return new Promise(res => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); });
}
async function dbGet(s, k){
  const db = await idb();
  return new Promise(res => { const q = db.transaction(s).objectStore(s).get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
}
async function dbPut(s, k, v){
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction(s, 'readwrite'); t.objectStore(s).put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function dbDel(s, k){
  const db = await idb();
  return new Promise(res => { const t = db.transaction(s, 'readwrite'); t.objectStore(s).delete(k); t.oncomplete = res; t.onerror = res; });
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
let userTh = store.get('userth', {});
const thumbOf = id => userTh[id] || D.th[id];
const item = x => `<li class="item"><a href="#/art/${x.id}" class="thl">${thumbOf(x.id) ? `<canvas class="th" data-t="${x.id}" width="112" height="112"></canvas>` : '<span class="th"></span>'}
  <span class="txt"><div class="de">${esc(x.de)}</div><div class="lat">${esc(x.lat)}</div><div>${badge(x)}</div></span></a>
  <button class="star ${merk.has(x.id)?'on':''}" data-star="${x.id}" aria-label="Merken">${merk.has(x.id)?'★':'☆'}</button></li>`;
const list = xs => `<ul class="list">${xs.map(item).join('')}</ul>`;
/* Vorschaubilder: Ausschnitt der Tafel aus dem eigenen PDF */
const thumbIO = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { thumbIO.unobserve(e.target); drawThumb(e.target); }
}), {rootMargin: '400px'});
async function drawThumb(c){
  const t = thumbOf(c.dataset.t); if (!t) return;
  const [p, x0, y0, x1, y1] = t;
  const src = await renderPage(p, 560);
  const sx = x0 * src.width, sy = y0 * src.height, sw = (x1 - x0) * src.width, sh = (y1 - y0) * src.height;
  const S = c.width, ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
  const k = Math.min(S / sw, S / sh), dw = sw * k, dh = sh * k;
  ctx.drawImage(src, sx, sy, sw, sh, (S - dw) / 2, (S - dh) / 2, dw, dh);
}
function bindStars(root = $main){
  root.querySelectorAll('canvas.th:not([data-o])').forEach(c => { c.dataset.o = 1; thumbIO.observe(c); });
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
    <a class="btn" href="#/blaettern/${store.get('lastpage', 1)}"><b>Im Buch blättern</b><small>Alle Seiten mit Verlinkungen – weiter bei S. ${Math.max(0, store.get('lastpage', 1) - 1)}</small></a>
    <a class="btn" href="#/merkmale"><b>Nach Merkmalen filtern</b><small>Hutfarbe, Unterseite, Geruch, Baum, Lebensraum …</small></a>
    <a class="btn" href="#/arten"><b>Alle Arten</b><small>${A.length} Arten nach Doppelseiten, mit Filtern</small></a>
    <a class="btn" href="#/merkliste"><b>Merkliste (${merk.size})</b><small>Deine Kandidaten zum Vergleichen</small></a>
    <a class="btn" href="#/funde"><b>Meine Funde</b><small>Fundorte mit Datum, GPS, Notiz und Foto – nur auf diesem Gerät</small></a>
    <div class="note">Speisewert und Rote Liste sind automatisch aus dem Buch (Stand 1988) erkannt. Maßgeblich ist der Originaltext. Manche damals essbaren Arten gelten heute als giftig. Vor dem Essen immer zur Pilzberatung.</div>
    <a class="btn" href="#/sicherung"><small>Sicherung: Funde und eigene Vorschaubilder exportieren/importieren</small></a>
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
  for (const h of D.ment[p] || []) {
    const b = document.createElement('button'); b.className = 'hs ment';
    const [x0,y0,x1,y1] = h.b;
    Object.assign(b.style, {left: (x0-.004)*100+'%', top: (y0-.004)*100+'%', width: (x1-x0+.008)*100+'%', height: (y1-y0+.008)*100+'%'});
    b.setAttribute('aria-label', A[h.a].de); b.onclick = () => location.hash = `#/art/${h.a}`;
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
      <a class="btn" href="#/blaettern/${t}">Im Buch blättern</a>
      ${next ? `<a class="btn" href="#/doppelseite/${next}">S. ${next-1} ›</a>` : ''}</div>`);
  bindStars();
  const pl = document.getElementById('pl');
  const plc = pl.querySelector('canvas');
  pl.style.position = 'relative';
  paint(plc, t + 1); pl.onclick = e => {
    if (e.target.closest('.chipfig')) return;
    const id = figHit(t + 1, e, plc);
    if (id < 0) return zoom(t + 1);
    const c = figChip(pl, e, id, ` <button class="zb" aria-label="Vergrößern">🔍</button>`);
    c.querySelector('.zb').onclick = ev => { ev.stopPropagation(); zoom(t + 1); };
  };
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
      <a class="btn" href="#/doppelseite/${x.pdf}">Doppelseite</a>
      <a class="btn" href="#/blaettern/${x.pdf}/${x.y0}">Im Buch</a></div>
    ${merkmaleHtml(x)}
    <div class="sect">Beschreibung im Buch <span class="tiny">– antippen zum Vergrößern</span></div>
    <div class="crop" id="cr"><canvas></canvas></div>
    <div class="sect">Tafel S. ${x.tafel - 1}</div>
    <div class="plate" id="pl"><canvas></canvas></div>
    <div class="row">${thumbOf(id) ? `<canvas class="th" data-t="${id}" width="112" height="112" style="width:56px;height:56px;border-radius:8px;border:1px solid var(--line);flex:none"></canvas>` : ''}
      <a class="btn" href="#/bild/${id}">${thumbOf(id) ? 'Vorschaubild ändern' : 'Vorschaubild festlegen'}</a></div>
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
  const fs = document.createElement('div');
  $main.querySelector('#mk').closest('.row').after(fs);
  dbAll('funde').then(all => {
    const mine = all.filter(f => f.art === id).sort((a, b) => b.datum.localeCompare(a.datum));
    fs.innerHTML = `<div class="sect">Meine Funde (${mine.length})</div>${fundList(mine, false)}
      <a class="btn" href="#/fund/neu/${id}" style="text-align:center">＋ Fund dieser Art speichern</a>`;
    bindFundThumbs(fs);
  });
}

/* ---------- Funde ---------- */
const fmtDate = d => d ? d.split('-').reverse().join('.') : '';
const fundList = (fs, showArt = true) => fs.length ? `<ul class="list">${fs.map(f => `<li class="item"><a href="#/fund/${f.id}" class="thl">
  ${f.foto ? `<img class="th" data-foto="${f.id}" alt="">` : '<span class="th" style="display:flex;align-items:center;justify-content:center;font-size:22px">📍</span>'}
  <span class="txt"><div class="de">${showArt ? esc(f.art != null ? A[f.art]?.de.split(',')[0] : 'Noch unbestimmt') : fmtDate(f.datum)}</div>
  <div class="lat">${showArt ? fmtDate(f.datum) + ' · ' : ''}${esc(f.ort || (f.lat != null ? `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}` : 'ohne Ort'))}</div>
  ${f.notiz ? `<div class="tiny">${esc(f.notiz.slice(0, 80))}</div>` : ''}</span></a></li>`).join('')}</ul>` : '';
function bindFundThumbs(root = $main){
  root.querySelectorAll('img[data-foto]').forEach(async img => {
    const b = await dbGet('fotos', img.dataset.foto);
    if (b) { img.src = URL.createObjectURL(b); img.style.objectFit = 'cover'; }
  });
}
async function viewFunde(){
  setView('Meine Funde', '<div class="loading"><div class="spinner"></div></div>');
  const all = (await dbAll('funde')).sort((a, b) => b.datum.localeCompare(a.datum) || b.created - a.created);
  if (!location.hash.startsWith('#/funde')) return;
  setView('Meine Funde', `
    <a class="btn primary" href="#/fund/neu" style="text-align:center"><b>＋ Neuer Fund</b></a>
    ${all.length ? fundList(all) : '<div class="note">Noch keine Funde gespeichert. Du kannst einen Fund hier oder direkt bei einer Art anlegen.</div>'}
    <div class="note">Funde und Fotos liegen nur in diesem Browser auf diesem Gerät. Über „Sicherung“ auf dem Startbildschirm kannst du sie exportieren.</div>`);
  bindFundThumbs();
}
async function resizePhoto(file, max = 1400){
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}
async function viewFund(fid, artId){
  const isNew = fid === 'neu';
  const f = isNew ? {id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), art: Number.isFinite(artId) ? artId : null,
    datum: new Date().toISOString().slice(0, 10), lat: null, lon: null, acc: null, ort: '', notiz: '', foto: false, created: Date.now()}
    : await dbGet('funde', fid);
  if (!f) return viewFunde();
  let fotoBlob = f.foto ? await dbGet('fotos', f.id) : null;
  setView(isNew ? 'Neuer Fund' : 'Fund bearbeiten', `
    <div class="sect">Art</div>
    <div id="artsel" class="item" style="display:block"></div>
    <input type="search" id="artq" placeholder="Art suchen oder ändern …" autocomplete="off">
    <div id="artres"></div>
    <div class="sect">Datum</div>
    <input type="date" id="datum" value="${f.datum}" class="inp">
    <div class="sect">Ort</div>
    <div class="row"><button class="btn" id="gps">📍 Aktuellen Standort übernehmen</button></div>
    <div id="gpsinfo" class="tiny"></div>
    <input type="text" id="ort" placeholder="Ortsbeschreibung, z. B. Dölauer Heide, Nordrand" value="${esc(f.ort)}" class="inp">
    <div class="sect">Notiz</div>
    <textarea id="notiz" rows="4" class="inp" placeholder="Bäume in der Nähe, Geruch, Anzahl, Bestimmungsunsicherheit …">${esc(f.notiz)}</textarea>
    <div class="sect">Foto</div>
    <img id="fimg" style="max-width:100%;border-radius:10px;display:none">
    <div class="row"><label class="btn" style="text-align:center">📷 Foto aufnehmen/wählen<input type="file" id="foto" accept="image/*" capture="environment" hidden></label>
      <button class="btn" id="fotodel" style="display:none">Foto entfernen</button></div>
    <div class="row"><button class="btn primary" id="fsave">Speichern</button>${isNew ? '' : '<button class="btn" id="fdel">Löschen</button>'}</div>`);
  const showArt = () => {
    document.getElementById('artsel').innerHTML = f.art != null && A[f.art]
      ? `<div class="de">${esc(A[f.art].de)}</div><div class="lat">${esc(A[f.art].lat)}</div><button class="chip" id="artclr" style="margin-top:6px">Als unbestimmt speichern</button>`
      : '<div class="de">Noch unbestimmt</div><div class="tiny">Du kannst die Art jetzt oder später eintragen.</div>';
    const c = document.getElementById('artclr'); if (c) c.onclick = () => { f.art = null; showArt(); };
  };
  showArt();
  const aq = document.getElementById('artq'), ar = document.getElementById('artres');
  aq.oninput = () => {
    const t = norm(aq.value).split(/\s+/).filter(Boolean);
    if (aq.value.trim().length < 2) { ar.innerHTML = ''; return; }
    const xs = A.filter(x => t.every(w => norm(x.de + ' ' + x.lat).includes(w))).slice(0, 12);
    ar.innerHTML = xs.map(x => `<button class="chip" data-a="${x.id}" style="margin:3px">${esc(x.de.split(',')[0])}</button>`).join('');
    ar.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { f.art = +b.dataset.a; aq.value = ''; ar.innerHTML = ''; showArt(); });
  };
  const gi = document.getElementById('gpsinfo');
  const showGps = () => gi.innerHTML = f.lat != null
    ? `Gespeichert: ${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}${f.acc ? ` (± ${Math.round(f.acc)} m)` : ''} · <a href="geo:${f.lat},${f.lon}?q=${f.lat},${f.lon}">In Karten-App öffnen</a>`
    : 'Noch kein Standort gespeichert.';
  showGps();
  document.getElementById('gps').onclick = () => {
    if (!navigator.geolocation) return gi.textContent = 'Standort wird von diesem Browser nicht unterstützt.';
    gi.textContent = 'Suche Standort …';
    navigator.geolocation.getCurrentPosition(p => { f.lat = p.coords.latitude; f.lon = p.coords.longitude; f.acc = p.coords.accuracy; showGps(); },
      e => gi.textContent = 'Kein Standort: ' + (e.code === 1 ? 'Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.' : e.message),
      {enableHighAccuracy: true, timeout: 20000, maximumAge: 0});
  };
  const fimg = document.getElementById('fimg'), fdel = document.getElementById('fotodel');
  const showFoto = () => {
    if (fotoBlob) { fimg.src = URL.createObjectURL(fotoBlob); fimg.style.display = 'block'; fdel.style.display = ''; }
    else { fimg.style.display = 'none'; fdel.style.display = 'none'; }
  };
  showFoto();
  document.getElementById('foto').onchange = async e => { const file = e.target.files[0]; if (file) { fotoBlob = await resizePhoto(file); showFoto(); } };
  fdel.onclick = () => { fotoBlob = null; showFoto(); };
  document.getElementById('fsave').onclick = async () => {
    f.datum = document.getElementById('datum').value || f.datum;
    f.ort = document.getElementById('ort').value.trim();
    f.notiz = document.getElementById('notiz').value.trim();
    f.foto = !!fotoBlob;
    if (fotoBlob) await dbPut('fotos', f.id, fotoBlob); else await dbDel('fotos', f.id);
    await dbPut('funde', f.id, f);
    try { await navigator.storage?.persist?.(); } catch {}
    history.back();
  };
  const del = document.getElementById('fdel');
  if (del) del.onclick = async () => { if (!confirm('Diesen Fund wirklich löschen?')) return; await dbDel('funde', f.id); await dbDel('fotos', f.id); location.hash = '#/funde'; };
}

/* ---------- Sicherung ---------- */
function viewSicherung(){
  setView('Sicherung', `
    <div class="note">Exportiert deine Funde (ohne Fotos) und eigenen Vorschaubilder als Datei. Auf einem anderen Gerät importierst du sie hier wieder. Vorhandene Einträge bleiben erhalten, gleiche werden aktualisiert.</div>
    <button class="btn primary" id="exp" style="text-align:center">Sicherung exportieren</button>
    <label class="btn" style="text-align:center">Sicherungsdatei importieren<input type="file" id="impf" accept=".json,application/json,text/plain" hidden></label>
    <div class="sect">Oder Text einfügen</div>
    <textarea id="impt" rows="4" class="inp" placeholder="Exportierten Text hier einfügen"></textarea>
    <button class="btn" id="impbtn" style="text-align:center">Text importieren</button>
    <div id="impst" class="tiny"></div>`);
  document.getElementById('exp').onclick = async () => {
    const data = {app: 'pilzbuch', version: 1, exportiert: new Date().toISOString(), userth: userTh, funde: await dbAll('funde')};
    const txt = JSON.stringify(data);
    const file = new File([txt], `pilzbuch-sicherung-${new Date().toISOString().slice(0, 10)}.json`, {type: 'application/json'});
    try { if (navigator.canShare?.({files: [file]})) { await navigator.share({files: [file], title: 'Pilzbuch-Sicherung'}); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  };
  const st = document.getElementById('impst');
  const doImport = async txt => {
    try {
      const d = JSON.parse(txt.replace(/^PILZBUCH-BILDER\s*/, ''));
      let nT = 0, nF = 0;
      const th = d.app === 'pilzbuch' ? d.userth || {} : d;   // auch alter Bilder-Export
      for (const [k, v] of Object.entries(th)) if (Array.isArray(v) && v.length === 5) { userTh[k] = v; nT++; }
      store.set('userth', userTh);
      for (const f of d.funde || []) if (f && f.id && f.datum) { const old = await dbGet('funde', f.id); await dbPut('funde', f.id, {...f, foto: old?.foto || false}); nF++; }
      st.textContent = `Importiert: ${nF} Funde, ${nT} Vorschaubilder.`;
    } catch (e) { st.textContent = 'Das sieht nicht nach einer Pilzbuch-Sicherung aus.'; }
  };
  document.getElementById('impf').onchange = async e => { const f = e.target.files[0]; if (f) doImport(await f.text()); };
  document.getElementById('impbtn').onclick = () => doImport(document.getElementById('impt').value);
}

/* ---------- Vorschaubild selbst festlegen ---------- */
function viewBild(id, page){
  const x = A[id]; if (!x) return viewHome();
  const cur = thumbOf(id);
  let p = page || (cur ? cur[0] : x.tafel);
  let sel = cur && cur[0] === p ? cur.slice(1) : null;
  setView('Bild: ' + x.de.split(',')[0], `
    <div class="note">Ziehe mit dem Finger einen Rahmen um den Pilz <b>${esc(x.de)}</b>. Liegt die Abbildung auf einer anderen Seite, blättere mit den Pfeilen.</div>
    <div class="bar"><a class="btn" href="#/bild/${id}/${p - 1}">‹</a><span style="flex:1;text-align:center">S. ${p - 1}</span><a class="btn" href="#/bild/${id}/${p + 1}">›</a></div>
    <div class="pg" id="bp" style="touch-action:none"><canvas></canvas><div id="sel" style="position:absolute;border:3px solid #e33;background:rgba(255,60,60,.12);display:none;pointer-events:none"></div></div>
    <div class="row"><canvas id="prev" width="112" height="112" style="width:56px;height:56px;border-radius:8px;border:1px solid var(--line);flex:none;background:#fff"></canvas>
      <button class="btn primary" id="save">Speichern</button></div>
    <div class="row">${userTh[id] ? '<button class="btn" id="reset">Eigene Festlegung entfernen</button>' : ''}<a class="btn" href="#/art/${id}">Abbrechen</a></div>`);
  const bp = document.getElementById('bp'), sd = document.getElementById('sel'), pc = document.getElementById('prev');
  paint(bp.querySelector('canvas'), p);
  const show = () => {
    if (!sel) return;
    Object.assign(sd.style, {display: 'block', left: sel[0]*100+'%', top: sel[1]*100+'%', width: (sel[2]-sel[0])*100+'%', height: (sel[3]-sel[1])*100+'%'});
    pc.dataset.t = 'tmp'; drawPreview();
  };
  const drawPreview = async () => {
    const src = await renderPage(p, 560), [x0,y0,x1,y1] = sel;
    const sx = x0*src.width, sy = y0*src.height, sw = (x1-x0)*src.width, sh = (y1-y0)*src.height;
    const ctx = pc.getContext('2d'), S = pc.width; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,S,S);
    const k = Math.min(S/sw, S/sh); ctx.drawImage(src, sx, sy, sw, sh, (S-sw*k)/2, (S-sh*k)/2, sw*k, sh*k);
  };
  let start = null;
  const pos = e => { const r = bp.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  bp.onpointerdown = e => { start = pos(e); bp.setPointerCapture(e.pointerId); };
  bp.onpointermove = e => { if (!start) return; const q = pos(e);
    sel = [Math.min(start[0], q[0]), Math.min(start[1], q[1]), Math.max(start[0], q[0]), Math.max(start[1], q[1])];
    Object.assign(sd.style, {display: 'block', left: sel[0]*100+'%', top: sel[1]*100+'%', width: (sel[2]-sel[0])*100+'%', height: (sel[3]-sel[1])*100+'%'}); };
  bp.onpointerup = () => { start = null; if (sel && (sel[2]-sel[0] < 0.03 || sel[3]-sel[1] < 0.03)) sel = null; if (sel) show(); else sd.style.display = 'none'; };
  show();
  document.getElementById('save').onclick = () => {
    if (!sel) return alertNote('Bitte zuerst einen Rahmen ziehen.');
    userTh[id] = [p, ...sel.map(v => Math.round(v * 1000) / 1000)]; store.set('userth', userTh);
    location.hash = `#/art/${id}`;
  };
  const rs = document.getElementById('reset');
  if (rs) rs.onclick = () => { delete userTh[id]; store.set('userth', userTh); location.hash = `#/art/${id}`; };
}
function alertNote(t){ const n = document.createElement('div'); n.className = 'warn'; n.textContent = t; $main.prepend(n); setTimeout(() => n.remove(), 2500); }
async function shareUserTh(){
  const txt = 'PILZBUCH-BILDER ' + JSON.stringify(userTh);
  try { if (navigator.share) { await navigator.share({title: 'Pilzbuch: eigene Vorschaubilder', text: txt}); return; } } catch {}
  try { await navigator.clipboard.writeText(txt); alertNote('In die Zwischenablage kopiert.'); } catch { prompt('Kopieren:', txt); }
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

/* ---------- Blättern ---------- */
const NPAGES = 362;
let browse = null;
function pageLabel(p){ return p <= 2 ? 'Umschlag' : `S. ${p - 1}`; }
function viewBrowse(p, y){
  p = Math.min(NPAGES, Math.max(1, p));
  if (!browse || !document.body.contains(browse.root)) {
    $main.innerHTML = `
      <div class="bar">
        <input type="number" id="bjump" inputmode="numeric" min="0" max="361" placeholder="Seite" style="width:90px;font:inherit;padding:9px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)">
        <button class="btn" id="bgo" style="flex:0 0 auto;width:auto">Los</button>
        <a class="btn" href="#/blaettern/21">Schlüssel</a>
        <a class="btn" href="#/blaettern/340">Register</a>
      </div>
      <div class="tiny" style="margin-bottom:8px">Antippen: Beschreibungen und Namen auf Tafeln öffnen die Art, Seitenzahlen und Schlüsselnummern springen im Buch.</div>
      <div id="br"></div>`;
    const root = document.getElementById('br');
    const pages = [];
    const io = new IntersectionObserver(es => es.forEach(e => {
      const d = e.target;
      if (e.isIntersecting && d.dataset.f !== '1') { d.dataset.f = '1'; fillBrowse(d); }
      else if (!e.isIntersecting && d.dataset.f === '1') { d.dataset.f = '0'; d.querySelectorAll('canvas,button,.reg,.chipfig').forEach(n => n.remove()); }
    }), {rootMargin: '1500px 0px'});
    for (let q = 1; q <= NPAGES; q++) {
      const d = document.createElement('div'); d.className = 'pg'; d.dataset.p = q;
      d.innerHTML = `<span class="lbl">${pageLabel(q)}</span>`;
      root.appendChild(d); pages[q] = d; io.observe(d);
    }
    browse = {root, pages, io};
    const go = () => { const v = parseInt(document.getElementById('bjump').value, 10); if (!isNaN(v)) location.hash = `#/blaettern/${v + 1}`; };
    document.getElementById('bgo').onclick = go;
    document.getElementById('bjump').onkeydown = e => { if (e.key === 'Enter') go(); };
    addEventListener('scroll', onBrowseScroll, {passive: true});
  }
  const d = browse.pages[p];
  $title.textContent = 'Blättern · ' + pageLabel(p);
  requestAnimationFrame(() => {
    scrollTo(0, Math.max(0, d.getBoundingClientRect().top + scrollY + y * d.offsetHeight - 120));
    if (y > 0.01) { const f = document.createElement('div'); f.className = 'flash'; f.style.top = (y * 100) + '%'; d.appendChild(f); setTimeout(() => f.remove(), 2600); }
  });
}
let scrollT = 0;
function onBrowseScroll(){
  if (!browse || scrollT) return;
  scrollT = setTimeout(() => {
    scrollT = 0; if (!browse) return;
    const first = browse.pages[1], h = first.offsetHeight + 10;
    const p = Math.min(NPAGES, Math.max(1, 1 + Math.floor((scrollY + innerHeight / 3 - (first.getBoundingClientRect().top + scrollY)) / h)));
    $title.textContent = 'Blättern · ' + pageLabel(p);
    history.replaceState(history.state, '', `#/blaettern/${p}`);
    store.set('lastpage', p);
  }, 150);
}
/* Tipp auf eine Abbildung: nächstgelegene Beschriftung vorschlagen */
function figHit(p, e, el){
  const labs = D.plab[p]; if (!labs || !labs.length) return -1;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height, ar = r.height / r.width;
  let best = -1, bd = 9;
  for (const h of labs) {
    const [x0,y0,x1,y1] = h.b;
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1) * ar;
    const dd = Math.hypot(dx, dy);
    if (dd < bd) { bd = dd; best = h.a; }
  }
  return bd < 0.2 ? best : -1;
}
function figChip(host, e, id, extra){
  host.querySelectorAll('.chipfig').forEach(n => n.remove());
  const r = host.getBoundingClientRect();
  const c = document.createElement('div'); c.className = 'chipfig';
  c.style.left = Math.min(r.width - 220, Math.max(4, e.clientX - r.left - 100)) + 'px';
  c.style.top = (e.clientY - r.top + 12) + 'px';
  c.innerHTML = `<a href="#/art/${id}">${esc(A[id].de)} ›</a>${extra || ''}`;
  host.appendChild(c);
  setTimeout(() => c.remove(), 6000);
  return c;
}
function addHot(d, h, onclick, label, cls = 'hs'){
  const b = document.createElement('button'); b.className = cls;
  const [x0,y0,x1,y1] = h.b, pad = cls === 'hs' ? 0.004 : 0;
  Object.assign(b.style, {left: (x0-pad)*100+'%', top: (y0-pad)*100+'%', width: (x1-x0+2*pad)*100+'%', height: (y1-y0+2*pad)*100+'%'});
  b.setAttribute('aria-label', label); b.onclick = onclick; d.appendChild(b);
}
async function fillBrowse(d){
  const p = +d.dataset.p;
  const c = document.createElement('canvas'); d.prepend(c);
  paint(c, p).catch(() => {});
  for (const x of byTextPage[p] || [])
    addHot(d, {b: [0, x.y0, 1, x.y1]}, () => location.hash = `#/art/${x.id}`, x.de, 'reg');
  for (const h of D.plab[p] || [])
    addHot(d, h, () => location.hash = `#/art/${h.a}`, A[h.a].de);
  for (const h of D.ment[p] || [])
    addHot(d, h, () => location.hash = `#/art/${h.a}`, A[h.a].de, 'hs ment');
  if (D.plab[p]) c.onclick = e => { const id = figHit(p, e, c); if (id >= 0) figChip(d, e, id); };
  for (const h of [...(D.hot[p] || []), ...(D.bhot[p] || [])]) {
    if (h.pg) addHot(d, h, () => location.hash = `#/blaettern/${h.pg + 1}`, 'Seite ' + h.pg);
    else if (h.k != null) addHot(d, h, () => {
      const k = keyById(h.k); if (!k) return;
      let a = k.a[h.n];
      if (!a) { const lo = Object.keys(k.a).map(Number).filter(m => m < +h.n).sort((x, y) => y - x)[0]; a = lo ? k.a[lo] : [k.pdf, k.y]; }
      location.hash = `#/blaettern/${a[0]}/${a[1]}`;
    }, 'Weiter zu ' + h.n);
  }
}

/* ---------- Merkmale ---------- */
const SW = {weiß:'#fff',creme:'#f3e6c4',gelb:'#f2cf2a',orange:'#f08a24',rot:'#c8322a',rosa:'#f2a5b4',violett:'#8a55b0',blau:'#3d6fc4',grün:'#5f8f3a',braun:'#7a5230',ocker:'#c99a4b',grau:'#9a9a96',schwarz:'#222'};
const COLORS = Object.keys(SW);
const tag = v => `<span class="tag">${SW[v] ? `<i class="sw" style="background:${SW[v]}"></i>` : ''}${esc(v)}</span>`;
const tags = a => (a || []).map(tag).join('');
const num = v => String(v).replace('.', ',').replace(/,0$/, '');
const span = r => r[0] === r[1] ? num(r[0]) : `${num(r[0])}–${num(r[1])}`;
const FG = [
  {k:'u', t:'Unterseite', get:f => f.unterseite ? [f.unterseite] : [], opts:['Lamellen','Röhren/Poren','Leisten','Stacheln','glatt/Gallert/Kruste','Keule/Koralle','Becher/Schüssel','Morchel/Lorchel','Bauchpilz/Knolle']},
  {k:'hg', t:'Hutbreite', get:f => { const h = f.hut, r = []; if (!h) return r;
    if (h[0] < 5) r.push('bis 5 cm'); if (h[1] >= 5 && h[0] <= 10) r.push('5–10 cm'); if (h[1] > 10) r.push('über 10 cm'); return r; }, opts:['bis 5 cm','5–10 cm','über 10 cm']},
  {k:'hf', t:'Hutfarbe', get:f => f.hutfarbe || [], opts:COLORS, col:1},
  {k:'uf', t:'Farbe Lamellen/Poren', get:f => f.unterfarbe || [], opts:COLORS, col:1},
  {k:'sf', t:'Stielfarbe', get:f => f.stielfarbe || [], opts:COLORS, col:1},
  {k:'st', t:'Ring, Knolle & Co.', all:1, get:f => [f.ring && 'Ring', f.knolle && 'Knolle', f.volva && 'Volva/Scheide', f.schleier && 'Schleier/Cortina', f.schmierig && 'Hut schmierig'].filter(Boolean),
    opts:['Ring','Knolle','Volva/Scheide','Schleier/Cortina','Hut schmierig']},
  {k:'vf', t:'Verfärbung', get:f => f.verfaerbung || [], opts:['blauend','rötend','gilbend','schwärzend','bräunend','grünend']},
  {k:'ge', t:'Geruch', get:f => f.geruch || [], opts:['Mehl','Anis','Rettich/Rübe','Knoblauch','Bittermandel','fruchtig','Honig/süß','Kokos','Fisch','Gas/Teer','Chlor/Lauge','Erde/Kartoffel','Gewürz/Curry','unangenehm']},
  {k:'gs', t:'Geschmack', get:f => f.geschmack || [], opts:['mild','scharf','bitter']},
  {k:'mi', t:'Milch (Milchlinge)', get:f => f.milch ? [f.milch] : [], opts:['weiß','gilbend','rot/orange','wässrig']},
  {k:'bm', t:'Baumpartner', get:f => f.baum || [], opts:['Fichte','Kiefer','Lärche','Tanne','Buche','Eiche','Birke','Pappel/Espe','Erle','Hainbuche','Weide','Hasel','Linde','Kastanie']},
  {k:'lr', t:'Lebensraum', get:f => f.lebensraum || [], opts:['Laubwald','Nadelwald','Wiese/Weide','Park/Garten','Moor/Sumpf','Heide/Sand','Kalkboden','saurer Boden','auf Holz','auf Dung','Brandstelle','Moos','Zapfen','Nadelstreu/Laubstreu','auf Pilzen']},
  {k:'sa', t:'Jahreszeit', get:f => f.saison || [], opts:['Frühjahr','Sommer','Herbst','Winter']},
  {k:'hk', t:'Häufigkeit', get:f => f.haeufig ? [f.haeufig] : [], opts:['häufig','zerstreut','selten','sehr selten']},
  {k:'es', t:'Speisewert', get:(f, x) => [ESS[x.ess]], opts:Object.values(ESS)}
];
function merkmaleHtml(x){
  const f = x.f || {}, R = [];
  const add = (k, parts) => { const v = parts.filter(Boolean).join(' '); if (v) R.push(`<tr><th>${k}</th><td>${v}</td></tr>`); };
  add('Hut', [f.hut && `<b>Ø ${span(f.hut)} cm</b>`, tags(f.hutfarbe), f.schmierig && tag('schmierig')]);
  add('Unterseite', [f.unterseite && `<b>${esc(f.unterseite)}</b>`, tags(f.unterfarbe)]);
  add('Stiel', [f.stiel && `<b>${num(f.stiel[0])} × ${num(f.stiel[1])} cm</b>`, tags(f.stielfarbe),
    f.ring && tag('Ring'), f.knolle && tag('Knolle'), f.volva && tag('Volva/Scheide'), f.schleier && tag('Schleier/Cortina')]);
  add('Verfärbung', [tags(f.verfaerbung)]);
  add('Milch', [f.milch && tag(f.milch)]);
  add('Geruch', [tags(f.geruch)]);
  add('Geschmack', [tags(f.geschmack)]);
  add('Sporen', [f.sporen && esc(f.sporen)]);
  add('Bäume', [tags(f.baum)]);
  add('Lebensraum', [tags(f.lebensraum)]);
  add('Häufigkeit', [f.haeufig && tag(f.haeufig)]);
  add('Jahreszeit', [tags(f.saison)]);
  return R.length ? `<div class="sect">Merkmale <span class="tiny">– automatisch ausgelesen, Lücken möglich</span></div><table class="mm">${R.join('')}</table>` : '';
}
let mf = store.get('mf', {});
function viewMerkmale(){
  const sel = k => mf[k] || [];
  const active = FG.filter(g => sel(g.k).length);
  setView('Nach Merkmalen', `
    <div class="bar"><a class="btn primary" href="#mres" style="flex:2" id="cntbtn">…</a><button class="btn" id="mreset" style="flex:1">Zurücksetzen</button></div>
    ${FG.map(g => `<details class="fg" ${sel(g.k).length ? 'open' : ''}><summary>${g.t}<span class="cnt">${sel(g.k).length ? sel(g.k).length + ' gewählt' : ''}</span></summary>
      <div class="chips">${g.opts.map(o => `<button class="chip ${sel(g.k).includes(o) ? 'on' : ''}" data-g="${g.k}" data-o="${esc(o)}">${g.col ? `<i class="sw" style="background:${SW[o]}"></i> ` : ''}${esc(o)}</button>`).join('')}</div></details>`).join('')}
    <div class="note">Innerhalb einer Gruppe reicht eine Übereinstimmung, z. B. Hutfarbe braun <i>oder</i> ocker. Gruppen werden kombiniert. Bei „Ring, Knolle & Co.“ müssen alle gewählten Merkmale zutreffen. Die Merkmale sind automatisch aus den Beschreibungen gelesen. Arten ohne Angabe stehen deshalb in einer eigenen Liste darunter.</div>
    <div id="mres"></div>`);
  const sure = [], maybe = [];
  for (const x of A) {
    const f = x.f || {}; let ok = true; const unk = [];
    for (const g of active) {
      const v = g.get(f, x), s = sel(g.k);
      if (g.all) { if (!s.every(o => v.includes(o))) { ok = false; break; } }
      else if (!v.length) unk.push(g.t);
      else if (!v.some(o => s.includes(o))) { ok = false; break; }
    }
    if (ok) (unk.length ? maybe : sure).push([x, unk]);
  }
  document.getElementById('cntbtn').textContent = active.length ? `${sure.length} Treffer${maybe.length ? ` (+${maybe.length})` : ''} anzeigen ↓` : `Merkmale wählen`;
  document.getElementById('mres').innerHTML = !active.length ? '' :
    `<div class="sect">Passend (${sure.length})</div>${list(sure.slice(0, 300).map(a => a[0]))}` +
    (maybe.length ? `<div class="sect">Ohne Angabe zu einzelnen Merkmalen (${maybe.length})</div>${list(maybe.slice(0, 200).map(a => a[0]))}` : '');
  bindStars();
  $main.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    const k = b.dataset.g, o = b.dataset.o, s = new Set(sel(k));
    s.has(o) ? s.delete(o) : s.add(o); mf[k] = [...s]; store.set('mf', mf);
    const y = scrollY, open = [...$main.querySelectorAll('details.fg')].map(d => d.open);
    viewMerkmale();
    $main.querySelectorAll('details.fg').forEach((d, i) => d.open = open[i] || d.open);
    scrollTo(0, y);
  });
  document.getElementById('mreset').onclick = () => { mf = {}; store.set('mf', mf); viewMerkmale(); };
  document.getElementById('cntbtn').onclick = e => { e.preventDefault(); document.getElementById('mres').scrollIntoView({behavior:'smooth'}); };
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
  if (h[0] !== 'blaettern') { browse?.io.disconnect(); browse = null; removeEventListener('scroll', onBrowseScroll); }
  switch (h[0]) {
    case 'schluessel': return h[1] ? viewKey(+h[1], h[2]) : viewKeyList();
    case 'seite': return viewSeite(+h[1]);
    case 'doppelseite': return viewSpread(+h[1]);
    case 'textseite': return viewTextPage(+h[1]);
    case 'art': return viewArt(+h[1]);
    case 'arten': return viewArten();
    case 'merkliste': return viewMerk();
    case 'merkmale': return viewMerkmale();
    case 'blaettern': return viewBrowse(+h[1] || 1, +h[2] || 0);
    case 'bild': return viewBild(+h[1], +h[2] || 0);
    case 'funde': return viewFunde();
    case 'fund': return viewFund(h[1] || 'neu', h[2] != null && h[2] !== '' ? +h[2] : NaN);
    case 'sicherung': return viewSicherung();
    default: return viewHome();
  }
}
let lastRoute = '';
addEventListener('hashchange', () => {
  const sameKeyRun = location.hash.startsWith('#/schluessel/') && lastRoute.startsWith('#/schluessel/');
  lastRoute = location.hash; route();
  if (!sameKeyRun && !location.hash.startsWith('#/schluessel/') && !location.hash.startsWith('#/blaettern')) scrollTo(0, 0);
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
