/* 業主專頁 主程式（Claude 2026-09-21 雛型第二版：只有施工照與工程進度；視覺定稿由 Codex）。
 * 純 DOM、無框架；所有文字用 textContent；連結碼與末四碼只走 POST body，永不進 URL query。
 * API 契約見 協作任務/20260921_業主專頁/README.md §5-3。沒有 PORTAL_API 且頁面載了 portal.mock.js 時走假後端。 */
(function () {
  'use strict';
  var PORTAL_API = '';   // ← 部署後填入 GAS「三行 業主專頁」的 /exec 網址（Deo 授權後由 Codex 填）
  var CODE_RE = /^[0-9a-f]{24}$/;
  var $app = document.getElementById('app');
  var state = { code: '', pin: '', remember: true, data: null, overlay: null, sched: null };
  var node = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; };
  var btn = function (text, cls, onClick) { var b = node('button', 'pg-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
  var slash = function (iso) { return String(iso || '').replace(/-/g, '/'); };
  var md = function (iso) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? (+m[1]) + '/' + (+m[2]) : slash(iso); };
  var todayIso = function () { try { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }); } catch (e) { return new Date().toISOString().slice(0, 10); } };
  var isMock = function () { return !PORTAL_API && !!window.PortalMock; };

  // ---------- 後端 ----------
  function api(req) {
    if (isMock()) return window.PortalMock.call(req);
    if (!PORTAL_API) return Promise.resolve({ ok: false, code: 'UNAVAILABLE', error: '尚未設定資料來源，請聯絡三行' });
    return fetch(PORTAL_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req), redirect: 'follow', credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, code: 'NETWORK', error: '連線失敗，請確認網路後再試' }; });
  }
  function thumb(fileId, size) { return isMock() ? window.PortalMock.thumb(fileId) : 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + size; }

  // ---------- 連結碼、末四碼 ----------
  function codeFromHash() { var h = location.hash.replace(/^#/, '').trim(); if (/^k=/i.test(h)) h = h.slice(2); h = h.toLowerCase(); return CODE_RE.test(h) ? h : ''; }
  var storeKey = function () { return 'portal:' + state.code; };
  function loadPin() { try { return localStorage.getItem(storeKey()) || ''; } catch (e) { return ''; } }
  function savePin() { try { if (state.remember) localStorage.setItem(storeKey(), state.pin); else localStorage.removeItem(storeKey()); } catch (e) {} }
  function clearPin() { try { localStorage.removeItem(storeKey()); } catch (e) {} }

  // 跳至主內容不能改寫 hash；hash 是業主的專屬連結碼。
  var skip = document.querySelector('.pg-skip');
  if (skip) skip.addEventListener('click', function (e) {
    e.preventDefault();
    var main = $app.querySelector('main');
    if (!main) return;
    main.tabIndex = -1;
    main.focus({ preventScroll: true });
    main.scrollIntoView({ behavior: 'auto', block: 'start' });
  });

  // ---------- 進入流程 ----------
  function boot() {
    closeOverlay(true);
    state.code = codeFromHash(); state.data = null;
    document.documentElement.classList.remove('pg-locked');
    if (!state.code) { renderMessage('請從設計師給你的連結開啟', '這個頁面需要專屬連結才能查看。若你收到的連結無法開啟，請聯絡你的設計師。'); return; }
    var p = loadPin();
    if (p) { state.pin = p; load(); } else renderGate('');
  }
  function load() {
    renderLoading();
    api({ a: 'open', k: state.code, p: state.pin }).then(function (r) {
      if (!r || !r.ok) { handleError(r || { code: 'UNAVAILABLE', error: '暫時無法讀取資料，請稍後再試' }); return; }
      savePin(); state.data = r.data; renderMain();
    });
  }
  function handleError(r) {
    var code = r.code || 'UNAVAILABLE', msg = r.error || '暫時無法讀取資料，請稍後再試';
    if (code === 'PIN') { renderGate(msg); return; }
    if (code === 'LOCKED' || code === 'NOT_FOUND' || code === 'NOT_READY') { clearPin(); if (code === 'LOCKED') renderGate(msg); else renderMessage(code === 'NOT_FOUND' ? '連結無效或已停用' : '專頁尚未開通', msg); return; }
    renderRetry(msg);
  }

  // ---------- 畫面：閘門、訊息、載入 ----------
  /* 左上角：方塊標（與報價單／合約列印頁同一個 logo）＋文字 */
  function brand() {
    var b = node('a', 'pg-brand'); b.href = '#' + state.code; b.setAttribute('aria-label', '三行室內設計 業主專頁');
    var mark = node('img', 'pg-logo-mark'); mark.src = 'assets/logo-mark.png'; mark.alt = ''; mark.width = 30; mark.height = 30; mark.decoding = 'async';
    var txt = node('span', 'pg-brand-text', '三行室內設計'); txt.append(node('small', null, 'THREE ROW · 業主專頁'));
    b.append(mark, txt); b.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); return b;
  }
  /* 閘門與訊息頁：完整 logo（方塊標＋三行設計 threerow STU） */
  function gateShell(title, text) {
    var wrap = node('main', 'pg-gate'), card = node('div', 'pg-gate-card');
    var logo = node('img', 'pg-logo-full'); logo.src = 'assets/logo-full.png'; logo.alt = '三行設計 threerow STU'; logo.width = 669; logo.height = 1000; logo.decoding = 'async';
    card.append(logo, node('p', 'pg-gate-kicker', '業主專頁'), node('h1', null, title));
    if (text) card.append(node('p', null, text)); wrap.append(card); return { wrap: wrap, card: card };
  }
  function renderMessage(title, text) { var g = gateShell(title, text); $app.replaceChildren(g.wrap); }
  function renderRetry(msg) { var g = gateShell('暫時無法讀取', msg); g.card.append(btn('重試', 'primary', load)); $app.replaceChildren(g.wrap); }
  function renderLoading() { var m = node('main', 'pg-loading', '正在讀取你的專頁…'); $app.replaceChildren(m); }
  function renderGate(err) {
    var g = gateShell('請輸入手機末四碼', '為了保護你的資料，請輸入你留給三行的手機號碼最後四碼。');
    var form = node('form'); form.noValidate = true;
    var input = node('input', 'pg-pin'); input.type = 'text'; input.inputMode = 'numeric'; input.pattern = '[0-9]*'; input.maxLength = 4; input.autocomplete = 'one-time-code'; input.placeholder = '····'; input.setAttribute('aria-label', '手機末四碼'); input.required = true;
    var errEl = node('p', 'pg-err', err || ''); errEl.id = 'pg-pin-error'; errEl.setAttribute('aria-live', 'polite'); errEl.setAttribute('aria-atomic', 'true'); if (!err) errEl.hidden = true;
    input.setAttribute('aria-describedby', errEl.id); input.setAttribute('aria-invalid', err ? 'true' : 'false');
    var rem = node('label', 'pg-remember'); var cb = node('input'); cb.type = 'checkbox'; cb.checked = state.remember; cb.addEventListener('change', function () { state.remember = cb.checked; }); rem.append(cb, '記住這台裝置，下次不用再輸入');
    var submit = btn('進入專頁', 'primary'); submit.type = 'submit';
    form.append(input, errEl, rem, submit);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); var v = String(input.value || '').replace(/\D/g, '');
      if (v.length !== 4) { errEl.textContent = '請輸入 4 位數字'; errEl.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      state.pin = v; submit.disabled = true; load();
    });
    g.card.append(form, node('p', 'pg-help', '不確定留的是哪個號碼？請聯絡你的設計師。'));
    $app.replaceChildren(g.wrap);
    setTimeout(function () { input.focus(); }, 50);
  }

  // ---------- 主頁 ----------
  function renderMain() {
    var d = state.data, c = d['case'] || {};
    var frag = document.createDocumentFragment();
    var top = node('header', 'pg-top'); var tw = node('div', 'pg-wrap'); tw.append(brand());
    var nav = node('nav', 'pg-nav'); nav.setAttribute('aria-label', '區塊');
    [['photos', '施工照'], ['schedule', '工程進度']].forEach(function (x) { var a = node('a', null, x[1]); a.href = '#' + state.code; a.dataset.to = x[0]; a.addEventListener('click', function (e) { e.preventDefault(); var t = document.getElementById('sec-' + x[0]); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); nav.append(a); });
    tw.append(nav); top.append(tw); frag.append(top);

    var main = node('main', 'pg-wrap'); main.id = 'main';
    var hero = node('section', 'pg-hero');
    hero.append(node('h1', null, c.name || '業主專頁'));
    var meta = node('div', 'pg-meta');
    if (c.stage) { var chip = node('span', 'pg-chip'); chip.append(node('i'), c.stage); meta.append(chip); }
    if (c.designers && c.designers.length) meta.append(node('span', null, '設計師 ' + c.designers.join('、')));
    if (c.startDate) meta.append(node('span', null, '開始 ' + slash(c.startDate)));
    hero.append(meta);
    var addr = String(c.location || ''); var us = addr.indexOf('_'); if (us >= 0) addr = addr.slice(us + 1);
    if (addr) hero.append(node('p', 'pg-addr', addr));
    main.append(hero);

    main.append(sectionPhotos(d.photos || { ok: false, albums: [] }));
    main.append(sectionSchedule(d.schedule || { ok: false, exists: false }, (d.photos && d.photos.albums) || []));
    var foot = node('footer', 'pg-foot'); foot.append('三行室內設計　·　這是你的專屬頁面，請勿轉傳連結。' + (d.generatedAt ? '　資料時間 ' + fmtDateTime(d.generatedAt) : '')); main.append(foot);
    frag.append(main);
    $app.replaceChildren(frag);
    window.scrollTo(0, 0);
    watchNav();
  }
  function fmtDateTime(iso) { var d = new Date(iso); if (isNaN(d)) return ''; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function sectionShell(key, title, count) {
    var s = node('section', 'pg-sec'); s.id = 'sec-' + key; var h = node('div', 'pg-sec-head'); h.append(node('h2', null, title));
    if (count != null) h.append(node('span', 'pg-count', String(count)));
    s.append(h); return s;
  }
  function unavailable(text, retry) { var n = node('div', 'pg-note'); n.append(node('span', null, text || '暫時無法讀取，請稍後再試')); n.append(btn('重新整理', 'small', retry || load)); return n; }
  function watchNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.pg-nav a')), secs = links.map(function (a) { return document.getElementById('sec-' + a.dataset.to); });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) { entries.forEach(function (en) { if (!en.isIntersecting) return; var i = secs.indexOf(en.target); links.forEach(function (a, j) { if (j === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); }); }, { rootMargin: '-40% 0px -50% 0px' });
    secs.forEach(function (s) { if (s) io.observe(s); });
  }

  // ---------- 施工照：相簿密集列表（依月份分組），點開看格狀照片 ----------
  function sectionPhotos(ph) {
    var total = ph.ok ? ph.albums.reduce(function (n, a) { return n + (a.count || 0); }, 0) : 0;
    var s = sectionShell('photos', '施工照', ph.ok ? ph.albums.length + ' 次施工　' + total + ' 張' : null);
    if (!ph.ok) { s.append(unavailable('施工照暫時無法讀取，請稍後再試')); return s; }
    if (!ph.albums.length) { s.append(node('p', 'pg-empty', '開工後，每次施工的照片會出現在這裡。')); return s; }
    var groups = [], byMonth = {};
    ph.albums.forEach(function (a) { var m = String(a.date || '').slice(0, 7); if (!byMonth[m]) { byMonth[m] = []; groups.push(m); } byMonth[m].push(a); });
    groups.forEach(function (m) {
      var g = node('div', 'pg-month'); var mh = node('h3', null, (+m.slice(0, 4)) + ' 年 ' + (+m.slice(5, 7)) + ' 月'); mh.append(node('span', null, byMonth[m].length + ' 次')); g.append(mh);
      var list = node('div', 'pg-albums');
      byMonth[m].forEach(function (a) {
        var row = node('button', 'pg-album'); row.type = 'button'; row.setAttribute('aria-label', slash(a.date) + ' ' + (a.name || a.title) + '，' + (a.count || 0) + ' 張');
        row.append(node('span', 'd', md(a.date)), node('span', 'n', a.name || a.title), node('span', 'c', (a.count || 0) + ' 張'));
        row.addEventListener('click', function () { openAlbum(a); }); list.append(row);
      });
      g.append(list); s.append(g);
    });
    return s;
  }
  function openAlbum(a) {
    var ov = overlay(a.name || a.title, slash(a.date) + '　' + (a.count || 0) + ' 張');
    var body = ov.body; body.append(node('p', 'pg-loading', '正在讀取照片…'));
    api({ a: 'album', k: state.code, p: state.pin, id: a.id }).then(function (r) {
      body.replaceChildren();
      if (!r || !r.ok) { body.append(unavailable((r && r.error) || '相簿暫時無法讀取', function () { closeOverlay(); openAlbum(a); })); return; }
      var head = node('div', 'pg-photo-head'); head.append(node('b', null, slash(a.date) + '　' + (a.name || a.title)), node('span', null, r.data.files.length + ' 張'));
      if (a.url) { var lk = node('a', null, '在 Google 雲端硬碟開啟'); lk.href = a.url; lk.target = '_blank'; lk.rel = 'noopener noreferrer'; head.append(lk); }
      body.append(head);
      if (!r.data.files.length) { body.append(node('p', 'pg-empty', '這本相簿還沒有照片。')); return; }
      var grid = node('div', 'pg-photo-grid');
      r.data.files.forEach(function (f, i) {
        var b = node('button', 'pg-photo'); b.type = 'button'; b.setAttribute('aria-label', '第 ' + (i + 1) + ' 張');
        var img = node('img'); img.loading = 'lazy'; img.decoding = 'async'; img.alt = ''; img.src = thumb(f.id, 600); if (f.w && f.h) { img.width = f.w; img.height = f.h; }
        b.append(img); b.addEventListener('click', function () { lightbox(r.data.files, i); }); grid.append(b);
      });
      body.append(grid);
    });
  }
  function lightbox(files, index) {
    var dlg = node('dialog', 'pg-lb'); var stage = node('div', 'pg-lb-stage'); var img = node('img'); img.alt = ''; stage.append(img);
    var bar = node('div', 'pg-lb-bar'); var cap = node('span', 'cap'); var close = node('button', 'pg-lb-btn', '✕'); close.type = 'button'; close.setAttribute('aria-label', '關閉'); bar.append(cap, close);
    var prev = node('button', 'pg-lb-btn pg-lb-nav prev', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', '上一張');
    var next = node('button', 'pg-lb-btn pg-lb-nav next', '›'); next.type = 'button'; next.setAttribute('aria-label', '下一張');
    dlg.append(stage, bar, prev, next); document.body.append(dlg);
    var i = index;
    function show(n) { i = (n + files.length) % files.length; img.src = thumb(files[i].id, 1600); cap.textContent = (i + 1) + ' / ' + files.length; prev.disabled = next.disabled = files.length < 2; }
    prev.addEventListener('click', function () { show(i - 1); }); next.addEventListener('click', function () { show(i + 1); });
    close.addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') show(i - 1); else if (e.key === 'ArrowRight') show(i + 1); });
    var x0 = null; stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) show(dx < 0 ? i + 1 : i - 1); }, { passive: true });
    stage.addEventListener('click', function (e) { if (e.target === stage) dlg.close(); });
    show(i);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  }

  // ---------- 工程進度 ----------
  function sectionSchedule(sc, albums) {
    var s = sectionShell('schedule', '工程進度');
    if (!sc.ok) { s.append(unavailable('工程進度暫時無法讀取，請稍後再試')); return s; }
    if (!sc.exists) { s.append(node('p', 'pg-empty', '進度表準備中，排定後會出現在這裡。')); return s; }
    var tools = node('div', 'pg-sched-tools'); var todayBtn = btn('回到今天', 'small'); tools.append(todayBtn); s.append(tools);
    var host = node('div'); s.append(host);
    setTimeout(function () {
      if (!window.PortalSchedule) { host.append(node('p', 'pg-note bad', '進度表元件載入失敗')); return; }
      state.sched = window.PortalSchedule.render(host, sc, albums, todayIso(), function (album) { openAlbum(album); });
      todayBtn.addEventListener('click', function () { if (state.sched) state.sched.scrollToday(); });
    }, 0);
    return s;
  }

  // ---------- 覆蓋頁（相簿）：瀏覽器「返回」也能關 ----------
  function overlay(title, sub) {
    closeOverlay(true);
    var ov = node('section', 'pg-detail'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title);
    var top = node('div', 'pg-detail-top'); var tw = node('div', 'pg-wrap');
    var back = btn('‹ 返回', 'ghost', function () { history.back(); }); var h = node('h2', null, title + (sub ? '　' + sub : ''));
    tw.append(back, h); top.append(tw); ov.append(top);
    var body = node('div', 'pg-detail-body pg-wrap'); ov.append(body);
    document.body.append(ov); document.documentElement.classList.add('pg-locked'); state.overlay = ov;
    try { history.pushState({ pgOverlay: true }, ''); } catch (e) {}
    setTimeout(function () { back.focus(); }, 30);
    return { root: ov, body: body };
  }
  function closeOverlay(silent) {
    if (!state.overlay) return; state.overlay.remove(); state.overlay = null; document.documentElement.classList.remove('pg-locked');
    document.querySelectorAll('dialog.pg-lb').forEach(function (d) { try { d.close(); } catch (e) {} d.remove(); });
    if (!silent && history.state && history.state.pgOverlay) { try { history.back(); } catch (e) {} }
  }
  window.addEventListener('popstate', function () { if (state.overlay) closeOverlay(true); });
  window.addEventListener('hashchange', function () { if (codeFromHash() !== state.code) boot(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.overlay && !document.querySelector('dialog.pg-lb[open]')) history.back(); });

  window.PortalApp = { boot: boot, reload: function () { state.pin = loadPin(); boot(); }, forget: function () { clearPin(); state.pin = ''; boot(); } };
  boot();
})();
