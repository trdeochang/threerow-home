/* 施工進度表（甘特圖）核心邏輯（Claude 2026-09-21；同日依 Deo 回饋改為「一個月一頁」）：純函式、無 DOM、無網路。
 * 前端 schedule.js 與 GAS ScheduleCore.gs 共用同一份：週日不算工作天、週六預設算（workSat）、國定假日與工地休假不算；
 * 工作天編號＝同一列所有施工段依日期順序累計；一頁＝一個月（列印時整張紙滿版涵蓋整個月）。 */
(function (root) {
  'use strict';
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  var MS = 86400000;

  // 國定假日（含補假）。2026＝人事行政總處 115 年辦公日曆表（2026-09-21 查證）；2027＝依 116 年新聞稿摘要推算，請核對後再信。
  // 工地實際休假（春節提早收工、颱風假、業主要求）另由每張表的 holidays 設定，這裡只是預設底稿。
  var NATIONAL = {
    2026: [['2026-01-01', '元旦'], ['2026-02-14', '春節'], ['2026-02-15', '小年夜'], ['2026-02-16', '除夕'], ['2026-02-17', '初一'], ['2026-02-18', '初二'], ['2026-02-19', '初三'], ['2026-02-20', '初四'], ['2026-02-21', '春節'], ['2026-02-22', '春節'],
      ['2026-02-27', '和平紀念日補假'], ['2026-02-28', '和平紀念日'], ['2026-04-03', '兒童節補假'], ['2026-04-04', '兒童節'], ['2026-04-05', '清明節'], ['2026-04-06', '清明節補假'],
      ['2026-05-01', '勞動節'], ['2026-06-19', '端午節'], ['2026-09-25', '中秋節'], ['2026-09-28', '教師節'], ['2026-10-09', '國慶日補假'], ['2026-10-10', '國慶日'],
      ['2026-10-25', '光復節'], ['2026-10-26', '光復節補假'], ['2026-12-25', '行憲紀念日']],
    2027: [['2027-01-01', '元旦'], ['2027-02-04', '小年夜'], ['2027-02-05', '除夕'], ['2027-02-06', '初一'], ['2027-02-07', '初二'], ['2027-02-08', '初三'], ['2027-02-09', '春節補假'], ['2027-02-10', '春節補假'],
      ['2027-02-28', '和平紀念日'], ['2027-03-01', '和平紀念日補假'], ['2027-04-02', '兒童節補假'], ['2027-04-03', '兒童節'], ['2027-04-04', '兒童節'], ['2027-04-05', '清明節'],
      ['2027-04-30', '勞動節補假'], ['2027-05-01', '勞動節'], ['2027-06-09', '端午節'], ['2027-09-15', '中秋節'], ['2027-09-28', '教師節'], ['2027-10-10', '國慶日'], ['2027-10-11', '國慶日補假'],
      ['2027-10-25', '光復節'], ['2027-12-24', '行憲紀念日補假'], ['2027-12-25', '行憲紀念日']]
  };
  var NATIONAL_NOTE = { 2026: '人事行政總處 115 年辦公日曆表', 2027: '依 116 年新聞稿摘要推算，請核對' };

  // 舊 Excel 的固定工項（順序照舊）；2026-09-21 Deo 決定拿掉「業主確認」列；階段驗收在最下，工作天數由程式算
  var TEMPLATE_TRADES = ['保護工程', '拆除工程', '水電工程', '衛浴設備', '空調工程', '泥作工程', '鐵鋁工程', '木作工程', '漆作工程', '廚具工程', '系統工程', '玻璃工程', '地板工程', '其他工程', '清潔工程', '窗簾工程'];
  var TEMPLATE_CHECKLIST = ['管委會裝修申請', '鋁鐵工程', '冷氣空調', '保全工程', '瓦斯工程', '視聽工程', '廚具工程'];
  var TEMPLATE_CHECK_NOTE = '由業主自行發包之工程，需於開工前完成使用形式、顏色、安裝位置及施作廠商之確認。';
  var TEMPLATE_NOTE = '＊若業主未能完成自行發包工程應辦事項、或業主追加施作項目或工程中不可預見之事由致工程變更，得依其實際狀況延展工期。';
  var PAPERS = ['a4', 'a3'];

  var LIMITS = { rows: 40, segsPerRow: 80, notesPerRow: 120, holidays: 60, checklist: 20, label: 20, noteText: 40, text: 300, pages: 18, bytes: 60000, yearMin: 2020, yearMax: 2035 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); if (!m) return null; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) ? d : null; }
  function fmt(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function isIso(iso) { return !!parse(iso); }
  function addDays(iso, n) { var d = parse(iso); if (!d) return ''; d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
  function diffDays(a, b) { var x = parse(a), y = parse(b); if (!x || !y) return NaN; return Math.round((y - x) / MS); }
  function dow(iso) { var d = parse(iso); return d ? d.getUTCDay() : -1; }
  function weekLabel(iso) { var w = dow(iso); return w < 0 ? '' : WEEK[w]; }
  function monthOf(iso) { return +String(iso).slice(5, 7); }
  function dayOf(iso) { return +String(iso).slice(8, 10); }
  function yearOf(iso) { return +String(iso).slice(0, 4); }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function newId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---- 月份 ----
  function monthStart(iso) { return isIso(iso) ? String(iso).slice(0, 7) + '-01' : ''; }
  function daysInMonth(iso) { return new Date(Date.UTC(yearOf(iso), monthOf(iso), 0)).getUTCDate(); }
  function monthEnd(iso) { return String(iso).slice(0, 8) + pad(daysInMonth(iso)); }
  function addMonths(iso, n) { return fmt(new Date(Date.UTC(yearOf(iso), monthOf(iso) - 1 + n, 1))); }
  function monthsBetween(a, b) { return (yearOf(b) - yearOf(a)) * 12 + (monthOf(b) - monthOf(a)); }

  function nationalHolidays(years) { var out = {}; (years || Object.keys(NATIONAL)).forEach(function (y) { (NATIONAL[y] || []).forEach(function (h) { out[h[0]] = h[1]; }); }); return out; }
  /** 假日對照 {iso: 文字}：國定假日 ∪ 表內工地休假（工地休假覆寫文字）。useNational=false 時只看工地休假 */
  function holidayMap(data) {
    var map = {};
    if (!data || data.useNational !== false) { Object.assign(map, nationalHolidays()); }
    ((data && data.holidays) || []).forEach(function (h) {
      var s = h.start || h.s, e = h.end || h.e || s; if (!isIso(s) || !isIso(e)) return; if (e < s) { var t = s; s = e; e = t; }
      for (var d = s; d <= e; d = addDays(d, 1)) map[d] = h.text || h.t || '休';
    });
    return map;
  }
  function isWorkday(iso, hmap, workSat) { var w = dow(iso); if (w < 0 || w === 0) return false; if (w === 6 && workSat === false) return false; return !hmap[iso]; }
  function dayKind(iso, hmap) { if (hmap[iso]) return 'holiday'; var w = dow(iso); return w === 0 ? 'sun' : w === 6 ? 'sat' : 'week'; }

  /** 同列施工段：排序、合併重疊或相鄰（相鄰＝下一段起日＝前段迄日＋1） */
  function normalizeSegs(segs) {
    var list = (segs || []).filter(function (s) { return isIso(s.s) && isIso(s.e); }).map(function (s) { return { id: s.id || newId(), s: s.s <= s.e ? s.s : s.e, e: s.s <= s.e ? s.e : s.s }; }).sort(function (a, b) { return cmp(a.s, b.s) || cmp(a.e, b.e); });
    var out = [];
    list.forEach(function (s) { var last = out[out.length - 1]; if (last && s.s <= addDays(last.e, 1)) { if (s.e > last.e) last.e = s.e; } else out.push(s); });
    return out;
  }
  /** 工作天編號：同列所有段依序累計；回 {iso: n}；非工作天不編號也不佔號 */
  function numbering(row, hmap, workSat) {
    var map = {}, n = 0;
    normalizeSegs(row.segs).forEach(function (seg) { for (var d = seg.s; d <= seg.e; d = addDays(d, 1)) if (isWorkday(d, hmap, workSat)) map[d] = ++n; });
    return map;
  }
  function rowWorkdays(row, hmap, workSat) { var m = numbering(row, hmap, workSat), n = 0; for (var k in m) n++; return n; }
  /** 全案範圍：所有 trade 列的最早起日與最晚迄日（沒有施工段＝null） */
  function projectRange(data) {
    var s = null, e = null;
    (data.rows || []).forEach(function (r) { if (r.kind !== 'trade') return; (r.segs || []).forEach(function (g) { if (!isIso(g.s) || !isIso(g.e)) return; var a = g.s <= g.e ? g.s : g.e, b = g.s <= g.e ? g.e : g.s; if (s === null || a < s) s = a; if (e === null || b > e) e = b; }); });
    return s ? { start: s, end: e } : null;
  }
  /** 全案工作天計數 {iso: n}（開工日到最後一天，跳過非工作天） */
  function projectCounter(data, hmap) {
    var r = projectRange(data), map = {}, n = 0; if (!r) return map;
    for (var d = r.start; d <= r.end; d = addDays(d, 1)) if (isWorkday(d, hmap, data.workSat)) map[d] = ++n;
    return map;
  }
  function summary(data) { var hmap = holidayMap(data), r = projectRange(data), c = projectCounter(data, hmap), n = 0; for (var k in c) n++; return { start: r ? r.start : '', end: r ? r.end : '', workdays: n, calendarDays: r ? diffDays(r.start, r.end) + 1 : 0 }; }

  /** 頁＝月：至少 data.pages 個月（預設 1）；資料超出時自動延伸到最後一筆所在的月 */
  function lastDate(data) {
    var last = data.start;
    (data.rows || []).forEach(function (r) { (r.segs || []).forEach(function (g) { if (g.e > last) last = g.e; if (g.s > last) last = g.s; }); (r.notes || []).forEach(function (t) { if (t.d > last) last = t.d; }); });
    ((data.holidays) || []).forEach(function (h) { var e = h.end || h.e || h.start || h.s; if (e && e > last && monthsBetween(data.start, e) < LIMITS.pages) last = e; });
    return last;
  }
  function pagesNeeded(data) { var want = Math.max(1, +data.pages || 1), need = monthsBetween(monthStart(data.start), lastDate(data)) + 1; return Math.min(LIMITS.pages, Math.max(want, need || 1)); }
  function pageDates(start, pageIndex) { var first = addMonths(monthStart(start), pageIndex), n = daysInMonth(first), out = []; for (var i = 0; i < n; i++) out.push(addDays(first, i)); return out; }
  function pageRange(start, pageIndex) { var d = pageDates(start, pageIndex); return { start: d[0], end: d[d.length - 1], year: yearOf(d[0]), month: monthOf(d[0]), days: d.length }; }

  function moveSeg(seg, delta) { return { id: seg.id, s: addDays(seg.s, delta), e: addDays(seg.e, delta) }; }
  function resizeSeg(seg, edge, iso) { var s = seg.s, e = seg.e; if (edge === 'start') s = iso; else e = iso; if (s > e) { var t = s; s = e; e = t; } return { id: seg.id, s: s, e: e }; }
  function segAt(row, iso) { return normalizeSegs(row.segs).filter(function (g) { return g.s <= iso && iso <= g.e; })[0] || null; }
  function removeDay(row, iso) {   // 從施工段挖掉一天（可能把一段切成兩段）
    var out = [];
    normalizeSegs(row.segs).forEach(function (g) { if (iso < g.s || iso > g.e) { out.push(g); return; } if (g.s < iso) out.push({ id: g.id, s: g.s, e: addDays(iso, -1) }); if (g.e > iso) out.push({ id: newId(), s: addDays(iso, 1), e: g.e }); });
    return out;
  }

  function template(caseName, location, start) {
    var rows = [];
    TEMPLATE_TRADES.forEach(function (t, i) { rows.push({ key: 't' + (i + 1), kind: 'trade', label: t, segs: [], notes: [] }); });
    rows.push({ key: 'review', kind: 'review', label: '階段驗收', segs: [], notes: [] });
    return { v: 1, title: '工程進度預定表', caseName: caseName || '', location: location || '', start: monthStart(start), pages: 1, paper: 'a4', workSat: true, useNational: true,
      checklist: TEMPLATE_CHECKLIST.map(function (t) { return { t: t, on: false }; }), checkNote: TEMPLATE_CHECK_NOTE, note: TEMPLATE_NOTE, holidays: [], rows: rows };
  }

  var CONTROL_RE = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]', 'g');
  function str(v, max) { return String(v == null ? '' : v).replace(CONTROL_RE, '').slice(0, max); }
  function yearOk(iso) { var y = yearOf(iso); return y >= LIMITS.yearMin && y <= LIMITS.yearMax; }
  /** 驗證＋白名單複製：只留認得的欄位、修掉壞資料；結構錯誤才丟錯（前端存檔前、後端寫入前都跑同一支）。
   *  舊資料的 confirm（業主確認）列一律丟掉（2026-09-21 Deo 決定不需要）。 */
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('進度表資料格式不對');
    if (!isIso(input.start) || !yearOk(input.start)) throw new Error('缺少有效的開始日期');
    if (!Array.isArray(input.rows) || !input.rows.length) throw new Error('進度表沒有任何工項列');
    if (input.rows.length > LIMITS.rows) throw new Error('工項列超過 ' + LIMITS.rows + ' 列');
    var out = { v: 1, title: str(input.title || '工程進度預定表', 30), caseName: str(input.caseName, 60), location: str(input.location, 120), start: monthStart(input.start),
      pages: Math.min(LIMITS.pages, Math.max(1, Math.floor(+input.pages || 1))), paper: PAPERS.indexOf(input.paper) >= 0 ? input.paper : 'a4', workSat: input.workSat !== false, useNational: input.useNational !== false,
      checklist: [], checkNote: str(input.checkNote, LIMITS.text), note: str(input.note, LIMITS.text), holidays: [], rows: [] };
    (Array.isArray(input.checklist) ? input.checklist : []).slice(0, LIMITS.checklist).forEach(function (c) { var t = str(c && c.t, LIMITS.noteText); if (t) out.checklist.push({ t: t, on: !!(c && c.on) }); });
    (Array.isArray(input.holidays) ? input.holidays : []).slice(0, LIMITS.holidays).forEach(function (h) { var s = h && (h.start || h.s), e = h && (h.end || h.e) || s; if (!isIso(s) || !isIso(e) || !yearOk(s) || !yearOk(e)) return; if (e < s) { var t = s; s = e; e = t; } if (diffDays(s, e) > 120) return; out.holidays.push({ s: s, e: e, t: str(h.text || h.t || '休', LIMITS.noteText) }); });
    var reviews = 0, keys = {};
    input.rows.forEach(function (r, i) {
      if (!r || typeof r !== 'object') return;
      var kind = r.kind === 'review' ? 'review' : r.kind === 'confirm' ? '' : 'trade';
      if (!kind) return;                                   // 業主確認列：丟掉
      if (kind === 'review' && reviews++) return;          // 階段驗收只能一列
      var key = str(r.key, 24).replace(/[^\w-]/g, '') || 'r' + i; while (keys[key]) key += 'x'; keys[key] = 1;
      var row = { key: key, kind: kind, label: str(r.label, LIMITS.label) || (kind === 'review' ? '階段驗收' : '工程項目'), segs: [], notes: [] };
      var segs = (Array.isArray(r.segs) ? r.segs : []).filter(function (g) { return g && isIso(g.s) && isIso(g.e) && yearOk(g.s) && yearOk(g.e) && Math.abs(diffDays(g.s, g.e)) <= 400; });
      if (kind === 'trade') row.segs = normalizeSegs(segs).slice(0, LIMITS.segsPerRow);
      else row.segs = segs.map(function (g) { return { id: g.id || newId(), s: g.s, e: g.s }; }).filter(function (g, i, a) { return a.findIndex(function (x) { return x.s === g.s; }) === i; }).sort(function (a, b) { return cmp(a.s, b.s); }).slice(0, LIMITS.segsPerRow);   // 驗收列只有單日標記
      var seen = {};
      (Array.isArray(r.notes) ? r.notes : []).forEach(function (t) { if (!t || !isIso(t.d) || !yearOk(t.d) || seen[t.d]) return; var text = str(t.t, LIMITS.noteText); if (!text) return; seen[t.d] = 1; row.notes.push({ id: t.id || newId(), d: t.d, t: text }); });
      row.notes.sort(function (a, b) { return cmp(a.d, b.d); }); row.notes = row.notes.slice(0, LIMITS.notesPerRow);
      out.rows.push(row);
    });
    if (!out.rows.some(function (r) { return r.kind === 'trade'; })) throw new Error('至少要有一列工程項目');
    var json = JSON.stringify(out); if (json.length > LIMITS.bytes) throw new Error('進度表資料過大（' + json.length + ' 字），請精簡註記');
    return out;
  }

  /** Notion rich_text 每段最多 2000 字：切段／還原 */
  function chunk(s, size) { size = size || 2000; var out = []; for (var i = 0; i < s.length; i += size) out.push(s.slice(i, i + size)); return out; }
  function join(parts) { return (parts || []).join(''); }

  var api = { WEEK: WEEK, LIMITS: LIMITS, PAPERS: PAPERS, NATIONAL: NATIONAL, NATIONAL_NOTE: NATIONAL_NOTE, TEMPLATE_TRADES: TEMPLATE_TRADES,
    isIso: isIso, addDays: addDays, diffDays: diffDays, dow: dow, weekLabel: weekLabel, monthOf: monthOf, dayOf: dayOf, yearOf: yearOf, newId: newId,
    monthStart: monthStart, monthEnd: monthEnd, daysInMonth: daysInMonth, addMonths: addMonths, monthsBetween: monthsBetween,
    nationalHolidays: nationalHolidays, holidayMap: holidayMap, isWorkday: isWorkday, dayKind: dayKind,
    normalizeSegs: normalizeSegs, numbering: numbering, rowWorkdays: rowWorkdays, projectRange: projectRange, projectCounter: projectCounter, summary: summary,
    lastDate: lastDate, pagesNeeded: pagesNeeded, pageDates: pageDates, pageRange: pageRange,
    moveSeg: moveSeg, resizeSeg: resizeSeg, segAt: segAt, removeDay: removeDay, template: template, validate: validate, chunk: chunk, join: join };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ScheduleCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
