/* ============================================================
   ¥10000 投资实验 — 渲染与图表逻辑
   V2: 支持 真实数据(real_data.json)/ 演示数据 双模式
   ============================================================ */
(function () {
  "use strict";

  const E = EXPERIMENT;
  const $ = (id) => document.getElementById(id);

  /* ---------- 模式 ---------- */
  let MODE = localStorage.getItem("exp_mode") === "demo" ? "demo" : "real"; // 默认真实
  let REAL = null;      // real_data.json
  let PORT = null;      // portfolio_history.json(真实净值)

  /* ---------- 工具 ---------- */
  const fmt = (n, d = 2) => {
    if (n == null || isNaN(n)) return "—";
    return n.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const dateOf = (day) => {
    const d = new Date(E.startDate);
    d.setDate(d.getDate() + day - 1);
    return d;
  };
  const dateStr = (day) => {
    const d = dateOf(day);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 当前数据源(真实/演示) ---------- */
  function D() {
    if (MODE === "real" && REAL) {
      return Object.assign({}, E, {
        pool: REAL.pool,
        scores: REAL.scores,
        weights: REAL.weights.map((w, i) => ({ name: w.name || ["估值", "盈利能力", "成长性", "趋势", "波动风险"][i], w: w.w })),
        meta: REAL.meta,
        benchmark: REAL.benchmark,
        isReal: true,
      });
    }
    return Object.assign({}, E, { isReal: false });
  }

  /* ---------- 账户数据(演示) ---------- */
  function demoAccount() {
    const trades = E.trades;
    const realized = trades.reduce((s, t) => s + (t.sellPrice != null ? (t.sellPrice - t.buyPrice) * t.qty : 0), 0);
    const unrealized = trades.reduce((s, t) => s + (t.sellPrice == null ? (t.currentPrice - t.buyPrice) * t.qty : 0), 0);
    const closedCount = trades.filter((t) => t.sellPrice != null).length;
    const winCount = trades.filter((t) => t.sellPrice != null && t.sellPrice > t.buyPrice).length;
    const currentValue = E.capital + realized + unrealized;
    return {
      realized, unrealized, closedCount, winCount,
      winRate: (winCount / closedCount) * 100,
      currentValue,
      totalReturn: (currentValue / E.capital - 1) * 100,
      trades,
    };
  }

  /* ---------- 净值序列(演示,种子可复现) ---------- */
  function buildSeries(seed, days, meanShift, vol, targetEnd) {
    const rng = mulberry32(seed);
    const s = [10000];
    for (let i = 1; i <= days; i++) {
      const r = (rng() - 0.5 + meanShift) * vol;
      s.push(s[i - 1] * (1 + r));
    }
    const scale = targetEnd / s[days];
    for (let i = 0; i <= days; i++) s[i] *= scale;
    return s;
  }

  /* ============================================================
     顶栏 / 模式
     ============================================================ */
  function renderMode() {
    const badge = $("dataBadge");
    const btn = $("modeToggle");
    const d = D();
    if (MODE === "real" && REAL) {
      document.body.dataset.mode = "real";
      badge.innerHTML = `<span class="dot-live"></span>真实数据 · ${(REAL.meta.generated_at || "").slice(0, 10)}`;
      btn.textContent = "查看演示";
    } else {
      document.body.dataset.mode = "demo";
      badge.innerHTML = `<span class="dot-demo"></span>演示数据`;
      btn.textContent = "切换到真实数据";
    }
  }

  function renderDayBadge() {
    const d = D();
    const el = $("dayBadge");
    if (MODE === "real" && REAL) {
      el.textContent = `REAL · ${(REAL.meta.generated_at || "").slice(0, 10)}`;
      return;
    }
    const D_ = E.currentDay;
    el.textContent = `DAY ${D_} / ${E.totalDays}`;
    const circ = 2 * Math.PI * 52;
    const fg = $("ringFg");
    if (fg) { fg.style.strokeDasharray = circ; fg.style.strokeDashoffset = circ * (1 - D_ / E.totalDays); }
  }

  /* ============================================================
     Hero / 数据条
     ============================================================ */
  function renderHeroStats() {
    const d = D();
    let items;
    if (MODE === "real" && REAL) {
      const cap = 10000;
      items = [
        { k: "实验本金", v: `¥${fmt(cap, 0)}`, cls: "" },
        { k: "持仓市值", v: PORT ? `¥${fmt(PORT.total, 0)}` : "¥10,000", cls: "" },
        { k: "累计收益", v: PORT ? `${PORT.totalReturn >= 0 ? "+" : ""}${fmt(PORT.totalReturn)}%` : "+0.00%", cls: PORT && PORT.totalReturn < 0 ? "down" : "up" },
        { k: "数据源", v: "东方财富", cls: "" },
        { k: "更新时间", v: (REAL.meta.generated_at || "").slice(11), cls: "" }
      ];
    } else {
      const a = demoAccount();
      const nav = demoNav();
      items = [
        { k: "累计收益", v: `${a.totalReturn >= 0 ? "+" : ""}${fmt(a.totalReturn)}%`, cls: a.totalReturn >= 0 ? "up" : "down" },
        { k: "今日收益", v: `${nav.todayReturn >= 0 ? "+" : ""}${fmt(nav.todayReturn)}%`, cls: nav.todayReturn >= 0 ? "up" : "down" },
        { k: "最大回撤", v: `${fmt(nav.maxDD)}%`, cls: "down" },
        { k: "胜率", v: `${fmt(a.winRate, 1)}%`, cls: "" },
        { k: "交易次数", v: `${a.trades.length} 笔`, cls: "" }
      ];
    }
    $("heroStats").innerHTML = items.map((it) =>
      `<div class="hstat"><div class="k">${it.k}</div><div class="v ${it.cls}">${it.v}</div></div>`
    ).join("");
  }

  function renderStatStrip() {
    const d = D();
    let items;
    if (MODE === "real" && REAL) {
      const b = REAL.benchmark;
      items = [
        { k: "沪深300", v: `${b && b.change_pct != null ? (b.change_pct >= 0 ? "+" : "") + fmt(b.change_pct) + "%" : "—"}`, cls: b && b.change_pct < 0 ? "down" : "up" },
        { k: "沪深300现价", v: b ? fmt(b.price) : "—", cls: "" },
        { k: "候选池", v: `${REAL.pool.length} 只`, cls: "" },
        { k: "今日信号", v: REAL.scores.filter((s) => s.grade === "A" || s.grade === "B").length + " 只关注", cls: "" },
        { k: "卖出信号", v: REAL.pool.filter((s) => s.grade === "D").length + " 只", cls: "down" }
      ];
    } else {
      const a = demoAccount();
      items = [
        { k: "已实现收益", v: `${a.realized >= 0 ? "+" : ""}¥${fmt(a.realized)}`, cls: a.realized >= 0 ? "up" : "down" },
        { k: "持仓浮盈", v: `${a.unrealized >= 0 ? "+" : ""}¥${fmt(a.unrealized)}`, cls: a.unrealized >= 0 ? "up" : "down" },
        { k: "沪深300", v: `+${fmt(E.benchHS300)}%`, cls: "up" },
        { k: "标普500", v: `+${fmt(E.benchSP500)}%`, cls: "up" },
        { k: "剩余天数", v: `${E.totalDays - E.currentDay} 天`, cls: "" }
      ];
    }
    $("statStrip").innerHTML = items.map((it) =>
      `<div class="strip-item"><span class="k">${it.k}</span><span class="v ${it.cls}">${it.v}</span></div>`
    ).join("");
  }

  /* ---------- Hero 主区(真实模式覆盖) ---------- */
  function renderHeroMain() {
    if (!(MODE === "real" && REAL)) return; // 演示模式用 HTML 静态 + JS 补充
    const panel = document.querySelector(".hero-main");
    if (!panel) return;
    const from = document.querySelector(".money-from");
    const to = document.querySelector(".money-to");
    const pill = document.querySelector(".return-pill");
    const note = document.querySelector(".money-note");
    if (from) from.textContent = "¥10,000";
    if (to) {
      to.textContent = PORT ? `¥${fmt(PORT.total, 0)}` : "¥10,000";
      to.style.color = "var(--text)";
    }
    if (pill) {
      const v = PORT ? PORT.totalReturn : 0;
      pill.textContent = `${v >= 0 ? "+" : ""}${fmt(v)}%`;
      pill.className = "return-pill " + (v < 0 ? "down" : "up");
    }
    if (note) {
      note.innerHTML = MODE === "real" && REAL
        ? `真实数据已接入 · 等待第 1 笔真实交易,净值曲线将自动生成`
        : note.innerHTML;
    }
  }

  /* ---------- 演示净值 ---------- */
  function demoNav() {
    const D_ = E.currentDay;
    const acct = demoAccount();
    const navYesterday = acct.currentValue / 1.0081;
    const nav = buildSeries(20260805, D_ - 1, 0.003, 0.02, navYesterday);
    nav.push(acct.currentValue);
    const bench = buildSeries(20260806, D_, -0.001, 0.016, E.capital * (1 + E.benchHS300 / 100));
    let peak = nav[0], maxDD = 0;
    nav.forEach((v) => { peak = Math.max(peak, v); maxDD = Math.min(maxDD, (v / peak - 1) * 100); });
    return { nav, bench, maxDD, todayReturn: (nav[D_] / nav[D_ - 1] - 1) * 100 };
  }

  /* ============================================================
     收益曲线(演示 SVG / 真实空态)
     ============================================================ */
  function renderChart() {
    const svg = $("curveChart");
    const wrap = $("chartWrap");
    const label = $("chartEndLabel");
    if (!svg) return;

    // 真实模式:有真实净值则画,否则空态
    if (MODE === "real" && REAL) {
      if (PORT && PORT.series && PORT.series.length >= 2) {
        drawRealCurve(PORT.series);
        if (label) label.textContent = `截至 ${PORT.series[PORT.series.length - 1].date} · ¥${fmt(PORT.total, 0)}`;
        return;
      }
      svg.innerHTML = "";
      wrap.querySelector(".chart-empty")?.remove();
      const empty = document.createElement("div");
      empty.className = "chart-empty";
      empty.innerHTML = `
        <div class="ce-ico">¥</div>
        <p class="ce-title">真实净值曲线待生成</p>
        <p class="ce-sub">每天收盘后运行 <code>python3 update_data.py</code>,并在后台「交易执行台」录入真实成交,<br>净值曲线将按真实持仓自动绘制。</p>
        <a class="ce-btn" href="recommend.html#trading">前往交易执行台</a>`;
      wrap.appendChild(empty);
      if (label) label.textContent = "等待真实交易记录";
      return;
    }

    // 演示模式:SVG 曲线
    const { nav, bench, maxDD } = demoNav();
    const D_ = E.currentDay;
    const W = 1040, H = 340, PL = 10, PR = 14, PT = 20, PB = 26;
    const iw = W - PL - PR, ih = H - PT - PB;
    const all = nav.concat(bench);
    let vMin = Math.min(...all), vMax = Math.max(...all);
    const pad = (vMax - vMin) * 0.08;
    vMin -= pad; vMax += pad;
    const x = (i) => PL + (iw * i) / D_;
    const y = (v) => PT + ih - ((v - vMin) / (vMax - vMin)) * ih;
    const linePts = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const areaPts = (arr) => `${PL},${(PT + ih).toFixed(1)} ` + linePts(arr) + ` ${(PL + iw).toFixed(1)},${(PT + ih).toFixed(1)}`;

    let grid = "";
    for (let g = 0; g <= 4; g++) {
      const gy = PT + (ih * g) / 4;
      grid += `<line x1="${PL}" y1="${gy}" x2="${PL + iw}" y2="${gy}" stroke="#16223a" stroke-width="1"/>`;
      const gv = vMax - ((vMax - vMin) * g) / 4;
      grid += `<text x="${PL - 6}" y="${gy + 4}" text-anchor="end" fill="#64718a" font-size="11" font-family="SF Mono,Menlo,monospace">${gv >= 10000 ? (gv / 10000).toFixed(2) + "w" : gv.toFixed(0)}</text>`;
    }
    for (let g = 0; g <= D_; g += 5) {
      grid += `<text x="${x(g)}" y="${H - 8}" text-anchor="middle" fill="#64718a" font-size="10.5" font-family="SF Mono,Menlo,monospace">D${g === 0 ? 1 : g}</text>`;
    }

    let marks = "";
    E.trades.forEach((t) => {
      if (t.buyDay > D_) return;
      marks += `<circle cx="${x(t.buyDay)}" cy="${y(nav[t.buyDay])}" r="5" fill="#e8b84b" stroke="#0a0e17" stroke-width="1.6" class="mark-buy"/>`;
      if (t.sellDay != null && t.sellDay <= D_) {
        marks += `<circle cx="${x(t.sellDay)}" cy="${y(nav[t.sellDay])}" r="5" fill="#5b8cff" stroke="#0a0e17" stroke-width="1.6" class="mark-sell"/>`;
      }
    });

    const lastX = x(D_), lastY = y(nav[D_]);
    svg.innerHTML = `
      <defs>
        <linearGradient id="comboFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e8b84b" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#e8b84b" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${grid}
      <polyline points="${linePts(bench)}" fill="none" stroke="#5b8cff" stroke-width="2" stroke-opacity="0.7"/>
      <polygon points="${areaPts(nav)}" fill="url(#comboFill)" stroke="none"/>
      <polyline points="${linePts(nav)}" fill="none" stroke="#e8b84b" stroke-width="2.6"/>
      ${marks}
      <circle cx="${lastX}" cy="${lastY}" r="6" fill="#e8b84b" stroke="#0a0e17" stroke-width="2"/>
      <text x="${Math.min(lastX + 10, W - 60)}" y="${lastY - 12}" fill="#e8b84b" font-size="12" font-family="SF Mono,Menlo,monospace" font-weight="700">¥${fmt(nav[D_])}</text>
      <line id="vline" x1="0" y1="${PT}" x2="0" y2="${PT + ih}" stroke="#3a4a6b" stroke-width="1" stroke-dasharray="4 3" opacity="0"/>`;

    const tooltip = $("chartTooltip");
    svg.addEventListener("mousemove", (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(D_, Math.round((px - PL) / (iw / D_))));
      const vx = x(i), vy = y(nav[i]);
      const vlineEl = $("vline");
      vlineEl.setAttribute("x1", vx); vlineEl.setAttribute("x2", vx);
      vlineEl.setAttribute("opacity", "1");
      const ret = (nav[i] / E.capital - 1) * 100;
      const bret = (bench[i] / E.capital - 1) * 100;
      tooltip.innerHTML = `
        <div class="tt-day">DAY ${i} · ${dateStr(i)}</div>
        <div class="tt-row"><span style="color:#e8b84b">本实验</span><b>¥${fmt(nav[i])} (${ret >= 0 ? "+" : ""}${fmt(ret)}%)</b></div>
        <div class="tt-row"><span style="color:#5b8cff">沪深300</span><b>${bret >= 0 ? "+" : ""}${fmt(bret)}%</b></div>`;
      tooltip.style.opacity = "1";
      const rp = (vx / W) * 100;
      tooltip.style.left = `${rp}%`;
      tooltip.style.top = `${Math.min((vy / H) * 100, 78)}%`;
      tooltip.style.transform = `translateX(${rp > 55 ? "-100%" : "0"}) translateY(-110%)`;
    });
    svg.addEventListener("mouseleave", () => {
      tooltip.style.opacity = "0";
      const vlineEl = $("vline");
      if (vlineEl) vlineEl.setAttribute("opacity", "0");
    });
    if (label) label.textContent = `DAY ${D_} · ¥${fmt(nav[D_])}`;
  }

  function drawRealCurve(series) {
    const svg = $("curveChart");
    const W = 1040, H = 340, PL = 10, PR = 14, PT = 20, PB = 26;
    const iw = W - PL - PR, ih = H - PT - PB;
    const vals = series.map((s) => s.value);
    let vMin = Math.min(...vals), vMax = Math.max(...vals);
    const pad = (vMax - vMin) * 0.1 || 100;
    vMin -= pad; vMax += pad;
    const x = (i) => PL + (iw * i) / Math.max(series.length - 1, 1);
    const y = (v) => PT + ih - ((v - vMin) / (vMax - vMin)) * ih;
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const area = `${PL},${(PT + ih).toFixed(1)} ` + pts + ` ${(PL + iw).toFixed(1)},${(PT + ih).toFixed(1)}`;
    let grid = "";
    for (let g = 0; g <= 4; g++) {
      const gy = PT + (ih * g) / 4;
      grid += `<line x1="${PL}" y1="${gy}" x2="${PL + iw}" y2="${gy}" stroke="#16223a" stroke-width="1"/>`;
      const gv = vMax - ((vMax - vMin) * g) / 4;
      grid += `<text x="${PL - 6}" y="${gy + 4}" text-anchor="end" fill="#64718a" font-size="11" font-family="SF Mono,Menlo,monospace">¥${gv >= 10000 ? (gv / 10000).toFixed(2) + "w" : Math.round(gv)}</text>`;
    }
    const last = series[series.length - 1];
    const lx = x(series.length - 1), ly = y(last.value);
    svg.innerHTML = `
      <defs>
        <linearGradient id="comboFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e8b84b" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#e8b84b" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${grid}
      <polygon points="${area}" fill="url(#comboFill)" stroke="none"/>
      <polyline points="${pts}" fill="none" stroke="#e8b84b" stroke-width="2.6"/>
      <circle cx="${lx}" cy="${ly}" r="6" fill="#e8b84b" stroke="#0a0e17" stroke-width="2"/>
      <text x="${Math.min(lx + 10, W - 60)}" y="${ly - 12}" fill="#e8b84b" font-size="12" font-family="SF Mono,Menlo,monospace" font-weight="700">¥${fmt(last.value, 0)}</text>`;
  }

  /* ============================================================
     今日策略(真实/演示共用,数据来自 D().scores)
     ============================================================ */
  function renderScores() {
    const d = D();
    const gradeCls = { A: "buy", B: "watch", C: "observe", D: "sell" };
    const weights = d.weights;
    const rows = d.scores.map((s, idx) => {
      const total = s.dims.reduce((a, dv, wi) => a + dv * (weights[wi] ? weights[wi].w : 20), 0) / 100;
      const dimBars = s.dims.map((dv) => {
        const color = dv >= 80 ? "#e8b84b" : dv >= 60 ? "#5b8cff" : "#ff5257";
        return `<span class="dim"><span class="dbar"><span class="dfill" style="width:${dv}%;background:${color}"></span></span><span class="dval">${dv}</span></span>`;
      }).join("");
      return `<tr>
        <td class="rank ${idx === 0 ? "rank-1" : ""}">${idx + 1}</td>
        <td><span class="stock"><span class="sname">${s.name}</span><span class="scode">${s.code}</span></span></td>
        <td><span class="grade ${gradeCls[s.grade] || "observe"}">${s.grade} · ${s.action}</span></td>
        <td class="score-num">${fmt(total, 1)}</td>
        <td colspan="6" class="dims-cell"><div class="dims-grid">${dimBars}</div></td>
      </tr>`;
    });
    $("scoreTable").querySelector("tbody").innerHTML = rows.join("");

    const top = d.scores[0];
    if (top) {
      const topTotal = top.dims.reduce((a, dv, wi) => a + dv * (weights[wi] ? weights[wi].w : 20), 0) / 100;
      const t = (REAL && MODE === "real") ? "真实数据" : "演示数据";
      $("strategyCallout").innerHTML =
        `今日观察池第一名 <b>${top.name}(${top.code})</b> 综合评分 <b>${fmt(topTotal, 1)}</b>,评级 <b>${top.grade} · ${top.action}</b>。` +
        `${t} · 信号仅供参考,不构成投资建议;执行与否、是否真实下单,由你在券商完成并录入后台。`;
    }
  }

  /* ============================================================
     今日操作 / 日志 / 历史(真实模式为空态)
     ============================================================ */
  function renderEmptyState(elId, title, sub, cta) {
    const el = $(elId);
    if (!el) return;
    el.innerHTML = `
      <div class="empty-box">
        <div class="ce-ico">¥</div>
        <p class="ce-title">${title}</p>
        <p class="ce-sub">${sub}</p>
        ${cta ? `<a class="ce-btn" href="${cta.href}">${cta.text}</a>` : ""}
      </div>`;
  }

  function renderOps() {
    if (MODE === "real" && REAL) {
      renderEmptyState("opsList", "今日真实操作待记录",
        "在券商 App 完成交易后,到「交易执行台」录入真实成交(带时间戳,不可事后修改)。", { href: "recommend.html#trading", text: "前往交易执行台" });
      return;
    }
    const sideCls = { buy: "buy", sell: "sell", skip: "hold" };
    const sideText = { buy: "买入", sell: "卖出", skip: "未执行" };
    $("opsList").innerHTML = E.ops.map((o) => `
      <li class="op-item">
        <span class="op-time">${dateStr(E.currentDay)} ${o.time}</span>
        <span class="op-side ${sideCls[o.side]}">${sideText[o.side]}</span>
        <span class="op-main">
          <span class="oname">${o.name} <span class="scode" style="font-family:var(--font-num);font-size:11.5px;color:var(--text-faint)">${o.code}</span></span>
          <div class="onote">${o.note}</div>
        </span>
        ${o.qty ? `<span class="op-amount">¥${fmt(o.amount)}</span><span class="op-price">${o.qty} 股 @ ${fmt(o.price)}</span>` : `<span class="op-amount" style="color:var(--text-faint)">¥${fmt(o.price, 0)}</span>`}
      </li>
    `).join("");
  }

  function renderLogs() {
    if (MODE === "real" && REAL) {
      renderEmptyState("logList", "每日日志从第 1 笔交易开始",
        "执行交易并录入后,这里将每天自动生成一条固定模板的实验日志(Day N:持仓/收益/操作/策略第一名/是否执行)。");
      return;
    }
    const typeCls = { buy: "buy", sell: "sell", hold: "hold" };
    $("logList").innerHTML = E.logs.map((l) => `
      <div class="log-item">
        <div class="log-day">
          <span class="d">${l.day}</span>
          <span class="dl">/ ${E.totalDays} DAY</span>
          <span class="dv">¥${fmt(l.value)}</span>
          <span class="dr ${l.dayReturn >= 0 ? "up" : "down"}">${l.dayReturn >= 0 ? "+" : ""}${fmt(l.dayReturn)}%</span>
        </div>
        <div class="log-body">
          <div class="l-actions">
            ${l.actions.map((a) => `<span class="chip ${typeCls[a.type]}">${a.text}</span>`).join("")}
          </div>
          <p class="l-summary">${l.summary}</p>
          <div class="l-meta">策略第一名:<b> ${l.topPick}</b></div>
          <div class="l-exec ${l.executed ? "exec-yes" : "exec-no"}">${l.executed ? "✓ 我执行了" : "✗ 我未执行 —— 记录原因,遵守纪律"}</div>
        </div>
      </div>
    `).join("");
  }

  function renderTrades() {
    const label = $("tradeCountLabel");
    if (MODE === "real" && REAL) {
      if (label) label.textContent = "真实成交记录:将在「交易执行台」录入后显示(时间戳固定)。";
      renderEmptyState("tradesTableBody", "暂无真实成交",
        "每笔真实成交录入后都会带固定时间戳保存在这里,半年后可完整验证。", { href: "recommend.html#trading", text: "前往交易执行台" });
      return;
    }
    if (label) label.textContent = `DAY 01 至今全部 ${E.trades.length} 笔交易,时间戳固定。`;
    const rows = E.trades.map((t) => {
      const closed = t.sellPrice != null;
      const pnl = closed ? (t.sellPrice - t.buyPrice) * t.qty : (t.currentPrice - t.buyPrice) * t.qty;
      const pnlCls = pnl > 0 ? "pnl-pos" : pnl < 0 ? "pnl-neg" : "pnl-na";
      return `<tr>
        <td class="mono">D${t.buyDay}</td>
        <td class="mono">${dateStr(t.buyDay)}</td>
        <td class="mono">${t.buyDay} → ${closed ? "D" + t.sellDay : "持有中"}</td>
        <td><span class="stock"><span class="sname">${t.name}</span><span class="scode">${t.code}</span></span></td>
        <td class="mono">${t.qty}</td>
        <td class="mono">${fmt(t.buyPrice)}${closed ? ` → ${fmt(t.sellPrice)}` : ""}</td>
        <td class="mono">¥${fmt(t.buyPrice * t.qty)}</td>
        <td class="mono ${pnlCls}">${closed ? `${pnl >= 0 ? "+" : ""}¥${fmt(pnl)}` : `浮盈 +¥${fmt(Math.max(0, pnl))}`}</td>
        <td><span class="trade-status ${closed ? "closed" : "open"}">${closed ? "已平仓" : "持仓中"}</span></td>
      </tr>`;
    });
    $("tradesTableBody").innerHTML = rows.join("");
  }

  /* ---------- 权重 ---------- */
  function renderWeights() {
    const d = D();
    $("weightBars").innerHTML = d.weights.map((w) => `
      <div class="weight-bar-row">
        <span class="wk">${w.name}</span>
        <span class="wb"><span class="wfill" data-w="${w.w}"></span></span>
        <span class="wv">${w.w}%</span>
      </div>
    `).join("");
    requestAnimationFrame(() => {
      document.querySelectorAll(".wfill").forEach((el) => { el.style.width = el.dataset.w + "%"; });
    });
  }

  /* ---------- 移动端菜单 ---------- */
  function initMobileMenu() {
    const btn = $("menuBtn");
    const menu = $("mobileMenu");
    if (!btn || !menu) return;
    btn.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      btn.classList.toggle("active", open);
    });
    menu.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        menu.classList.remove("open");
        btn.classList.remove("active");
      });
    });
  }

  /* ============================================================
     今日学堂(每天 3 个词)
     ============================================================ */
  function renderLesson() {
    const grid = $("lessonGrid");
    const prog = $("lessonProgress");
    if (!grid) return;
    const list = window.GLOSSARY || [];
    if (!list.length) { grid.innerHTML = ""; return; }
    const daily = window.GLOSSARY_DAILY || 3;
    const start = new Date(window.GLOSSARY_START + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayIndex = Math.max(0, Math.floor((today - start) / 86400000));
    const total = list.length;
    const unlocked = Math.min(total, (dayIndex + 1) * daily);
    const todayWords = list.slice(dayIndex * daily, dayIndex * daily + daily);

    grid.innerHTML = todayWords.map((g, i) => {
      const learned = ((localStorage.getItem("exp_learned") || "").split(",")).indexOf(g.word) > -1;
      return `
        <div class="lesson-card ${learned ? "learned" : ""}">
          <div class="lc-head">
            <span class="lc-no">第 ${dayIndex * daily + i + 1} 词</span>
            <span class="lc-cat">${g.cat}</span>
            <button class="lc-done ${learned ? "on" : ""}" data-word="${g.word}" type="button">${learned ? "✓ 已学" : "标记已学"}</button>
          </div>
          <div class="lc-word">${g.word}</div>
          <div class="lc-py">${g.pinyin}</div>
          <p class="lc-plain">${g.plain}</p>
          <p class="lc-example"><span class="lc-ex-tag">真实例子</span>${g.example}</p>
          <p class="lc-tip"><span class="lc-tip-tag">小贴士</span>${g.tip}</p>
        </div>`;
    }).join("");

    prog.innerHTML = `学习进度:已解锁 <b>${unlocked}</b> / ${total} 个词(今天是第 ${dayIndex + 1} 课)<br>
      <span style="color:var(--text-faint);font-size:12px">每学一个词点「标记已学」,进度保存在本机。全部词典见 <a href="learn.html" style="color:var(--gold)">投资学堂</a></span>`;

    grid.querySelectorAll(".lc-done").forEach((btn) => {
      btn.addEventListener("click", () => {
        const w = btn.dataset.word;
        let seen = (localStorage.getItem("exp_learned") || "").split(",").filter(Boolean);
        if (btn.classList.contains("on")) {
          seen = seen.filter((x) => x !== w);
          btn.classList.remove("on");
          btn.textContent = "标记已学";
        } else {
          seen.push(w);
          btn.classList.add("on");
          btn.textContent = "✓ 已学";
        }
        localStorage.setItem("exp_learned", seen.join(","));
      });
    });
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    // 真实数据通过 script 标签加载(JSONP,file:// 下可用);见 index.html 中 real_data.js
    REAL = window.REAL_DATA || null;
    PORT = window.PORTFOLIO || null;

    renderMode();
    renderDayBadge();
    renderHeroMain();
    renderHeroStats();
    renderStatStrip();
    renderChart();
    renderScores();
    renderOps();
    renderLogs();
    renderTrades();
    renderLesson();
    renderWeights();

    const toggle = $("modeToggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        MODE = MODE === "real" ? "demo" : "real";
        localStorage.setItem("exp_mode", MODE);
        // 演示模式刷新为演示数据;真实模式需 real_data.js 已生成
        if (MODE === "real" && !REAL) {
          alert("未找到真实数据 —— 请先运行 python3 update_data.py 生成 real_data.js。");
          MODE = "demo";
          localStorage.setItem("exp_mode", "demo");
        }
        boot();
      });
    }
    initMobileMenu();
  }

  boot();
})();
