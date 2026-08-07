/* ============================================================
   每日测验引擎(复习用)
   自动出题: 选义题 / 选词题,每天 2 道新学 + 3 道复习(错题优先)
   答题记录存 localStorage(exp_quiz),可统计正确率与错题本
   ============================================================ */
window.QUIZ_ENGINE = {
  DAILY_MAX: 5,

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  /* 干扰项:优先同分类,不够再全局随机 */
  distractors(g, all, n) {
    const others = all.filter((x) => x.word !== g.word);
    const same = others.filter((x) => x.cat === g.cat);
    const pool = same.length >= n ? same : others;
    return this.shuffle(pool).slice(0, n);
  },

  questionFor(g, all, type) {
    const dists = this.distractors(g, all, 3);
    if (type === "选义") {
      const options = this.shuffle([
        { text: g.plain, correct: true },
        ...dists.map((d) => ({ text: d.plain, correct: false })),
      ]);
      return {
        g, type,
        prompt: `「${g.word}」是什么意思?`,
        explain: g.example,
        tip: g.tip,
        options,
      };
    }
    const clue = g.plain.length > 44 ? g.plain.slice(0, 44) + "…" : g.plain;
    const options = this.shuffle([
      { text: g.word, correct: true },
      ...dists.map((d) => ({ text: d.word, correct: false })),
    ]);
    return {
      g, type,
      prompt: `哪个术语的意思是:「${clue}」?`,
      explain: g.example,
      tip: g.tip,
      options,
    };
  },

  /* 今日题目:2 新学 + 3 复习(错题优先),不足时用当天第 3 词补 */
  buildDay() {
    const list = window.GLOSSARY || [];
    if (!list.length) return [];
    const daily = window.GLOSSARY_DAILY || 3;
    const start = new Date(window.GLOSSARY_START + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayIndex = Math.max(0, Math.floor((today - start) / 86400000));
    const unlocked = list.slice(0, Math.min(list.length, (dayIndex + 1) * daily));
    const todayWords = list.slice(dayIndex * daily, dayIndex * daily + daily);
    const todaySet = new Set(todayWords.map((w) => w.word));

    // 错题本(答错过优先复习)
    let wrongCount = {};
    try {
      const recs = JSON.parse(localStorage.getItem("exp_quiz") || "[]");
      recs.forEach((r) => { if (!r.correct) wrongCount[r.word] = (wrongCount[r.word] || 0) + 1; });
    } catch (e) { wrongCount = {}; }
    const wrongWords = Object.keys(wrongCount)
      .filter((w) => !todaySet.has(w))
      .sort((a, b) => (wrongCount[b] || 0) - (wrongCount[a] || 0));

    const pool = unlocked.filter((g) => !todaySet.has(g.word));
    const byWrong = wrongWords.map((w) => list.find((g) => g.word === w)).filter(Boolean);
    const rest = this.shuffle(pool.filter((g) => !byWrong.includes(g)));
    const review = byWrong.concat(rest).slice(0, 3);

    const questions = [];
    todayWords.slice(0, 2).forEach((g) => {
      questions.push(this.questionFor(g, list, "选义"));
      questions.push(this.questionFor(g, list, "选词"));
    });
    review.forEach((g) => {
      questions.push(this.questionFor(g, list, Math.random() < 0.5 ? "选义" : "选词"));
    });
    // 第 1 天只有 3 个词:用第 3 词补 1 题
    if (questions.length < this.DAILY_MAX && todayWords[2]) {
      questions.push(this.questionFor(todayWords[2], list, "选词"));
    }
    return questions.slice(0, this.DAILY_MAX);
  },

  /* 答题记录 */
  loadRecs() {
    try { return JSON.parse(localStorage.getItem("exp_quiz") || "[]"); }
    catch (e) { return []; }
  },
  saveRecs(r) { localStorage.setItem("exp_quiz", JSON.stringify(r)); },

  stats() {
    const recs = this.loadRecs();
    const correct = recs.filter((r) => r.correct).length;
    const wrong = recs.filter((r) => !r.correct).length;
    // 错题本: 按词统计,答错过的词
    const wrongMap = {};
    recs.forEach((r) => { if (!r.correct) wrongMap[r.word] = (wrongMap[r.word] || 0) + 1; });
    const wrongBook = Object.keys(wrongMap)
      .map((w) => ({ word: w, count: wrongMap[w] }))
      .sort((a, b) => b.count - a.count);
    return { total: recs.length, correct, wrong, rate: recs.length ? Math.round((correct / recs.length) * 100) : 0, wrongBook };
  },
};
