/* ============================================================
   ¥10000 投资实验 — 演示数据(第 37 天快照)
   所有展示数字由本数据 + app.js 计算得出,保持自洽:
   当前资产 10,683 = 本金 10,000 + 已实现 287.70 + 浮盈 395.30
   胜率 7/12 = 58.3% · 交易 17 笔(12 平仓 + 5 持仓)
   ============================================================ */

const EXPERIMENT = {
  // 基础信息
  name: "¥10000 投资实验",
  capital: 10000,
  currentDay: 37,
  totalDays: 180,
  startDate: new Date(2026, 5, 30), // DAY 01 = 2026-06-30,DAY 37 = 2026-08-05

  // 基准
  benchHS300: 3.21,   // 沪深300 同期 +3.21%
  benchSP500: 2.80,   // 标普500 同期 +2.80%

  // AI 推荐 vs 实际执行
  aiVsActual: {
    ai: 9.42,         // 完全执行 AI 推荐的组合收益
    actual: 6.83,     // 实际执行收益(与实验一致)
    hs300: 3.21,
    sp500: 2.80
  },

  // 评分权重
  weights: [
    { name: "估值",      w: 25 },
    { name: "盈利能力",  w: 25 },
    { name: "成长性",    w: 20 },
    { name: "趋势",      w: 15 },
    { name: "波动风险",  w: 15 }
  ],

  // 今日策略评分(候选池综合分前 5 名,维度分 0-100,综合分 = 加权和,渲染时计算)
  scores: [
    { name: "贵州茅台", code: "600519", dims: [88, 94, 86, 90, 72], grade: "A", action: "买入" },
    { name: "宁德时代", code: "300750", dims: [72, 88, 92, 85, 68], grade: "B", action: "买入" },
    { name: "美的集团", code: "000333", dims: [70, 86, 78, 72, 80], grade: "B", action: "关注" },
    { name: "比亚迪",   code: "002594", dims: [68, 82, 90, 80, 64], grade: "B", action: "关注" },
    { name: "招商银行", code: "600036", dims: [84, 78, 62, 70, 85], grade: "B", action: "关注" }
  ],

  // 完整候选池(后台展示;按综合分排名,前 5 名进入今日观察池)
  // brief = 一句话基本面,用于推荐理由;hold = 当前是否持仓
  pool: [
    { name: "贵州茅台", code: "600519", industry: "白酒", dims: [88, 94, 86, 90, 72], brief: "超高端白酒龙头,品牌稀缺性强,盈利能力与现金流常年顶级", inToday: true },
    { name: "宁德时代", code: "300750", industry: "动力电池", dims: [72, 88, 92, 85, 68], brief: "全球动力电池龙头,储能业务构成第二增长曲线", inToday: true, hold: true },
    { name: "美的集团", code: "000333", industry: "家电", dims: [70, 86, 78, 72, 80], brief: "白电龙头,机器人与工业自动化双轮驱动", inToday: true, hold: true },
    { name: "比亚迪",   code: "002594", industry: "新能源车", dims: [68, 82, 90, 80, 64], brief: "新能源汽车垂直一体化,出口与高端化高增长", inToday: true, hold: true },
    { name: "招商银行", code: "600036", industry: "银行", dims: [84, 78, 62, 70, 85], brief: "零售银行龙头,财富管理与中间业务优势突出", inToday: true, hold: true },
    { name: "中芯国际", code: "688981", industry: "半导体", dims: [62, 76, 88, 78, 60], brief: "大陆晶圆代工龙头,国产替代主线,资本开支高峰期", hold: true },
    { name: "万华化学", code: "600309", industry: "化工", dims: [74, 84, 70, 62, 66], brief: "MDI 全球龙头,新材料板块打开成长空间" },
    { name: "恒瑞医药", code: "600276", industry: "医药", dims: [66, 80, 74, 58, 64], brief: "创新药龙头,研发管线进入收获期" },
    { name: "中国平安", code: "601318", industry: "保险", dims: [80, 62, 58, 60, 75], brief: "综合金融集团,医疗养老生态布局" },
    { name: "隆基绿能", code: "601012", industry: "光伏", dims: [42, 38, 30, 45, 82], brief: "光伏组件龙头,行业产能过剩盈利承压" }
  ],

  // 今日操作(DAY 37,时间戳固定)
  ops: [
    { time: "09:31:08", side: "buy",  name: "招商银行", code: "600036", qty: 20, price: 36.80, amount: 736.00, note: "评分 B(76.2),今日观察池第 5 名,符合规则,机械执行" },
    { time: "10:05:41", side: "sell", name: "美的集团", code: "000333", qty: 10, price: 72.40, amount: 724.00, note: "达到止盈纪律线,落袋为安" },
    { time: "14:22:10", side: "skip", name: "贵州茅台", code: "600519", qty: 0,  price: 1450.00, amount: 0, note: "策略第一名(A 87.0),未执行 —— 单股市值超单笔仓位上限" }
  ],

  // 每日日志(近 5 天)
  logs: [
    {
      day: 33, value: 10452.4, dayReturn: +0.21,
      actions: [{ type: "sell", text: "卖出 隆基绿能 60股 @15.70(+¥42.0)" }],
      topPick: "贵州茅台 A 87.0", executed: true,
      summary: "落袋隆基绿能,机械执行卖出纪律,不贪最后一段。"
    },
    {
      day: 34, value: 10401.2, dayReturn: -0.49,
      actions: [{ type: "hold", text: "无操作" }],
      topPick: "贵州茅台 A 86.4", executed: false,
      summary: "策略第一名依然是茅台,但仓位已接近上限,忍住不追。"
    },
    {
      day: 35, value: 10331.0, dayReturn: -0.67,
      actions: [{ type: "hold", text: "无操作" }],
      topPick: "美的集团 B 77.9", executed: false,
      summary: "连续 7 个交易日 4 亏,我开始怀疑这套策略……但规则就是规则,不盘中拍脑袋。"
    },
    {
      day: 36, value: 10601.2, dayReturn: +2.61,
      actions: [{ type: "hold", text: "无操作(持仓浮盈扩大)" }],
      topPick: "贵州茅台 A 88.2", executed: false,
      summary: "宁德、中芯大涨,净值单日 +2.61%,回撤基本收复。"
    },
    {
      day: 37, value: 10683.0, dayReturn: +0.81,
      actions: [
        { type: "buy",  text: "买入 招商银行 20股 @36.80(¥736)" },
        { type: "sell", text: "卖出 美的集团 10股 @72.40(¥724)" }
      ],
      topPick: "贵州茅台 A 87.0", executed: false,
      summary: "第 37 天,累计 +6.83%。今天策略第一名是茅台,但因单笔仓位上限未执行,继续记录。"
    }
  ],

  // 历史交易(12 平仓 + 5 持仓;pnl 由价格差计算,渲染时求和)
  // 字段: buyDay, sellDay(可空), name, code, qty, buyPrice, sellPrice(可空), currentPrice(持仓用)
  trades: [
    { buyDay:  4, sellDay:  6, name: "中芯国际", code: "688981", qty: 10, buyPrice: 86.00, sellPrice: 93.20 },
    { buyDay:  5, sellDay: 10, name: "中国平安", code: "601318", qty: 16, buyPrice: 51.80, sellPrice: 49.90 },
    { buyDay:  8, sellDay: 13, name: "招商银行", code: "600036", qty: 19, buyPrice: 35.90, sellPrice: 35.20 },
    { buyDay:  9, sellDay: 14, name: "招商银行", code: "600036", qty: 20, buyPrice: 35.50, sellPrice: 38.40 },
    { buyDay: 11, currentPrice: 268.10, name: "宁德时代", code: "300750", qty: 3, buyPrice: 248.00 },
    { buyDay: 12, sellDay: 19, name: "中国平安", code: "601318", qty: 40, buyPrice: 50.00, sellPrice: 51.20 },
    { buyDay: 15, sellDay: 21, name: "隆基绿能", code: "601012", qty: 54, buyPrice: 15.60, sellPrice: 15.10 },
    { buyDay: 17, sellDay: 22, name: "美的集团", code: "000333", qty: 13, buyPrice: 68.00, sellPrice: 72.00 },
    { buyDay: 18, sellDay: 24, name: "美的集团", code: "000333", qty: 12, buyPrice: 70.10, sellPrice: 69.30 },
    { buyDay: 20, sellDay: 26, name: "中芯国际", code: "688981", qty: 10, buyPrice: 90.00, sellPrice: 95.00 },
    { buyDay: 20, currentPrice: 92.60, name: "中芯国际", code: "688981", qty: 20, buyPrice: 88.00 },
    { buyDay: 23, sellDay: 27, name: "比亚迪",   code: "002594", qty: 2, buyPrice: 305.00, sellPrice: 295.00 },
    { buyDay: 25, sellDay: 30, name: "比亚迪",   code: "002594", qty: 3, buyPrice: 300.00, sellPrice: 322.00 },
    { buyDay: 25, currentPrice: 332.00, name: "比亚迪", code: "002594", qty: 3, buyPrice: 305.00 },
    { buyDay: 28, sellDay: 33, name: "隆基绿能", code: "601012", qty: 60, buyPrice: 15.00, sellPrice: 15.70 },
    { buyDay: 30, currentPrice: 36.88, name: "招商银行", code: "600036", qty: 50, buyPrice: 35.20 },
    { buyDay: 33, currentPrice: 72.40, name: "美的集团", code: "000333", qty: 20, buyPrice: 68.50 }
  ]
};
