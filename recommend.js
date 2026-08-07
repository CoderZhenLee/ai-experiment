/* ============================================================
   策略推荐后台 V2 — 真实数据 + 研报级子指标拆解 + 交易执行台
   ============================================================ */
(function () {
  "use strict";

  const E = EXPERIMENT;
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 2) => {
    if (n == null || isNaN(n)) return "—";
    return n.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const DIM_NAMES = ["估值", "盈利能力", "成长性", "趋势", "波动风险", "新闻情绪"];
  const DIM_KEY = (n) => n
    .replace("估值", "val").replace("盈利能力", "pro").replace("成长性", "gro")
    .replace("趋势", "tre").replace("波动风险", "vol").replace("新闻情绪", "senti");
  const LS_TRADES = "exp_trades_v1";
  const LS_ORDERS = "exp_orders_v1";

  /* ---------- 订单存储 ---------- */
  function loadOrders() {
    try { return JSON.parse(localStorage.getItem(LS_ORDERS)) || []; }
    catch (e) { return []; }
  }
  function saveOrders(list) { localStorage.setItem(LS_ORDERS, JSON.stringify(list)); }

  /* ---------- 生成今日订单(每天一次,去重) ----------
     买入订单: 评级 A/B 且一手金额 ≤ 总资产90%
     卖出订单: 持仓中评级 D
     超预算: 自动标记"已跳过"(按纪律不执行)
  */
  function ensureOrders(d, trades, ranked) {
    const today = new Date().toISOString().slice(0, 10);
    let orders = loadOrders();
    if (orders.some((o) => o.date === today)) return orders;

    const pos = computeHoldings(trades, d).positions;
    const heldMap = {};
    pos.forEach((p) => { heldMap[p.code] = p.qty; });

    const created = [];
    ranked.slice(0, 5).forEach((r) => {
      const { g, text } = gradeOf(r.total);
      const s = r.s;
      const price = s.quote && s.quote.price;
      if (!price) return;
      if (g === "A" || g === "B") {
        if (price * 100 > 10000 * 0.9) {
          created.push({
            date: today, code: s.code, name: s.name, side: "buy",
            qty: 100, price, amount: Math.round(price * 100),
            grade: g, action: text, status: "skipped",
            reason: "一手金额 ¥" + fmt(price * 100, 0) + " 超过单笔预算(≈¥1,000),按纪律不执行",
            ts: new Date().toISOString().slice(0, 19),
          });
        } else {
          const qty = suggestQty(price, d.weights);
          created.push({
            date: today, code: s.code, name: s.name, side: "buy",
            qty, price, amount: Math.round(qty * price),
            grade: g, action: text, status: "pending",
          });
        }
      } else if (g === "D" && heldMap[s.code]) {
        created.push({
          date: today, code: s.code, name: s.name, side: "sell",
          qty: heldMap[s.code], price, amount: Math.round(heldMap[s.code] * price),
          grade: g, action: text, status: "pending",
        });
      }
    });
    // 持仓中评级 D 但不在前 5 的,也补卖出订单
    Object.keys(heldMap).forEach((code) => {
      if (created.some((o) => o.code === code)) return;
      const r = ranked.find((x) => x.s.code === code);
      if (!r) return;
      const { g, text } = gradeOf(r.total);
      const price = r.s.quote && r.s.quote.price;
      if (g === "D" && price) {
        created.push({
          date: today, code: r.s.code, name: r.s.name, side: "sell",
          qty: heldMap[code], price, amount: Math.round(heldMap[code] * price),
          grade: g, action: text, status: "pending",
        });
      }
    });
    orders = orders.concat(created);
    saveOrders(orders);
    return orders;
  }

  /* ---------- 订单操作 ---------- */
  function applyConfirm(d, idx, price, qty) {
    const orders = loadOrders();
    const o = orders[idx];
    if (!o || o.status !== "pending") return false;
    o.status = "done";
    o.finalPrice = price;
    o.qty = qty;
    o.ts = new Date().toISOString().slice(0, 19);
    saveOrders(orders);
    const trades = loadTrades();
    trades.push({ ts: o.ts, side: o.side, code: o.code, name: o.name, qty, price });
    saveTrades(trades);
    return true;
  }
  function confirmOrder(d, idx, price, qty) {
    if (applyConfirm(d, idx, price, qty)) renderTrading(d);
  }
  function confirmBatch(d, items) {
    items.forEach((it) => applyConfirm(d, it.idx, it.price, it.qty));
    renderTrading(d);
  }
  function skipOrder(d, idx, reason) {
    const orders = loadOrders();
    const o = orders[idx];
    if (!o || o.status !== "pending") return;
    o.status = "skipped";
    o.reason = reason || "手动决定不执行";
    saveOrders(orders);
    renderTrading(d);
  }

  function renderOrderCard(o, i) {
    const sideCls = o.side === "buy" ? "dir-buy" : "dir-sell";
    const sideText = o.side === "buy" ? "买入" : "卖出";
    const stCls = o.status === "done" ? "st-done" : o.status === "skipped" ? "st-skip" : "st-pending";
    const stText = o.status === "done" ? "已成交" : o.status === "skipped" ? "已跳过" : "待确认";
    return `
      <div class="order-card ${stCls}" data-idx="${i}">
        <div class="sig-head">
          ${o.status === "pending" ? `<label class="ord-check" title="选择此订单"><input type="checkbox" class="oc-check" data-idx="${i}"></label>` : ""}
          <span class="sig-rank">#${i + 1}</span>
          <span class="ord-side ${sideCls}">${sideText}</span>
          <b>${o.name} ${o.code}</b>
          <span class="order-status ${stCls}">${stText}</span>
          <span class="grade ${GRADE_CLS[o.grade] || "observe"}" style="margin-left:auto">${o.grade} · ${o.action}</span>
        </div>
        <div class="sig-body">
          ${o.side === "buy"
            ? `<span>建议 <b>${o.qty} 股</b> ≈ ¥${fmt(o.amount, 0)}</span><span class="mono" style="color:var(--text-faint)">参考价 ¥${fmt(o.price)}</span>`
            : `<span>建议卖出 <b>${o.qty} 股</b> ≈ ¥${fmt(o.amount, 0)}</span><span class="mono" style="color:var(--text-faint)">参考价 ¥${fmt(o.price)}</span>`}
        </div>
        ${o.status === "pending" ? `
          <div class="ord-actions">
            <button class="ord-pay" data-act="pay">✓ 支付成功 · 记录成交</button>
            <button class="ord-skip" data-act="skip">✗ 跳过(不执行)</button>
          </div>
          <div class="ord-confirm" style="display:none">
            <p class="ord-confirm-tip">在券商 App 已完成该笔交易?填写实际成交信息后自动记账:</p>
            <div class="ord-confirm-grid">
              <label>成交价<input type="number" class="oc-price" value="${o.price}" step="0.01" min="0.01"></label>
              <label>数量<input type="number" class="oc-qty" value="${o.qty}" step="1" min="1"></label>
              <button class="dm-export oc-ok" type="button">确认 · 记录成交</button>
              <button class="we-reset oc-cancel" type="button">取消</button>
            </div>
          </div>` : ""}
        ${o.status === "done" ? `
          <div class="ord-done-info">✓ 已成交 ${(o.ts || "").slice(5, 16)} · ${o.qty} 股 @ ¥${fmt(o.finalPrice)} = ¥${fmt(o.qty * o.finalPrice, 0)}</div>` : ""}
        ${o.status === "skipped" && o.reason ? `<div class="ord-skip-info">跳过原因:${o.reason}</div>` : ""}
      </div>`;
  }

  /* ---------- 批量操作 ---------- */
  function updateBatchUI() {
    const n = document.querySelectorAll(".oc-check:checked").length;
    const el = $("ocBatchN");
    if (el) el.textContent = "已选 " + n + " 单";
    const btn = $("ocBatchPay");
    if (btn) btn.disabled = n === 0;
  }
  function showBatchPanel() {
    const checked = Array.from(document.querySelectorAll(".oc-check:checked"));
    if (!checked.length) return;
    const orders = loadOrders();
    $("ocBatchRows").innerHTML = checked.map((cb) => {
      const o = orders[+cb.dataset.idx];
      return `
        <div class="brow" data-idx="${cb.dataset.idx}">
          <span class="bname">${o.name} ${o.code} · ${o.side === "buy" ? "买入" : "卖出"}</span>
          <label>数量<input type="number" class="bqty" value="${o.qty}" step="1" min="1"></label>
          <label>成交价<input type="number" class="bprice" value="${o.price}" step="0.01" min="0.01"></label>
        </div>`;
    }).join("");
    $("ocBatchPanel").style.display = "block";
  }
  function bindBatchEvents(d) {
    const batch = $("ordBatch");
    const pendings = document.querySelectorAll(".order-card.st-pending");
    if (batch) batch.style.display = pendings.length ? "flex" : "none";
    document.querySelectorAll(".oc-check").forEach((cb) => {
      cb.addEventListener("change", updateBatchUI);
    });
    const checkAll = $("ocCheckAll");
    if (checkAll) {
      checkAll.addEventListener("change", () => {
        document.querySelectorAll(".oc-check").forEach((cb) => { cb.checked = checkAll.checked; });
        updateBatchUI();
      });
    }
    const payBtn = $("ocBatchPay");
    if (payBtn) payBtn.addEventListener("click", showBatchPanel);
    const cancel = $("ocBatchCancel");
    if (cancel) cancel.addEventListener("click", () => { $("ocBatchPanel").style.display = "none"; });
    const ok = $("ocBatchOK");
    if (ok) ok.addEventListener("click", () => {
      const items = [];
      document.querySelectorAll("#ocBatchRows .brow").forEach((r) => {
        const price = parseFloat(r.querySelector(".bprice").value);
        const qty = parseInt(r.querySelector(".bqty").value, 10);
        if (price > 0 && qty > 0) items.push({ idx: +r.dataset.idx, price, qty });
      });
      if (!items.length) { alert("请填写正确的成交价与数量"); return; }
      confirmBatch(d, items);
    });
  }

  function bindOrderEvents(d) {
    document.querySelectorAll("#tradingBox .order-card").forEach((card) => {
      const idx = +card.dataset.idx;
      const pay = card.querySelector(".ord-pay");
      const skip = card.querySelector(".ord-skip");
      const confirmBox = card.querySelector(".ord-confirm");
      if (pay && confirmBox) {
        pay.addEventListener("click", () => { confirmBox.style.display = "block"; });
      }
      if (confirmBox) {
        confirmBox.querySelector(".oc-cancel")?.addEventListener("click", () => { confirmBox.style.display = "none"; });
        confirmBox.querySelector(".oc-ok")?.addEventListener("click", () => {
          const price = parseFloat(card.querySelector(".oc-price").value);
          const qty = parseInt(card.querySelector(".oc-qty").value, 10);
          if (!price || !qty || price <= 0 || qty <= 0) { alert("请填写正确的成交价与数量"); return; }
          confirmOrder(d, idx, price, qty);
        });
      }
      if (skip) {
        skip.addEventListener("click", () => {
          const reason = prompt("跳过原因(可选,留空则默认):", "");
          skipOrder(d, idx, reason || "手动决定不执行");
        });
      }
    });
  }

  /* ---------- 数据源 ---------- */
  let REAL = null;
  let MODE = "real";

  function data() {
    if (MODE === "real" && REAL) {
      return {
        pool: REAL.pool,
        weights: REAL.weights.map((w, i) => ({ name: w.name || DIM_NAMES[i], w: w.w })),
        meta: REAL.meta,
        benchmark: REAL.benchmark,
        macro: REAL.macro,
        isReal: true,
      };
    }
    return {
      pool: E.pool.map((p) => ({
        name: p.name, code: p.code, industry: p.industry, brief: p.brief,
        dims: p.dims, inToday: p.inToday, hold: p.hold,
        quote: { price: 100, change_pct: 0, pe_ttm: null, pb: null, market_cap: null },
        tech: {}, finance: {},
        total: p.dims.reduce((a, dv, i) => a + dv * E.weights[i].w, 0) / 100,
        grade: p.grade || "C",
      })),
      weights: E.weights,
      meta: { generated_at: "演示数据", data_mode: "demo" },
      isReal: false,
    };
  }

  function calcTotal(stock, weights) {
    const wSum = weights.reduce((a, b) => a + b.w, 0) || 100;
    const raw = stock.dims.reduce((a, dv, i) => a + dv * weights[i].w, 0) / wSum;
    return Math.round(raw * 10) / 10; // 与后端 round(1位) 保持一致,避免 74.99 vs 75.0 评级差异
  }

  function gradeOf(total) {
    if (total >= 85) return { g: "A", text: "买入" };
    if (total >= 75) return { g: "B", text: "关注" };
    if (total >= 60) return { g: "C", text: "观察" };
    return { g: "D", text: "卖出/规避" };
  }
  const GRADE_CLS = { A: "buy", B: "watch", C: "observe", D: "sell" };
  const GRADE_COLOR = { A: "#e8b84b", B: "#ffb020", C: "#5b8cff", D: "#2fc98c" };

  /* ---------- 研报级子指标解读 ---------- */
  function subIndicators(stock) {
    const q = stock.quote || {};
    const t = stock.tech || {};
    const f = stock.finance || {};
    const pos52 = stock.pos52;
    return {
      val: [
        { label: "PE(TTM)", value: q.pe_ttm != null ? fmt(q.pe_ttm) + "×" : "—" },
        { label: "PB", value: q.pb != null ? fmt(q.pb) + "×" : "—" },
        { label: "52周位置", value: pos52 != null ? fmt(pos52 * 100, 0) + "%" : "—" }
      ],
      pro: [
        { label: "年化ROE", value: f.roe_annual != null ? fmt(f.roe_annual) + "%" : "—" },
        { label: "毛利率", value: f.gross_margin != null ? fmt(f.gross_margin) + "%" : "—" },
        { label: "每股经营现金流", value: f.cfps != null ? fmt(f.cfps) : "—" }
      ],
      gro: [
        { label: "营收同比", value: f.rev_yoy != null ? fmt(f.rev_yoy) + "%" : "—" },
        { label: "净利同比", value: f.profit_yoy != null ? fmt(f.profit_yoy) + "%" : "—" },
        { label: "报告期", value: f.report_name || "—" }
      ],
      tre: [
        { label: "MA20", value: t.ma20 != null ? fmt(t.ma20) : "—" },
        { label: "MA60", value: t.ma60 != null ? fmt(t.ma60) : "—" },
        { label: "RSI14", value: t.rsi14 != null ? fmt(t.rsi14, 1) : "—" },
        { label: "20日动量", value: t.mom20 != null ? fmt(t.mom20) + "%" : "—" }
      ],
      vol: [
        { label: "年化波动率", value: t.vol20 != null ? fmt(t.vol20) + "%" : "—" },
        { label: "60日最大回撤", value: t.max_dd60 != null ? fmt(t.max_dd60) + "%" : "—" }
      ],
      senti: [
        { label: "情绪值", value: stock.sentiment && stock.sentiment.sentiment != null ? (stock.sentiment.sentiment >= 0 ? "+" : "") + fmt(stock.sentiment.sentiment) : "—" },
        { label: "利好新闻", value: stock.sentiment ? stock.sentiment.pos + " 条" : "—" },
        { label: "利空新闻", value: stock.sentiment ? stock.sentiment.neg + " 条" : "—" }
      ]
    };
  }

  function dimScoreDesc(idx, score) {
    if (score >= 80) return "显著高于模型阈值,构成核心亮点";
    if (score >= 60) return "处于合理区间";
    if (score >= 40) return "低于阈值,需要关注";
    return "显著偏弱,构成主要风险";
  }

  /* ---------- 高位警示:52周位置>75% 或 20日涨幅>15% ---------- */
  function highAlert(stock) {
    const pos52 = stock.pos52;
    const mom20 = stock.tech && stock.tech.mom20;
    if (pos52 != null && pos52 > 0.75) return "52周位置 " + fmt(pos52 * 100, 0) + "%";
    if (mom20 != null && mom20 > 15) return "20日涨幅 " + fmt(mom20) + "%";
    return null;
  }

  /* ---------- 推荐理由(基于真实指标) ---------- */
  function buildReason(stock, total, weights) {
    const { g, text } = gradeOf(total);
    const subs = subIndicators(stock);
    const order = stock.dims.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
    const [top1, top2] = order;
    const worst = order[order.length - 1];
    const s1 = subs[DIM_KEY(DIM_NAMES[top1.i])];
    const reasonTop = s1 ? s1.slice(0, 2).map((s) => s.label + " " + s.value).join(" · ") : "";

    const reasons = [];
    reasons.push({
      k: "亮点",
      cls: "plus",
      t: `<b>${DIM_NAMES[top1.i]}</b> ${fmt(stock.dims[top1.i], 1)} 分(${dimScoreDesc(top1.i, stock.dims[top1.i])}) —— ${reasonTop}`
    });
    if (stock.dims[top2.i] >= 70) {
      reasons.push({ k: "亮点", cls: "plus", t: `<b>${DIM_NAMES[top2.i]}</b> ${fmt(stock.dims[top2.i], 1)} 分,${dimScoreDesc(top2.i, stock.dims[top2.i])}` });
    }
    if (worst.v < 70) {
      reasons.push({ k: "风险", cls: "risk", t: `<b>${DIM_NAMES[worst.i]}</b> 仅 ${fmt(stock.dims[worst.i], 1)} 分,${dimScoreDesc(worst.i, stock.dims[worst.i])} —— 需通过仓位控制对冲` });
    }
    reasons.push({
      k: "操作", cls: "act",
      t: `综合 <b>${fmt(total, 1)}</b> 分,评级 <b>${g} · ${text}</b>。${actionText(g, stock, weights)}`
    });
    return reasons;
  }

  function actionText(g, stock, weights) {
    const price = stock.quote && stock.quote.price;
    if (g === "A" || g === "B") {
      if (price && price > 10000 * 0.9) return "一手金额接近或超过实验本金,不满足单笔仓位纪律,暂不执行。";
      return `按纪律单笔 ≤ 总资产 10%(≈¥1,000),建议买入 ${suggestQty(price, weights)} 股(约¥1,000)。请在券商 App 手动执行后到「交易执行台」录入成交。`;
    }
    if (g === "C") return "保持观察,每周复核评分变化,暂不操作。";
    return stock.hold ? "持仓触发卖出纪律:建议在券商 App 卖出并录入成交,移出候选池。" : "建议规避,不纳入买入范围。";
  }

  function suggestQty(price, weights) {
    if (!price || price <= 0) return 0;
    const budget = 1000;
    const lots = Math.max(1, Math.floor(budget / price / 100));
    return lots * 100;
  }

  /* ============================================================
     渲染:宏观速览
     ============================================================ */
  const MACRO_INFO = {
    "纽约原油": "WTI 原油。油价大涨 → 输入型通胀、压制航空/物流/化工下游成本,利好石油开采(若在池中)",
    "布伦特原油": "国际油价基准,全球通胀与地缘风险温度计。美伊等地缘冲突是主要推手",
    "纽约黄金": "避险资产。金价飙升往往对应地缘紧张/美元走弱/避险情绪升温,此时股市整体承压",
    "美元指数": "美元强弱。走强 → 人民币承压、外资流出压力;走弱 → 利好新兴市场与人民币资产",
    "美元人民币": "在岸汇率。贬值利好出口链,但加速贬值引发资本外流担忧",
    "恒生指数": "港股风向标,与 A 股联动;反映外资对中国资产的风险偏好",
  };
  function renderMacro(d) {
    const items = (d.macro || []).filter((m) => m.name && m.value != null);
    const grid = $("macroGrid");
    if (!grid) return;
    if (!items.length) {
      grid.innerHTML = `<div class="empty-box" style="grid-column:1/-1;padding:26px"><p class="ce-sub">暂无宏观数据 —— 运行 python3 update_data.py 后显示</p></div>`;
      return;
    }
    grid.innerHTML = items.map((m) => {
      const isPct = m.key === "HSI" || m.key === "CL" || m.key === "OIL" || m.key === "GC";
      const chg = m.change_pct;
      return `
        <div class="macro-card" title="${MACRO_INFO[m.name] || ""}">
          <div class="m-name">${m.name}</div>
          <div class="m-value">${fmt(m.value, m.key === "USDCNY" ? 4 : 2)}</div>
          <div class="m-chg ${chg == null ? "m-na" : chg < 0 ? "down" : "up"}">
            ${chg == null ? "—" : (chg >= 0 ? "▲ +" : "▼ ") + fmt(chg) + "%"}
          </div>
        </div>`;
    }).join("");
    const note = $("macroNote");
    if (note) {
      note.innerHTML = `提示:宏观数据为实时参考(不参与评分)。把鼠标移到卡片上看它如何影响你的持仓 —— 例如 ${(items.find((m) => m.name === "布伦特原油") || {}).value != null ? `布伦特原油 <b>$${fmt((items.find((m) => m.name === "布伦特原油") || {}).value)}</b>,如果地缘冲突升级推高油价,A 股石化板块或有表现,但整体市场承压。` : ""}最终买卖仍以五维评分 + 你的判断为准。`;
    }
  }

  /* ============================================================
     渲染:模型卡
     ============================================================ */
  function renderModel(d) {
    $("weightModel").innerHTML = d.weights.map((w) => `
      <div class="strip-item" style="border-radius:12px">
        <span class="k">${w.name}</span>
        <span class="v" style="color:var(--gold)">${w.w}%</span>
        <span style="font-size:11px;color:var(--text-faint)">权重</span>
      </div>
    `).join("");
  }

  /* ============================================================
     候选池表格
     ============================================================ */
  function renderPool(d, weights, activeCode) {
    const ranked = d.pool
      .map((s) => ({ s, total: calcTotal(s, weights) }))
      .sort((a, b) => b.total - a.total);
    const inToday = ranked.slice(0, 5);

    $("poolBody").innerHTML = ranked.map((r, idx) => {
      const { g } = gradeOf(r.total);
      const isToday = inToday.includes(r);
      const price = r.s.quote && r.s.quote.price;
      const chg = r.s.quote && r.s.quote.change_pct;
      const isActive = activeCode && r.s.code === activeCode;
      const hi = highAlert(r.s);
      return `<tr data-code="${r.s.code}" class="${isActive ? "active" : ""}">
        <td class="row-no">${idx + 1}</td>
        <td>
          <span class="stock"><span class="sname">${r.s.name}</span><span class="scode">${r.s.code}</span></span>
          ${hi ? `<span class="tag alert">高位</span>` : ""}
          ${r.s.hold ? `<span class="tag hold">持仓</span>` : ""}
        </td>
        <td style="font-size:12.5px;color:var(--text-dim)">${r.s.industry}</td>
        <td class="mono" style="font-size:13px">${price ? "¥" + fmt(price) : "—"}</td>
        <td class="mono" style="font-size:12.5px;color:${chg < 0 ? "var(--down)" : "var(--up)"}">${chg != null ? (chg >= 0 ? "+" : "") + fmt(chg) + "%" : "—"}</td>
        <td>
          <span class="senti-badge ${(r.s.sentiment && r.s.sentiment.tag) || ""}">${(r.s.sentiment && r.s.sentiment.tag) || "—"}</span>
        </td>
        <td class="score-num" style="${idx === 0 ? "color:var(--gold)" : ""}">${fmt(r.total, 1)}</td>
        <td><span class="grade ${GRADE_CLS[g]}">${g}</span></td>
        <td>${isToday ? `<span class="tag pool">√ 入池</span>` : `<span style="color:var(--text-faint);font-size:12px">未入池</span>`}</td>
      </tr>`;
    }).join("");

    document.querySelectorAll("#poolBody tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        const code = tr.dataset.code;
        renderPool(d, weights, code);
        const stock = d.pool.find((s) => s.code === code);
        renderDetail(stock, weights);
      });
    });
  }

  /* ============================================================
     详情卡(研报级)
     ============================================================ */
  function renderDetail(stock, weights) {
    if (!stock) return;
    const total = calcTotal(stock, weights);
    const { g, text } = gradeOf(total);
    const reasons = buildReason(stock, total, weights);
    const subs = subIndicators(stock);
    const price = stock.quote && stock.quote.price;

    $("detailCard").innerHTML = `
      <div class="detail-head">
        <h3>${stock.name}</h3>
        <span class="dcode">${stock.code}</span>
        <span class="dind">${stock.industry}</span>
        ${highAlert(stock) ? `<span class="tag alert" title="${highAlert(stock)}">高位警示</span>` : ""}
        ${stock.hold ? `<span class="tag hold">持仓中</span>` : ""}
      </div>
      <p class="detail-brief">${stock.brief}</p>
      <div class="detail-score-row">
        <span class="big" style="color:${GRADE_COLOR[g]}">${fmt(total, 1)}</span>
        <span class="grade ${GRADE_CLS[g]}" style="font-size:14px;padding:5px 14px">${g} · ${text}</span>
        <span class="mono" style="font-size:13px;color:var(--text-dim)">现价 ¥${price ? fmt(price) : "—"}${stock.quote && stock.quote.change_pct != null ? ` (${stock.quote.change_pct >= 0 ? "+" : ""}${fmt(stock.quote.change_pct)}%)` : ""}</span>
        ${highAlert(stock) ? `<span class="mono" style="font-size:12px;color:var(--up)">${highAlert(stock)} — 注意追高风险</span>` : ""}
      </div>

      <div class="dim-breakdown">
        ${DIM_NAMES.map((dn, i) => {
          const v = stock.dims[i];
          const color = v >= 80 ? "#e8b84b" : v >= 60 ? "#5b8cff" : "#ff5257";
          const subsItems = subs[DIM_KEY(DIM_NAMES[i])];
          return `
            <div class="dim-line">
              <span class="dname">${dn} ${weights[i] ? weights[i].w : 20}%</span>
              <span class="dbar"><span class="dfill" style="width:${v}%;background:${color}"></span></span>
              <span class="dval" style="color:${color}">${v}</span>
              <span class="ddesc">${subsItems ? subsItems.map((s) => `<span class="sub">${s.label} <b>${s.value}</b></span>`).join("") : ""}</span>
            </div>`;
        }).join("")}
      </div>

      <div class="reason-box">
        ${reasons.map((r) => `
          <div class="reason-item">
            <span class="rk ${r.cls}">${r.k}</span>
            <span class="rt">${r.t}</span>
          </div>`).join("")}
      </div>

      ${renderNewsBox(stock)}
      ${renderResearchBox(stock)}`;
  }

  /* ---------- 研报评级(不参与评分,仅供参考) ---------- */
  const RATING_CLS = {
    "买入": "r-up", "强烈推荐": "r-up", "推荐": "r-up",
    "增持": "r-warm", "优于大市": "r-warm", "跑赢行业": "r-warm",
    "中性": "r-mid", "持有": "r-mid", "同步大市": "r-mid",
  };
  function renderResearchBox(stock) {
    const rs = (stock.research || []).slice(0, 5);
    if (!rs.length) return "";
    const clean = (r) => (r || "").split("(")[0].split("（")[0].trim();
    return `
      <div class="news-box">
        <div class="nb-head">
          <span class="nb-title-main">研报评级</span>
          <span class="nb-note">近 180 天券商研报 · 仅供参考,不参与评分</span>
        </div>
        <ul class="nb-list">
          ${rs.map((r) => {
            const rc = clean(r.rating);
            return `<li>
              <span class="nb-date">${(r.date || "").slice(5)}</span>
              <span class="r-badge ${RATING_CLS[rc] || "r-mid"}">${r.rating || "—"}</span>
              <span class="nb-title" title="${r.title}">${r.org ? "[" + r.org + "] " : ""}${r.title}</span>
              ${r.target ? `<span class="nb-src">目标价 ${fmt(r.target)}</span>` : ""}
            </li>`;
          }).join("")}
        </ul>
      </div>`;
  }
  function renderNewsBox(stock) {
    const news = (stock.news || []).slice(0, 5);
    const anns = (stock.announcements || []).slice(0, 3);
    const s = stock.sentiment || {};
    const sTag = s.tag || "中性";
    const sBadge = `<span class="senti-badge ${sTag}">情绪 ${sTag}${s.sentiment != null ? " " + (s.sentiment >= 0 ? "+" : "") + s.sentiment : ""}</span>`;
    if (!news.length && !anns.length) return "";
    return `
      <div class="news-box">
        <div class="nb-head">
          <span class="nb-title-main">新闻速览</span>
          <span class="nb-note">最近资讯 · 已计入「新闻情绪」维度</span>
          ${sBadge}
        </div>
        ${news.length ? `<ul class="nb-list">
          ${news.map((n) => `
            <li>
              <span class="nb-date">${(n.date || "").slice(5)}</span>
              <a class="nb-title" href="${n.url || "#"}" target="_blank" rel="noopener">${n.title}</a>
              <span class="nb-src">${n.media}</span>
            </li>`).join("")}
        </ul>` : ""}
        ${anns.length ? `<div class="nb-ann">
          <span class="nb-ann-label">公告</span>
          ${anns.map((a) => `<span class="nb-ann-item"><b>${(a.date || "").slice(5)}</b> ${a.type ? "[" + a.type + "] " : ""}${a.title}</span>`).join("")}
        </div>` : ""}
      </div>`;
  }

  /* ============================================================
     持仓信号
     ============================================================ */
  function renderAlerts(d, weights) {
    const held = d.pool.filter((s) => s.hold);
    $("alertStrip").innerHTML = held.map((s) => {
      const total = calcTotal(s, weights);
      const { g, text } = gradeOf(total);
      const isSell = g === "D";
      const sTag = (s.sentiment && s.sentiment.tag) || "";
      const sentiRisk = sTag === "利空";
      return `
        <div class="alert-item ${isSell || sentiRisk ? "sell" : "warn"}">
          <span class="a-ico">${isSell || sentiRisk ? "!" : "·"}</span>
          <span style="flex:1"><b>${s.name}(${s.code})</b> 当前综合 ${fmt(total, 1)} 分 · 评级 ${g} · ${text}
            ${sentiRisk ? `<span class="senti-badge 利空">新闻情绪利空 — 注意风险</span>` : ""}
            ${isSell ? " —— 触发卖出纪律" : ""}</span>
          <span class="tag ${isSell || sentiRisk ? "alert" : "hold"}">${isSell || sentiRisk ? "风险信号" : "继续持有"}</span>
        </div>`;
    }).join("");
  }

  /* ============================================================
     权重调节器
     ============================================================ */
  function renderWeightEditor(d) {
    const editor = $("weightEditor");
    let current = d.weights.map((w) => w.w);

    function build() {
      editor.innerHTML = `
        <div class="section-head" style="margin-bottom:18px">
          <div>
            <h2 style="font-size:20px">五维权重</h2>
            <p class="section-sub">默认:估值 25 · 盈利 25 · 成长 20 · 趋势 15 · 波动 15</p>
          </div>
          <button class="we-reset" id="weReset">恢复默认</button>
        </div>
        ${d.weights.map((w, i) => `
          <div class="we-row">
            <div class="we-head">
              <span><b>${w.name}</b></span>
              <span class="wv" data-wv="${i}">${current[i]}%</span>
            </div>
            <input type="range" min="0" max="50" step="5" value="${current[i]}" data-wi="${i}">
          </div>
        `).join("")}
        <p class="we-total">权重合计 <b id="weTotal">${current.reduce((a, b) => a + b, 0)}%</b> · 排名实时重算</p>`;

      const wlist = d.weights.map((w, i) => ({ name: w.name, w: current[i] }));
      editor.querySelectorAll("input[type=range]").forEach((inp) => {
        inp.addEventListener("input", () => {
          const i = +inp.dataset.wi;
          current[i] = +inp.value;
          editor.querySelector(`[data-wv="${i}"]`).textContent = current[i] + "%";
          $("weTotal").textContent = current.reduce((a, b) => a + b, 0) + "%";
          const w2 = d.weights.map((w, j) => ({ name: w.name, w: current[j] }));
          const ranked = d.pool.map((s) => ({ s, total: calcTotal(s, w2) })).sort((a, b) => b.total - a.total);
          renderPool(d, w2, ranked[0].s.code);
          renderDetail(ranked[0].s, w2);
          renderAlerts(d, w2);
        });
      });
      editor.querySelector("#weReset").addEventListener("click", () => {
        renderWeightEditor(d);
        const dw = d.weights;
        renderPool(d, dw, d.pool[0].code);
        renderDetail(d.pool[0], dw);
        renderAlerts(d, dw);
      });
    }
    build();
  }

  /* ============================================================
     交易执行台
     ============================================================ */
  function loadTrades() {
    try { return JSON.parse(localStorage.getItem(LS_TRADES)) || []; }
    catch (e) { return []; }
  }
  function saveTrades(list) { localStorage.setItem(LS_TRADES, JSON.stringify(list)); }

  function computeHoldings(trades, d) {
    const pos = {}; // code -> {qty, cost}
    const realized = { cash: 10000 };
    trades.forEach((t) => {
      if (t.side === "buy") {
        pos[t.code] = pos[t.code] || { qty: 0, cost: 0 };
        pos[t.code].qty += t.qty;
        pos[t.code].cost += t.qty * t.price;
      } else {
        if (pos[t.code]) {
          const avg = pos[t.code].cost / pos[t.code].qty;
          const pnl = (t.price - avg) * t.qty;
          realized.cash += t.qty * t.price;
          realized[t.code] = (realized[t.code] || 0) + pnl;
          pos[t.code].qty -= t.qty;
          pos[t.code].cost -= avg * t.qty;
          if (pos[t.code].qty <= 0) delete pos[t.code];
        }
      }
    });
    // 市值
    let mv = 0;
    const rows = [];
    Object.keys(pos).forEach((code) => {
      if (pos[code].qty <= 0) return;
      const stock = d.pool.find((s) => s.code === code);
      const price = stock && stock.quote ? stock.quote.price : pos[code].cost / pos[code].qty;
      const avg = pos[code].cost / pos[code].qty;
      const val = price * pos[code].qty;
      mv += val;
      rows.push({ code, name: stock ? stock.name : code, qty: pos[code].qty, avg, price, val, pnl: (price - avg) * pos[code].qty });
    });
    const cash = realized.cash - (10000 - (realized.cash - 10000 + 0)); // 已用现金还原
    // 简化:初始现金10000,买入扣现金,卖出加现金
    let cash2 = 10000;
    trades.forEach((t) => { cash2 += t.side === "buy" ? -t.qty * t.price : t.qty * t.price; });
    return { positions: rows, cash: cash2, total: cash2 + mv };
  }

  function renderTrading(d) {
    const box = $("tradingBox");
    if (!box) return;
    const trades = loadTrades();
    const h = computeHoldings(trades, d);
    const d2 = d;

    // 今日订单:按当前权重排序 pool,系统自动生成订单
    const weights = d.weights;
    const ranked = d.pool.map((s) => ({ s, total: calcTotal(s, weights) })).sort((a, b) => b.total - a.total);
    const orders = ensureOrders(d, trades, ranked);

    box.innerHTML = `
      <div class="trading-grid">
        <div class="card">
          <div class="ord-head">
            <h3>今日订单</h3>
            <span class="ord-sub">系统按信号自动生成 · 在券商 App 成交后点「支付成功」自动记账</span>
            <span class="ord-stat">${orders.filter((o) => o.status === "done").length}/${orders.length} 已成交</span>
          </div>
          <div class="ord-batch" id="ordBatch" style="display:none">
            <label class="ord-check"><input type="checkbox" id="ocCheckAll"> 全选待确认</label>
            <button class="ord-pay" id="ocBatchPay" type="button" disabled>批量支付成功</button>
            <span class="ord-batch-n" id="ocBatchN">已选 0 单</span>
          </div>
          <div class="ord-confirm" id="ocBatchPanel" style="display:none;margin-bottom:12px">
            <p class="ord-confirm-tip">以下订单已在券商 App 全部成交?填写实际成交信息,一键记账:</p>
            <div id="ocBatchRows"></div>
            <div class="ord-confirm-grid" style="margin-top:12px">
              <button class="dm-export" id="ocBatchOK" type="button">确认全部记录成交</button>
              <button class="we-reset" id="ocBatchCancel" type="button">取消</button>
            </div>
          </div>
          <div class="sig-list">
            ${orders.length
              ? orders.map((o, i) => renderOrderCard(o, i)).join("")
              : `<div class="empty-box" style="padding:20px"><p class="ce-sub">今日暂无订单 —— 收盘后运行 python3 update_data.py 生成信号。</p></div>`}
          </div>
        </div>

        <div class="card">
          <h3>持仓总览 <span class="tag hold" style="float:right">按最新真实价</span></h3>
          ${h.positions.length
            ? `<table class="trades-table" style="min-width:0">
                <thead><tr><th>标的</th><th>数量</th><th>成本</th><th>现价</th><th>市值</th><th>盈亏</th></tr></thead>
                <tbody>
                  ${h.positions.map((p) => `
                    <tr>
                      <td><b>${p.name}</b></td><td class="mono">${p.qty}</td>
                      <td class="mono">${fmt(p.avg)}</td><td class="mono">${fmt(p.price)}</td>
                      <td class="mono">¥${fmt(p.val, 0)}</td>
                      <td class="mono ${p.pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${p.pnl >= 0 ? "+" : ""}¥${fmt(p.pnl)}</td>
                    </tr>`).join("")}
                </tbody>
              </table>
              <p style="margin-top:10px;font-size:13.5px">现金 <b class="mono">¥${fmt(h.cash, 0)}</b> + 持仓 <b class="mono">¥${fmt(h.total - h.cash, 0)}</b> = 总资产 <b class="mono" style="color:var(--gold)">¥${fmt(h.total, 0)}</b>(本金 ¥10,000)</p>`
            : `<div class="empty-box" style="padding:24px"><p class="ce-sub">尚无持仓 —— 执行今日信号后,在此录入成交。</p></div>`}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <details>
          <summary class="manual-summary">手动录入其他成交(兜底:池外标的 / 额外买卖)</summary>
          <form id="tradeForm" class="trade-form">
            <select id="tfCode" required>
              <option value="">选择标的…</option>
              ${d.pool.map((s) => `<option value="${s.code}">${s.name} ${s.code}</option>`).join("")}
            </select>
            <select id="tfSide" required>
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
            <input id="tfQty" type="number" min="1" step="1" placeholder="数量(股)" required>
            <input id="tfPrice" type="number" min="0.01" step="0.01" placeholder="实际成交价" required>
            <input id="tfTime" type="datetime-local" value="${new Date().toISOString().slice(0, 16)}">
            <button type="submit" class="dm-export" style="margin-top:0">录入成交(时间戳固定)</button>
          </form>
        </details>
        <div class="trade-actions" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="we-reset" id="tfExport" type="button">导出成交记录 JSON(trades_record.json)</button>
          <button class="we-reset" id="tfSnapshot" type="button">生成今日净值快照</button>
          <button class="we-reset" id="tfClear" type="button" style="color:var(--down)">清空本机记录</button>
          <button class="we-reset" id="tfResetOrders" type="button">重新生成今日订单</button>
        </div>
        <p style="margin-top:10px;font-size:12.5px;color:var(--text-faint)">
          将导出的 JSON 放回项目目录后,运行 <code>python3 update_data.py</code> 会把成交并入净值快照,
          主站收益曲线即按真实持仓绘制。建议把 JSON 放入 git 仓库,保证「事后不可修改」。
        </p>
      </div>

      <div class="card" style="margin-top:16px">
        <h3>成交记录(<span id="tfCount">${trades.length}</span> 笔)</h3>
        ${trades.length
          ? `<table class="trades-table" style="min-width:0">
              <thead><tr><th>时间戳</th><th>方向</th><th>标的</th><th>数量</th><th>成交价</th><th>金额</th></tr></thead>
              <tbody>
                ${trades.slice().reverse().map((t) => `
                  <tr>
                    <td class="mono" style="font-size:12px">${t.ts}</td>
                    <td class="${t.side === "buy" ? "dir-buy" : "dir-sell"}">${t.side === "buy" ? "买入" : "卖出"}</td>
                    <td><b>${t.name}</b> ${t.code}</td>
                    <td class="mono">${t.qty}</td>
                    <td class="mono">${fmt(t.price)}</td>
                    <td class="mono">¥${fmt(t.qty * t.price, 0)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>`
          : `<p class="ce-sub">暂无成交记录。</p>`}
      </div>`;

    // 表单提交
    $("tradeForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const code = $("tfCode").value;
      const side = $("tfSide").value;
      const qty = +$("tfQty").value;
      const price = +$("tfPrice").value;
      const stock = d2.pool.find((s) => s.code === code);
      if (!stock || !qty || !price) return;
      const list = loadTrades();
      list.push({
        ts: new Date().toISOString().slice(0, 19),
        side, code, name: stock.name, qty, price,
      });
      saveTrades(list);
      renderTrading(d2); // 刷新
    });
    $("tfExport").addEventListener("click", () => {
      download("trades_record.json", JSON.stringify(loadTrades(), null, 2));
    });
    $("tfSnapshot").addEventListener("click", () => {
      const h2 = computeHoldings(loadTrades(), d2);
      const snap = {
        date: new Date().toISOString().slice(0, 10),
        total: Math.round(h2.total * 100) / 100,
        cash: Math.round(h2.cash * 100) / 100,
        totalReturn: Math.round((h2.total / 10000 - 1) * 10000) / 100,
        positions: h2.positions.map((p) => ({ code: p.code, name: p.name, qty: p.qty, price: p.price })),
        generated_at: new Date().toISOString(),
      };
      download("portfolio_history.json", JSON.stringify({ series: [snap] }, null, 2));
      alert("已生成净值快照文件。把它放回项目目录,或直接运行 python3 update_data.py —— 脚本会自动读取成交记录并生成主站可用的净值曲线。");
    });
    $("tfClear").addEventListener("click", () => {
      if (confirm("确定清空本机成交记录?导出文件不受影响。")) {
        localStorage.removeItem(LS_TRADES);
        renderTrading(d2);
      }
    });
    $("tfResetOrders").addEventListener("click", () => {
      if (confirm("确定清空今日订单并重新生成?(已成交/已跳过的记录会保留在成交记录中)")) {
        const today = new Date().toISOString().slice(0, 10);
        saveOrders(loadOrders().filter((o) => o.date !== today));
        renderTrading(d2);
      }
    });
    bindOrderEvents(d2);
    bindBatchEvents(d2);
  }

  function download(name, content) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ============================================================
     数据管理面板(数据源状态)
     ============================================================ */
  function renderDataStatus(d) {
    const el = $("dataStatus");
    if (!el) return;
    if (d.isReal) {
      el.innerHTML = `
        <p style="font-size:13px;color:var(--text-dim);margin-bottom:6px">
          当前: <b style="color:var(--down)">真实数据模式</b> · 数据源 东方财富公开接口 · 更新于
          <code>${(d.meta.generated_at || "").slice(0, 16)}</code>
        </p>
        <p style="font-size:13px;color:var(--text-dim);line-height:1.7">
          每天收盘后运行 <code>python3 update_data.py</code> 更新行情与评分;执行交易后录入「交易执行台」并导出 JSON,
          脚本会自动并入净值快照。可配 cron/launchd 定时任务实现全自动。
        </p>`;
    } else {
      el.innerHTML = `<p style="font-size:13px;color:var(--gold)">当前为演示数据。运行 <code>python3 update_data.py</code> 生成 real_data.json 后自动切换为真实数据。</p>`;
    }
  }

  /* ============================================================
     导出数据
     ============================================================ */
  function exportJSON(d) {
    download("experiment-data.json", JSON.stringify({ ...E, real: REAL }, null, 2));
  }

  /* ============================================================
     移动端菜单
     ============================================================ */
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
     启动
     ============================================================ */
  async function boot() {
    // 真实数据通过 script 标签加载(JSONP,file:// 下可用);见 recommend.html 中 real_data.js
    REAL = window.REAL_DATA || null;

    const d = data();
    const weights = d.weights;
    renderMacro(d);
    renderModel(d);
    renderPool(d, weights, d.pool[0] ? d.pool[0].code : null);
    renderDetail(d.pool[0], weights);
    renderAlerts(d, weights);
    renderWeightEditor(d);
    renderTrading(d);
    renderDataStatus(d);

    const exp = $("exportBtn");
    if (exp) exp.addEventListener("click", () => exportJSON(d));
    initMobileMenu();
  }
  boot();
})();
