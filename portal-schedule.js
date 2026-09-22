/* 業主專頁 唯讀甘特圖（Claude 2026-09-21 雛型）。
 * 規則全部來自 vendor/schedule.core.js（與三行腦 build/schedule/schedule.core.js 逐字相同，測試核對）；
 * 畫法比照三行腦 schedule.js 的 buildGrid／renderRow／buildLegend，但沒有工具列、沒有拖曳、沒有編輯、沒有列印分頁。
 * 對外：window.PortalSchedule = { render(container, schedule, albums, todayIso, onPhoto) } */
(function () {
  'use strict';
  var C = window.ScheduleCore;
  var node = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; };
  var slash = function (iso) { return String(iso || '').replace(/-/g, '/'); };

  function render(container, sched, albums, todayIso, onPhoto) {
    container.replaceChildren();
    if (!C) { container.append(node('p', 'pg-note bad', '進度表元件載入失敗')); return null; }
    var d;
    try { d = typeof C.validate === 'function' ? C.validate(sched.data) : sched.data; } catch (e) { container.append(node('p', 'pg-note', '進度表資料暫時無法顯示')); return null; }
    if (!d || !Array.isArray(d.rows)) { container.append(node('p', 'pg-empty', '進度表準備中')); return null; }
    var hmap = C.holidayMap(d), pages = C.pagesNeeded(d), counter = C.projectCounter(d, hmap), sum = C.summary(d), today = todayIso || '';
    var photosByDay = {};
    (albums || []).forEach(function (a) { if (a && a.date) (photosByDay[a.date] = photosByDay[a.date] || []).push(a); });

    // 摘要與開工前應辦事項（業主要看的）
    var top = node('div', 'pg-sched-sum');
    if (sum.start) { var s1 = node('span'); s1.append('開工 ', node('b', null, slash(sum.start)), '　預定完工 ', node('b', null, slash(sum.end))); top.append(s1); var s2 = node('span'); s2.append('共 ', node('b', null, String(sum.workdays)), ' 個工作天（', String(sum.calendarDays), ' 日曆天）'); top.append(s2); }
    else top.append(node('span', null, '尚未排定工期'));
    if (sched.updatedAt) top.append(node('span', null, '更新 ' + fmtTime(sched.updatedAt)));
    container.append(top);
    if (d.checklist && d.checklist.length) {
      var chk = node('div', 'pg-check'); chk.append(node('b', null, '開工前應辦事項'));
      d.checklist.forEach(function (c) { var s = node('span'); s.append(node('i', null, c.on ? '☑' : '☐'), c.t); s.title = c.on ? '已完成' : '待辦'; chk.append(s); });
      if (d.checkNote) chk.append(node('span', 'note', d.checkNote));
      container.append(chk);
    }

    var root = node('section', 'sc'); root.dataset.locked = ''; root.setAttribute('aria-label', '工程進度表');
    var allDates = []; for (var p = 0; p < pages; p++) allDates = allDates.concat(C.pageDates(d.start, p));
    var tl = node('div', 'sc-timeline'); tl.tabIndex = 0; tl.setAttribute('aria-label', '時間軸，' + pages + ' 個月，可左右捲動');
    var g = buildGrid(d, allDates, hmap, today, counter, sum, photosByDay, onPhoto);
    tl.append(g); root.append(tl);
    root.append(buildLegend(d, photosByDay, C.yearOf(allDates[0]), C.yearOf(allDates[allDates.length - 1])));
    if (d.note) root.append(node('p', 'pg-empty', d.note));
    container.append(root);
    fit(tl, g, allDates.length);
    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { fit(tl, g, allDates.length); }); ro.observe(tl); }
    scrollToday(tl, g, today, allDates);
    return { root: root, scrollToday: function () { scrollToday(tl, g, today, allDates, true); }, dispose: function () { if (ro) ro.disconnect(); } };
  }

  /* 有施工照時至少 45px／日，容納 44px 按鈕與格線、不重疊；無照片維持 26px。 */
  function fit(tl, g, nDays) {
    var label = parseFloat(getComputedStyle(g).getPropertyValue('--sc-label')) || 120;
    var minDay = g.querySelector('button.sc-dot') ? 45 : 26;
    var avail = tl.clientWidth - label - 2, day = Math.max(minDay, Math.floor(avail / 31));
    g.style.setProperty('--sc-day', day + 'px');
    g.style.gridTemplateColumns = 'var(--sc-label) repeat(' + nDays + ', var(--sc-day))';
  }
  function scrollToday(tl, g, today, dates, smooth) {
    if (!today || dates.indexOf(today) < 0) return;
    var cell = g.querySelector('.sc-h.sc-day[data-today]'); if (!cell) return;
    var x = cell.offsetLeft - (parseFloat(getComputedStyle(g).getPropertyValue('--sc-label')) || 120) - 8;
    try { tl.scrollTo({ left: Math.max(0, x), behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { tl.scrollLeft = Math.max(0, x); }
  }
  function fmtTime(iso) { var d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); }

  function buildGrid(d, dates, hmap, today, counter, sum, photosByDay, onPhoto) {
    var n = dates.length, hasPhotos = Object.keys(photosByDay).length > 0, H = 1 + (hasPhotos ? 3 : 2);
    var g = node('div', 'sc-grid'); g.style.setProperty('--sc-days', String(n));
    var corner = node('div', 'sc-h sc-corner'); corner.style.gridRow = '1 / span ' + H; corner.append(node('span', null, '工程項目')); if (hasPhotos) corner.append(node('small', null, '● 有施工照')); g.append(corner);
    var mark = function (c, iso) { if (C.dayOf(iso) === 1) c.dataset.monthStart = ''; return c; };
    var i = 0; while (i < n) { var iso0 = dates[i], days = C.daysInMonth(iso0), span = Math.min(days - C.dayOf(iso0) + 1, n - i); var mh = node('div', 'sc-h sc-mon'); mh.style.gridColumn = 'span ' + span; mh.dataset.monthStart = ''; mh.append(node('b', null, C.yearOf(iso0) + ' 年 ' + C.monthOf(iso0) + ' 月')); mh.append(node('small', null, span + ' 天')); g.append(mh); i += span; }
    dates.forEach(function (iso) { var k = C.dayKind(iso, hmap), c = node('div', 'sc-h sc-day', String(C.dayOf(iso))); c.dataset.d = iso; if (k !== 'week') c.dataset.kind = k; if (iso === today) c.dataset.today = ''; c.title = slash(iso) + '（' + C.weekLabel(iso) + '）' + (hmap[iso] ? '　' + hmap[iso] : ''); g.append(mark(c, iso)); });
    dates.forEach(function (iso) { var k = C.dayKind(iso, hmap), c = node('div', 'sc-h sc-wk', hmap[iso] ? hmap[iso].slice(0, 2) : C.weekLabel(iso)); if (hmap[iso]) c.title = hmap[iso]; if (k !== 'week') c.dataset.kind = k; if (iso === today) c.dataset.today = ''; g.append(mark(c, iso)); });
    if (hasPhotos) dates.forEach(function (iso) {
      var k = C.dayKind(iso, hmap), c = node('div', 'sc-h sc-ph'); if (k !== 'week') c.dataset.kind = k; if (iso === today) c.dataset.today = '';
      var list = photosByDay[iso];
      if (list && list.length) {
        var dot = node('button', 'sc-dot', list.length > 1 ? String(list.length) : ''); dot.type = 'button';
        dot.title = list.map(function (a) { return slash(a.date) + ' 施工照「' + a.name + '」' + (a.count ? a.count + ' 張' : ''); }).join('\n');
        dot.setAttribute('aria-label', dot.title);
        dot.addEventListener('click', function () { if (onPhoto) onPhoto(list[0]); });
        c.append(dot);
      }
      g.append(mark(c, iso));
    });
    d.rows.forEach(function (row, ri) { renderRow(d, g, row, ri, dates, hmap, today, mark); });
    var tl = node('div', 'sc-l sc-bar-l'); tl.dataset.kind = 'total'; tl.append(node('span', 'sc-name', '工作天數'), node('span', 'sc-days', sum.workdays ? '共 ' + sum.workdays + ' 天' : '')); g.append(tl);
    var trow = node('div', 'sc-row'); trow.dataset.kind = 'total';
    dates.forEach(function (iso) { var k = C.dayKind(iso, hmap), c = node('div', 'sc-c sc-total', counter[iso] ? String(counter[iso]) : ''); if (k !== 'week') c.dataset.kind = k; if (counter[iso]) c.dataset.on = ''; if (iso === today) c.dataset.today = ''; trow.append(mark(c, iso)); });
    g.append(trow);
    return g;
  }

  function renderRow(d, g, row, ri, dates, hmap, today, mark) {
    var nums = row.kind === 'trade' ? C.numbering(row, hmap, d.workSat) : {}, marks = {};
    if (row.kind !== 'trade') (row.segs || []).forEach(function (s) { marks[s.s] = 1; });
    var segs = C.normalizeSegs(row.segs), notes = {}; (row.notes || []).forEach(function (n) { notes[n.d] = n; });
    var total = row.kind === 'trade' ? C.rowWorkdays(row, hmap, d.workSat) : (row.segs || []).length;
    var l = node('div', 'sc-l sc-bar-l'); l.dataset.kind = row.kind;
    var name = node('span', 'sc-name', row.label); name.title = row.label;
    l.append(name, node('span', 'sc-days', total ? total + (row.kind === 'trade' ? ' 天' : ' 次') : '')); g.append(l);
    var barRow = node('div', 'sc-row'); barRow.dataset.kind = row.kind;
    dates.forEach(function (iso) {
      var k = C.dayKind(iso, hmap), c = node('div', 'sc-c'); c.dataset.d = iso; if (k !== 'week') c.dataset.kind = k; if (iso === today) c.dataset.today = '';
      if (row.kind === 'trade') {
        var seg = segs.filter(function (s) { return s.s <= iso && iso <= s.e; })[0];
        if (seg) { c.dataset.work = ''; c.textContent = nums[iso] ? String(nums[iso]) : ''; c.title = row.label + '　' + slash(seg.s) + ' – ' + slash(seg.e) + (nums[iso] ? '　第 ' + nums[iso] + ' 個工作天' : '　' + (hmap[iso] || '週日') + '，不算工作天'); }
        else c.title = slash(iso) + '（' + C.weekLabel(iso) + '）' + (hmap[iso] ? '　' + hmap[iso] : '');
      } else if (marks[iso]) { c.dataset.work = ''; c.textContent = '◆'; c.title = row.label + '　' + slash(iso); }
      else c.title = slash(iso);
      barRow.append(mark(c, iso));
    });
    g.append(barRow);
    var nl = node('div', 'sc-l sc-note-l', row.kind === 'trade' ? '註記' : ''); nl.dataset.kind = row.kind; g.append(nl);
    var noteRow = node('div', 'sc-row'); noteRow.dataset.kind = row.kind;
    dates.forEach(function (iso) {
      var k = C.dayKind(iso, hmap), c = node('div', 'sc-c sc-n'); c.dataset.d = iso; if (k !== 'week') c.dataset.kind = k; if (iso === today) c.dataset.today = '';
      if (notes[iso]) { var t = node('span', 'sc-t', notes[iso].t); t.title = slash(iso) + '　' + notes[iso].t; c.append(t); }
      noteRow.append(mark(c, iso));
    });
    g.append(noteRow);
  }

  function buildLegend(d, photosByDay, y1, y2) {
    var lg = node('div', 'sc-legend');
    [['var(--sc-work)', '施工（數字＝該工項第幾個工作天）'], ['var(--sc-sat)', '週六'], ['var(--sc-sun)', '週日'], ['var(--sc-hol)', '國定假日／工地休假'], ['var(--sc-review)', '階段驗收']].forEach(function (x) { var s = node('span'); var i = node('i'); i.style.background = x[0]; s.append(i, x[1]); lg.append(s); });
    if (Object.keys(photosByDay).length) { var ps = node('span'); ps.append(node('span', 'sc-dot sc-dot-legend'), ' 該日有施工照（點了看相簿）'); lg.append(ps); }
    var years = []; for (var y = y1; y <= (y2 || y1); y++) years.push(y);
    lg.append(node('span', 'sc-sum', d.useNational === false ? '未套用國定假日' : years.map(function (yy) { return C.NATIONAL_NOTE && C.NATIONAL_NOTE[yy] ? yy + ' 年假日依' + C.NATIONAL_NOTE[yy] : yy + ' 年無內建假日表'; }).join('；')));
    return lg;
  }

  window.PortalSchedule = { render: render };
})();
