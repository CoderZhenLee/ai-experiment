/* ============================================================
   指数 / ETF 专区 — 渲染逻辑
   数据源: real_data.json 的 etf 字段(update_data.py 生成)
   ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 2) => {
    if (n == null || isNaN(n)) return "—";
    return n.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  function chgBadge(pct) {
    if (pct == null || isNaN(pct)) return `<span class="ec-chg flat">—</span>`;
    if (pct > 0) return `<span class="ec-chg up">▲ +${fmt(pct)}%</span>`;
    if (pct < 0) return `<span class="ec-chg down">▼ ${fmt(pct)}%</span>`;
    return `<span class="ec-chg flat">0.00%</span>`;
  }

  function renderCard(it, isIndex) {
    const pct = it.change_pct;
    // 涨红跌绿(中国惯例)
    const priceCls = pct > 0 ? "up" : pct < 0 ? "down" : "";
    return `
      <div class="etf-card">
        <div class="ec-head">
          <span class="ec-name">${it.name}</span>
          <span class="ec-code">${isIndex ? it.code : it.code + " · ETF"}</span>
        </div>
        <div class="ec-brief">${it.brief || ""}</div>
        <div class="ec-row">
          <span class="ec-price ${priceCls}">${fmt(it.price, isIndex ? 2 : 3)}</span>
          ${chgBadge(pct)}
        </div>
        <div class="ec-meta">
          ${it.pe_ttm != null ? `<span>市盈率 ${fmt(it.pe_ttm)}×</span>` : `<span>市盈率 —</span>`}
          <span>数据: 实时</span>
        </div>
      </div>`;
  }

  function render() {
    const REAL = window.REAL_DATA || null;
    const badge = $("dataBadge");
    const indices = $("indicesGrid");
    const industry = $("industryGrid");
    if (!indices || !industry) return;

    if (!REAL || !REAL.etf) {
      indices.innerHTML = `<div class="empty-box" style="grid-column:1/-1;padding:26px"><p class="ce-sub">暂无数据 —— 运行 python3 update_data.py 后显示</p></div>`;
      industry.innerHTML = "";
      if (badge) badge.textContent = "暂无数据";
      return;
    }

    const etf = REAL.etf;
    if (badge) badge.textContent = "REAL · " + (REAL.meta.generated_at || "").slice(0, 16);

    const idxList = etf.indices || [];
    const indList = etf.industry || [];
    indices.innerHTML = idxList.length
      ? idxList.map((it) => renderCard(it, true)).join("")
      : `<div class="empty-box" style="grid-column:1/-1;padding:26px"><p class="ce-sub">暂无宽基指数数据</p></div>`;
    industry.innerHTML = indList.length
      ? indList.map((it) => renderCard(it, false)).join("")
      : `<div class="empty-box" style="grid-column:1/-1;padding:26px"><p class="ce-sub">暂无行业ETF数据</p></div>`;

    if (etf.errors && etf.errors.length) {
      console.warn("ETF 抓取失败项:", etf.errors);
    }
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

  render();
  initMobileMenu();
})();
