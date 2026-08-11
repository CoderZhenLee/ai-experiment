#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
¥10000 投资实验 — 真实数据更新脚本
====================================
用法(每天收盘后运行一次):
    python3 update_data.py

功能:
  1. 从东方财富公开接口拉取候选池每只股票的:
     - 实时行情(最新价/涨跌/PE/PB/总市值/52周高低/换手率)
     - 近 250 交易日日K(计算均线/RSI/动量/波动率/最大回撤/Beta)
     - 最新报告期财务指标(ROE/毛利率/营收同比/净利同比/每股现金流)
  2. 按五维评分模型(估值25/盈利25/成长20/趋势15/波动15)计算研报级子指标分
  3. 加权综合分 → 排名 → 评级(A/B/C/D)
  4. 输出 real_data.json(前端真实模式数据源)

数据来源:东方财富公开行情接口(仅用于个人研究,请遵守其服务条款)。
免责声明:输出结果仅用于信息与研究,不构成投资建议。
"""

import json
import math
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

OUT_FILE = "real_data.json"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

# ---------------------------------------------------------------
# 候选池(与 data.js 的 pool 一致;可自行增删,注意 secid 前缀:
#   沪市/科创板 = 1.xxx,深市/创业板 = 0.xxx)
# ---------------------------------------------------------------
POOL = [
    {"name": "贵州茅台", "code": "600519", "secid": "1.600519", "industry": "白酒", "brief": "超高端白酒龙头,品牌稀缺性强"},
    {"name": "宁德时代", "code": "300750", "secid": "0.300750", "industry": "动力电池", "brief": "全球动力电池龙头,储能第二曲线"},
    {"name": "美的集团", "code": "000333", "secid": "0.000333", "industry": "家电", "brief": "白电龙头,机器人与工业自动化"},
    {"name": "比亚迪",   "code": "002594", "secid": "0.002594", "industry": "新能源车", "brief": "新能源车垂直一体化,出口高增长"},
    {"name": "招商银行", "code": "600036", "secid": "1.600036", "industry": "银行", "brief": "零售银行龙头,财富管理优势"},
    {"name": "中芯国际", "code": "688981", "secid": "1.688981", "industry": "半导体", "brief": "大陆晶圆代工龙头,国产替代主线"},
    {"name": "万华化学", "code": "600309", "secid": "1.600309", "industry": "化工", "brief": "MDI 全球龙头,新材料打开空间"},
    {"name": "恒瑞医药", "code": "600276", "secid": "1.600276", "industry": "医药", "brief": "创新药龙头,管线进入收获期"},
    {"name": "中国平安", "code": "601318", "secid": "1.601318", "industry": "保险", "brief": "综合金融集团,医疗养老生态"},
    {"name": "隆基绿能", "code": "601012", "secid": "1.601012", "industry": "光伏", "brief": "光伏组件龙头,行业产能过剩承压"},
]
INDEX_HS300 = {"name": "沪深300", "code": "000300", "secid": "1.000300"}

# ---------------------------------------------------------------
# 指数 / ETF 观察列表(仅供参考,不参与个股评分)
#   宽基指数:打包整个市场(分散最高)
#   行业ETF:打包一个行业(分散中等)
#   注:这些是"分类标签"对应的可投资标的,帮助理解板块与个股的关系
# ---------------------------------------------------------------
ETF_POOL = {
    "indices": [
        {"name": "上证50", "code": "000016", "secid": "1.000016", "brief": "沪市最大的 50 家巨头,最稳的一篮子"},
        {"name": "沪深300", "code": "000300", "secid": "1.000300", "brief": "沪深两市最大的 300 家,最常被定投"},
        {"name": "中证500", "code": "000905", "secid": "1.000905", "brief": "排名 301~800 的中坚公司,弹性更大"},
        {"name": "创业板指", "code": "399006", "secid": "0.399006", "brief": "成长型公司,涨跌波动较大"},
        {"name": "科创50", "code": "000688", "secid": "1.000688", "brief": "科创板科技 50 家,偏硬科技"},
    ],
    "industry": [
        {"name": "军工ETF", "code": "512660", "secid": "1.512660", "brief": "国防军工一篮子:航空/航天/船舶"},
        {"name": "医药ETF", "code": "512010", "secid": "1.512010", "brief": "医药生物一篮子:制药/器械/服务"},
        {"name": "半导体ETF", "code": "512480", "secid": "1.512480", "brief": "芯片半导体一篮子"},
        {"name": "白酒ETF", "code": "512690", "secid": "1.512690", "brief": "白酒板块一篮子"},
        {"name": "新能源ETF", "code": "516160", "secid": "1.516160", "brief": "新能源产业链一篮子"},
        {"name": "证券ETF", "code": "512880", "secid": "1.512880", "brief": "券商板块一篮子,牛市放大器"},
    ],
}

WEIGHTS = [22, 22, 18, 14, 14, 10]  # 估值/盈利/成长/趋势/波动/新闻情绪
DIM_NAMES = ["估值", "盈利能力", "成长性", "趋势", "波动风险", "新闻情绪"]

# ---------------------------------------------------------------
# 新闻情绪词典(可复现的关键词打分,不是 AI 语义)
# ---------------------------------------------------------------
POSITIVE_WORDS = [
    "中标", "签约", "增持", "回购", "回购注销", "业绩预增", "预增", "扭亏",
    "扭亏为盈", "创新高", "突破", "获批", "获批准", "扩产", "提价", "涨价",
    "放量上涨", "超预期", "分红", "分红方案", "涨停", "大订单", "订单",
    "战略合作", "并购", "重组", "资产注入", "净利润增长", "营收增长",
    "毛利率提升", "股东回报", "销量增长", "出货量", "产能释放", "景气回升",
]
NEGATIVE_WORDS = [
    "减持", "质押", "股权质押", "违规", "处罚", "罚款", "立案", "被立案",
    "业绩预亏", "预亏", "亏损", "业绩下滑", "下滑", "下跌", "跌停", "破发",
    "停产整顿", "责令停产", "停产整改", "停产风波", "事故", "召回", "诉讼",
    "被诉", "退市", "退市风险", "爆雷", "商誉减值", "解禁", "限售解禁",
    "债务违约", "违约", "评级下调", "高管离职", "辞职", "会计差错",
    "财务造假", "套现", "冻结", "警示函", "问询函", "监管函", "风险提示",
]
# 核心财经媒体(权重 ×1.5)
CORE_MEDIA = ["财联社", "证券时报", "上海证券报", "中国证券报", "证券日报",
              "新华社", "第一财经", "每日经济新闻", "界面新闻", "21世纪经济报道"]


def score_news_sentiment(news, announcements, asof=None):
    """对新闻/公告打分,返回情绪值(-10~+10)与维度分(0-100)。

    规则(全部可复现):
      - 标题命中词权重 2,正文命中权重 1
      - 公告(确定性事件)额外权重 2
      - 核心媒体权重 1.5
      - 时间衰减: 1 / (1 + 距今天数)
    """
    import re as _re
    asof = asof or datetime.now()

    def hits(text, words):
        if not text:
            return 0
        return sum(1 for w in words if w in text)

    total, wsum = 0.0, 0.0
    pos_count = neg_count = 0
    for it in (news or []):
        title = it.get("title") or ""
        content = it.get("content") or ""
        p = hits(title, POSITIVE_WORDS) * 2 + hits(content, POSITIVE_WORDS)
        n = hits(title, NEGATIVE_WORDS) * 2 + hits(content, NEGATIVE_WORDS)
        s = p - n
        if s == 0:
            continue
        # 时间权重
        try:
            days = (asof - datetime.strptime((it.get("date") or "")[:10], "%Y-%m-%d")).days
        except ValueError:
            days = 0
        days = max(0, min(days, 30))
        w = 1.0 / (1.0 + days)
        # 来源权重
        media = it.get("media") or ""
        if any(m in media for m in CORE_MEDIA):
            w *= 1.5
        if p > n:
            pos_count += 1
        elif n > p:
            neg_count += 1
        total += s * w
        wsum += w
    # 公告(确定性事件)双倍权重
    for a in (announcements or []):
        title = a.get("title") or ""
        t = a.get("type") or ""
        text = title + " " + t
        p = hits(text, POSITIVE_WORDS)
        n = hits(text, NEGATIVE_WORDS)
        s = (p - n) * 2
        if s == 0:
            continue
        try:
            days = (asof - datetime.strptime((a.get("date") or "")[:10], "%Y-%m-%d")).days
        except ValueError:
            days = 0
        days = max(0, min(days, 30))
        w = 2.0 / (1.0 + days)
        if p > n:
            pos_count += 1
        elif n > p:
            neg_count += 1
        total += s * w
        wsum += w

    avg = total / wsum if wsum else 0.0
    avg = max(-10.0, min(10.0, round(avg, 2)))
    score = max(0, min(100, round(50 + avg * 5, 1)))
    if avg > 1.5:
        tag = "利好"
    elif avg < -1.5:
        tag = "利空"
    else:
        tag = "中性"
    return {"sentiment": avg, "score": score, "tag": tag,
            "pos": pos_count, "neg": neg_count}


def http_get(url, referer=None):
    """标准库 GET,带 UA,自动重试 3 次。"""
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Referer": referer or "https://quote.eastmoney.com/",
                "Accept": "*/*",
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                return raw.decode("utf-8", errors="replace")
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))


def secid2tencent(secid):
    """1.600036 → sh600036;0.300750 → sz300750"""
    mkt, code = secid.split(".")
    return ("sh" if mkt == "1" else "sz") + code


def fetch_quote_tencent(secid):
    """备用行情源:腾讯。字段见 qt.gtimg.cn 返回,按 ~ 分割。"""
    sym = secid2tencent(secid)
    url = "https://qt.gtimg.cn/q=" + sym
    raw = http_get(url, referer="https://gu.qq.com/")
    if "=" not in raw:
        return None
    body = raw.split("=", 1)[1].strip().strip(";").strip('"')
    f = body.split("~")
    if len(f) < 50:
        return None

    def num(i):
        try:
            return float(f[i])
        except (ValueError, IndexError):
            return None

    price = num(3)
    prev = num(4)
    return {
        "price": price,
        "prev_close": prev,
        "high": num(33),
        "low": num(34),
        "open": num(5),
        "change_pct": num(32),
        "volume": num(6),
        "amount": num(37) * 10000 if num(37) else None,   # 腾讯成交额为万元
        "turnover_rate": num(38),
        "pe_ttm": num(39),
        "pe_dynamic": num(52),
        "pe_static": num(53),
        "volume_ratio": num(49),                  # 量比(腾讯字段,非BPS)
        "market_cap": num(45) * 1e8 if num(45) else None, # 亿元 → 元
        "float_cap": num(44) * 1e8 if num(44) else None,
        "high52": num(47),
        "low52": num(48),
        "pb": num(46),
    }


def fetch_kline_tencent(secid, lmt=250):
    """备用K线源:腾讯前复权日K。"""
    sym = secid2tencent(secid)
    url = ("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,,,{lmt},qfq"
           .format(sym=sym, lmt=lmt))
    data = json.loads(http_get(url, referer="https://gu.qq.com/"))
    node = (data.get("data") or {}).get(sym) or {}
    rows_raw = node.get("qfqday") or node.get("day") or []
    rows = []
    for r in rows_raw:
        rows.append({
            "date": r[0],
            "open": float(r[1]),
            "close": float(r[2]),
            "high": float(r[3]),
            "low": float(r[4]),
            "volume": float(r[5]) if len(r) > 5 else 0,
            "amount": 0,
        })
    return rows


def fetch_quote(secid):
    """实时行情快照。东财主源 → 失败自动切换腾讯。"""
    try:
        q = fetch_quote_em(secid)
        if q:
            return q
    except Exception:
        pass
    return fetch_quote_tencent(secid)


def fetch_quote_em(secid):
    """东财实时行情快照。"""
    url = ("https://push2.eastmoney.com/api/qt/stock/get?"
           "secid={secid}&fields=f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,"
           "f84,f85,f92,f116,f117,f162,f163,f167,f168,f174,f175,f183,f184".format(secid=urllib.parse.quote(secid)))
    data = json.loads(http_get(url)).get("data") or {}
    if not data:
        return None

    def p100(v):
        try:
            return float(v) / 100.0
        except (TypeError, ValueError):
            return None

    price = p100(data.get("f43"))
    prev = p100(data.get("f60"))
    return {
        "price": price,
        "prev_close": prev,
        "high": p100(data.get("f44")),
        "low": p100(data.get("f45")),
        "open": p100(data.get("f46")),
        "change_pct": round((price / prev - 1) * 100, 2) if price and prev else None,
        "volume": data.get("f47"),            # 手
        "amount": data.get("f48"),            # 元
        "turnover_rate": p100(data.get("f168")),  # 换手率 %
        "pe_dynamic": p100(data.get("f162")),     # PE 动态
        "pe_ttm": p100(data.get("f163")),         # PE TTM
        "pe_static": p100(data.get("f167")),      # PE 静态
        "bps": data.get("f92"),                   # 每股净资产(元,原值)
        "market_cap": data.get("f116"),           # 总市值
        "float_cap": data.get("f117"),            # 流通市值
        "high52": p100(data.get("f174")),         # 52周高
        "low52": p100(data.get("f175")),          # 52周低
        "pb": (price / data.get("f92")) if price and data.get("f92") else None,
    }


def fetch_kline(secid, lmt=250):
    """近 N 个交易日的日K。东财主源 → 失败自动切换腾讯。"""
    try:
        k = fetch_kline_em(secid, lmt)
        if k:
            return k
    except Exception:
        pass
    return fetch_kline_tencent(secid, lmt)


def fetch_kline_em(secid, lmt=250):
    """近 N 个交易日的日K: [date, open, close, high, low, volume, amount, amplitude]"""
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
           "secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58"
           "&klt=101&fqt=1&end=20500101&lmt={lmt}".format(
               secid=urllib.parse.quote(secid), lmt=lmt))
    data = json.loads(http_get(url)).get("data") or {}
    rows = []
    for line in data.get("klines", []):
        parts = line.split(",")
        rows.append({
            "date": parts[0],
            "open": float(parts[1]),
            "close": float(parts[2]),
            "high": float(parts[3]),
            "low": float(parts[4]),
            "volume": float(parts[5]),
            "amount": float(parts[6]),
        })
    return rows


def fetch_finance(code):
    """最新报告期财务指标(东财 F10)。"""
    url = ("https://datacenter-web.eastmoney.com/api/data/v1/get?"
           "reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL"
           "&filter=(SECUCODE%3D%22{code}.{mkt}%22)&pageNumber=1&pageSize=1"
           "&sortColumns=REPORT_DATE&sortTypes=-1".format(
               code=code, mkt="SH" if code.startswith(("6", "9")) else "SZ"))
    data = json.loads(http_get(url, referer="https://emweb.securities.eastmoney.com/"))
    rows = ((data.get("result") or {}).get("data")) or []
    if not rows:
        return None
    r = rows[0]

    def g(key):
        v = r.get(key)
        return v if isinstance(v, (int, float)) else None

    rev = g("TOTALOPERATEREVE")
    mlr = g("MLR")
    gross = round(mlr / rev * 100, 2) if rev and mlr else None
    # 季度 ROE 年化(按报告期月份:3→×4, 6→×2, 9→×4/3, 12→×1),使跨公司可比
    rd = (r.get("REPORT_DATE") or "")
    try:
        month = int(rd[5:7]) if len(rd) >= 7 else 12
    except (ValueError, IndexError):
        month = 12
    annualize = {3: 4.0, 6: 2.0, 9: 4.0 / 3.0}.get(month, 1.0)
    roe_raw = g("ROEJQ")
    roe_ann = round(roe_raw * annualize, 2) if roe_raw is not None else None
    return {
        "report_date": rd[:10],
        "report_name": r.get("REPORT_DATE_NAME"),
        "roe": roe_raw,                           # 最新报告期 ROE(累计)%
        "roe_annual": roe_ann,                    # 年化 ROE %
        "gross_margin": gross,                    # 毛利率 %
        "rev_yoy": g("TOTALOPERATEREVETZ"),       # 营收同比 %
        "profit_yoy": g("PARENTNETPROFITTZ"),     # 净利同比 %
        "eps": g("EPSJB"),
        "cfps": g("MGJYXJJE"),                    # 每股经营现金流
        "net_margin": g("XSMLL") if g("XSMLL") is not None else None,
    }


def fetch_news(code, name, limit=5):
    """个股新闻(东财资讯搜索)。返回最近 limit 条:{date,title,media,url}"""
    import re as _re
    param = json.dumps({
        "uid": "", "keyword": name, "type": ["cmsArticleWebOld"],
        "client": "web", "clientType": "web",
        "param": {"cmsArticleWebOld": {"searchScope": "default", "sort": "default",
                                       "pageIndex": 1, "pageSize": limit}},
    }, ensure_ascii=False)
    url = ("https://search-api-web.eastmoney.com/search/jsonp?cb=x&param=" +
           urllib.parse.quote(param))
    try:
        raw = http_get(url)
        if not raw or "(" not in raw:
            return []
        body = raw[raw.index("(") + 1:raw.rindex(")")]
        data = json.loads(body)
        items = ((data.get("result") or {}).get("cmsArticleWebOld")) or []
        out = []
        for it in items:
            title = _re.sub(r"</?em>", "", it.get("title") or "")
            content = _re.sub(r"</?em>", "", it.get("content") or "")[:150]
            out.append({
                "date": (it.get("date") or "")[:10],
                "title": title,
                "content": content,
                "media": it.get("mediaName") or "",
                "url": it.get("url") or "",
            })
        return out[:limit]
    except Exception:
        return []


def fetch_announcements(code, limit=3):
    """公司公告(东财)。返回最近 limit 条:{date,type,title}"""
    url = ("https://np-anotice-stock.eastmoney.com/api/security/ann?"
           "sr=-1&page_size={limit}&page_index=1&ann_type=A&client_source=web"
           "&stock_list={code}".format(limit=limit, code=code))
    try:
        data = json.loads(http_get(url))
        items = ((data.get("data") or {}).get("list")) or []
        out = []
        for it in items:
            cols = it.get("columns") or []
            out.append({
                "date": (it.get("display_time") or "")[:10],
                "type": cols[0].get("column_name") if cols else "",
                "title": it.get("title") or "",
            })
        return out[:limit]
    except Exception:
        return []


def fetch_research(code, days=180, limit=5):
    """券商研报评级(东财研报中心)。返回最近 limit 条:{date,org,rating,target,title}"""
    end = datetime.now()
    begin = end - timedelta(days=days)
    url = ("https://reportapi.eastmoney.com/report/list?"
           "cb=&industryCode=*&pageSize={limit}"
           "&beginTime={b}&endTime={e}&pageNo=1&qType=0&code={code}".format(
               limit=limit,
               b=begin.strftime("%Y-%m-%d"),
               e=end.strftime("%Y-%m-%d"),
               code=code))
    try:
        data = json.loads(http_get(url))
        items = data.get("data") or []
        out = []
        for it in items:
            out.append({
                "date": (it.get("publishDate") or "")[:10],
                "org": it.get("orgSName") or "",
                "rating": it.get("sRatingName") or "",
                "target": it.get("sTargetPrice"),
                "title": it.get("title") or "",
            })
        return out[:limit]
    except Exception:
        return []


def fetch_macro():
    """宏观环境(参考):原油/黄金/美元指数/人民币汇率/恒指。"""
    import re as _re

    def get_bytes(url, referer):
        req = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT, "Referer": referer, "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read()

    out = []
    # 腾讯 hf_ 系列:纽约原油 / 布伦特 / 黄金(返回 GBK)
    try:
        raw = get_bytes("https://qt.gtimg.cn/q=hf_CL,hf_OIL,hf_GC", "https://gu.qq.com/").decode("gbk", errors="replace")
        for line in raw.split(";"):
            if "=" not in line:
                continue
            name, body = line.split("=", 1)
            f = body.strip().strip(";").strip('"').split(",")
            if len(f) < 14:
                continue
            try:
                out.append({
                    "key": name.strip().replace("v_", ""),
                    "name": f[13],
                    "value": round(float(f[0]), 2),
                    "change_pct": round(float(f[1]), 2),
                })
            except (ValueError, IndexError):
                continue
    except Exception:
        pass
    # 新浪:美元指数 / 美元人民币
    try:
        raw = get_bytes("https://hq.sinajs.cn/list=DINIW,USDCNY", "https://finance.sina.com.cn").decode("gbk", errors="replace")
        for line in raw.split("\n"):
            m = _re.match(r'var hq_str_(\w+)="([^"]*)"', line.strip())
            if not m or not m.group(2):
                continue
            key, f = m.group(1), m.group(2).split(",")
            try:
                if key == "DINIW" and len(f) > 9:
                    out.append({"key": "DINIW", "name": f[9], "value": round(float(f[1]), 2), "change_pct": None})
                elif key == "USDCNY" and len(f) > 9:
                    out.append({"key": "USDCNY", "name": f[9], "value": round(float(f[1]), 4), "change_pct": None})
            except (ValueError, IndexError):
                continue
    except Exception:
        pass
    # 恒生指数(腾讯港股,GBK)
    try:
        raw = get_bytes("https://qt.gtimg.cn/q=r_hkHSI", "https://gu.qq.com/").decode("gbk", errors="replace")
        f = raw.split("=", 1)[1].strip().strip(";").strip('"').split("~")
        if len(f) > 33:
            out.append({"key": "HSI", "name": "恒生指数", "value": round(float(f[3]), 2), "change_pct": round(float(f[32]), 2)})
    except Exception:
        pass
    return out


def fetch_etf_watch():
    """拉取宽基指数 + 行业ETF 实时行情(参考层,不参与个股评分)。

    返回 {indices: [...], industry: [...]},每项含
    {name, code, brief, price, change_pct, pe_ttm, pb, market_cap}
    """
    out = {"indices": [], "industry": [], "errors": []}
    for grp, items in ETF_POOL.items():
        for it in items:
            try:
                # 注意:东财 push2 接口对 ETF 价格字段编码与股票不同(差10倍),
                # 因此指数/ETF 统一走腾讯源(已验证价格与 PE 正确)。
                q = fetch_quote_tencent(it["secid"])
                if not q or not q.get("price"):
                    raise ValueError("行情为空")
                out[grp].append({
                    "name": it["name"],
                    "code": it["code"],
                    "secid": it["secid"],
                    "brief": it["brief"],
                    "price": q.get("price"),
                    "change_pct": q.get("change_pct"),
                    "pe_ttm": q.get("pe_ttm"),
                    "pb": q.get("pb"),
                    "market_cap": q.get("market_cap"),
                })
            except Exception as e:
                out["errors"].append({"name": it.get("name"), "error": str(e)})
            time.sleep(0.4)
    return out


# ---------------------------------------------------------------
# 技术指标计算
# ---------------------------------------------------------------
def calc_indicators(kline):
    closes = [k["close"] for k in kline]
    n = len(closes)
    if n < 70:
        raise ValueError("K线数据不足(需≥70个交易日)")

    def sma(win):
        if n < win:
            return None
        return sum(closes[-win:]) / win

    ma20, ma60 = sma(20), sma(60)

    # RSI14
    gains, losses = [], []
    for i in range(1, n):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    ag = sum(gains[-14:]) / 14
    al = sum(losses[-14:]) / 14
    rsi14 = round(100.0 - 100.0 / (1.0 + ag / al), 1) if al > 0 else 100.0

    # 20日动量
    mom20 = (closes[-1] / closes[-21] - 1) * 100 if n > 21 else None

    # 20日年化波动率
    rets = [(closes[i] / closes[i - 1] - 1) for i in range(n - 20, n)]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    vol20 = round(math.sqrt(var) * math.sqrt(252) * 100, 2)

    # 60日最大回撤
    peak = max(closes[-60:])
    trough = min(closes[-60:])
    max_dd60 = round((trough / peak - 1) * 100, 2)

    # MA20 斜率(20日变化%)
    ma20_prev = sum(closes[-40:-20]) / 20 if n >= 40 else None
    ma20_slope = round((ma20 / ma20_prev - 1) * 100, 2) if ma20 and ma20_prev else None

    return {
        "close": closes[-1],
        "ma20": round(ma20, 2) if ma20 else None,
        "ma60": round(ma60, 2) if ma60 else None,
        "rsi14": rsi14,
        "mom20": round(mom20, 2) if mom20 is not None else None,
        "vol20": vol20,
        "max_dd60": max_dd60,
        "ma20_slope": ma20_slope,
    }


# ---------------------------------------------------------------
# 子指标 → 分数(研报级拆解)
# ---------------------------------------------------------------
def norm(v, default=50.0):
    """缺失数据用中性分,避免误判为最差。"""
    return v if v is not None else default


def score_band(value, bands):
    """bands: [(上限, 分数), ...],按值落入区间取分,线性插值。"""
    value = value if value is not None else -1e9
    prev_hi, prev_score = None, None
    for hi, score in sorted(bands, key=lambda b: b[0]):
        if value <= hi:
            if prev_hi is None:
                return score
            t = (value - prev_hi) / (hi - prev_hi)
            return round(prev_score + t * (score - prev_score), 1)
        prev_hi, prev_score = hi, score
    return prev_score


def score_val(pe, pb, pos52):
    """估值:PE 水平 50% + 52周位置 30% + PB 水平 20%。"""
    pe, pb, pos52 = norm(pe), norm(pb), norm(pos52)
    s_pe = score_band(pe, [
        (10, 95), (15, 85), (20, 75), (30, 60), (50, 45), (1e9, 30)])
    s_pb = score_band(pb, [
        (1, 95), (2, 85), (3, 75), (5, 60), (8, 45), (1e9, 30)])
    # 52周位置:越低越有吸引力(便宜)
    s_pos = score_band(1 - pos52, [
        (0.15, 90), (0.35, 75), (0.55, 60), (0.75, 45), (1e9, 30)])
    return round(0.5 * s_pe + 0.3 * s_pos + 0.2 * s_pb, 1)


def score_prof(roe, gross, cf_eps_ratio):
    """盈利:年化ROE 50% + 毛利率 30% + 现金流/净利质量 20%。"""
    roe, gross, cf_eps_ratio = norm(roe), norm(gross), norm(cf_eps_ratio)
    s_roe = score_band(roe, [
        (0, 25), (5, 50), (10, 70), (15, 85), (20, 95), (1e9, 98)])
    s_gm = score_band(gross, [
        (10, 30), (25, 50), (40, 70), (60, 88), (1e9, 95)])
    s_cf = score_band(cf_eps_ratio, [
        (0, 25), (0.3, 45), (0.6, 65), (1.0, 85), (1e9, 95)])
    return round(0.5 * s_roe + 0.3 * s_gm + 0.2 * s_cf, 1)


def score_grow(rev_yoy, profit_yoy):
    """成长:营收同比 60% + 净利同比 40%。"""
    rev_yoy, profit_yoy = norm(rev_yoy), norm(profit_yoy)
    s_rev = score_band(rev_yoy, [
        (-20, 20), (0, 40), (10, 65), (20, 82), (30, 92), (1e9, 97)])
    s_pro = score_band(profit_yoy, [
        (-30, 15), (0, 38), (10, 62), (20, 80), (35, 92), (1e9, 97)])
    return round(0.6 * s_rev + 0.4 * s_pro, 1)


def score_trend(ma20, ma60, close, slope, rsi):
    """趋势:均线排列 40% + MA20 斜率 30% + RSI 30%。"""
    slope = norm(slope)
    if None in (ma20, ma60, close):
        s_ma = 50
    elif close > ma20 > ma60:
        s_ma = 90
    elif close > ma20 and close > ma60:
        s_ma = 72
    elif close > ma20 and close < ma60:
        s_ma = 55
    elif close < ma20 < ma60:
        s_ma = 30
    else:
        s_ma = 20
    s_slope = score_band(slope, [(-2, 25), (0, 55), (1, 72), (2, 85), (1e9, 92)])
    if rsi is None:
        s_rsi = 50
    elif 55 <= rsi <= 72:
        s_rsi = 88
    elif 45 <= rsi < 55:
        s_rsi = 70
    elif 30 <= rsi < 45 or 72 < rsi <= 80:
        s_rsi = 55
    elif rsi < 30:
        s_rsi = 40
    else:
        s_rsi = 35
    return round(0.4 * s_ma + 0.3 * s_slope + 0.3 * s_rsi, 1)


def score_vol(vol20, dd60):
    """波动:年化波动率 50% + 60日最大回撤 50%(分高=稳)。"""
    vol20, dd60 = norm(vol20), norm(dd60)
    s_v = score_band(vol20, [
        (15, 95), (25, 75), (35, 55), (50, 35), (1e9, 15)])
    s_d = score_band(-dd60, [
        (-5, 90), (-10, 72), (-20, 52), (-30, 35), (-1e9, 15)])
    return round(0.5 * s_v + 0.5 * s_d, 1)


def grade_of(total):
    if total >= 85:
        return "A", "买入"
    if total >= 75:
        return "B", "关注"
    if total >= 60:
        return "C", "观察"
    return "D", "卖出/规避"


def load_last_dims(code):
    """盘中模式:读取最近一次完整评分中该股票的 5 个模型维度分。"""
    try:
        with open("real_data.json", encoding="utf-8") as f:
            prev = json.load(f)
        for r in prev.get("pool", []):
            if r["code"] == code and len(r.get("dims", [])) >= 5:
                return r["dims"][:5]
    except Exception:
        pass
    return None


def grade_color(g):
    return {"A": "#e8b84b", "B": "#ffb020", "C": "#5b8cff", "D": "#2fc98c"}.get(g, "#888")


# ---------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------
def main():
    import sys
    QUICK = "--quick" in sys.argv  # 盘中模式:只拉行情+新闻+公告,快(~15s)
    print("=" * 60)
    print("¥10000 投资实验 · 真实数据更新" + (" · 盘中快速模式" if QUICK else ""))
    print("数据源: 东方财富/腾讯公开接口")
    print("=" * 60)

    results = []
    errors = []

    for item in POOL:
        code, secid, name = item["code"], item["secid"], item["name"]
        try:
            print("\n[{name} {code}] 抓取中 ...".format(name=name, code=code))
            quote = fetch_quote(secid)
            if not quote or not quote.get("price"):
                raise ValueError("行情为空")
            if QUICK:
                ind = None
                fin = None
            else:
                kline = fetch_kline(secid, 250)
                ind = calc_indicators(kline)
                fin = fetch_finance(code)
            time.sleep(0.5)
            news = fetch_news(code, name, 8)
            time.sleep(0.5)
            anns = fetch_announcements(code, 5)
            if not QUICK:
                time.sleep(0.5)
                research = fetch_research(code, 180, 5)
            else:
                research = []
            time.sleep(0.6)

            # 新闻情绪(第 6 维)
            senti = score_news_sentiment(news, anns)

            price = quote["price"]
            high52, low52 = quote["high52"], quote["low52"]
            pos52 = (price - low52) / (high52 - low52) if high52 and low52 and high52 > low52 else 0.5

            if QUICK:
                # 盘中模式:模型维度沿用最近一次完整评分的 dims(从 real_data.json 读)
                dims = load_last_dims(code) or [50, 50, 50, 50, 50]
            else:
                cf_ratio = (fin["cfps"] / fin["eps"]) if fin and fin.get("cfps") and fin.get("eps") else None
                dims = [
                    score_val(quote["pe_ttm"], quote["pb"], pos52),
                    score_prof(fin["roe_annual"] if fin else None,
                               fin["gross_margin"] if fin else None, cf_ratio),
                    score_grow(fin["rev_yoy"] if fin else None,
                               fin["profit_yoy"] if fin else None),
                    score_trend(ind["ma20"], ind["ma60"], price, ind["ma20_slope"], ind["rsi14"]),
                    score_vol(ind["vol20"], ind["max_dd60"]),
                ]
            dims.append(senti["score"])  # 第 6 维:新闻情绪
            total = round(sum(d * w for d, w in zip(dims, WEIGHTS)) / sum(WEIGHTS), 1)
            grade, action = grade_of(total)

            rec = {
                "name": name, "code": code, "secid": secid,
                "industry": item["industry"], "brief": item["brief"],
                "quote": quote,
                "tech": ind or {},
                "finance": fin or {},
                "news": news,
                "announcements": anns,
                "research": research,
                "sentiment": senti,
                "pos52": round(pos52, 3),
                "dims": dims,
                "total": total,
                "grade": grade,
                "action": action,
            }
            results.append(rec)
            print("    最新价 ¥{p}  涨跌 {c}%  情绪 {tag}({s})".format(
                p=price, c=quote["change_pct"], tag=senti["tag"], s=senti["sentiment"]))
            if not QUICK:
                print("    ROE {roe}%  毛利 {gm}%  营收同比 {rv}%".format(
                    roe=fin["roe"] if fin and fin.get("roe") is not None else "-",
                    gm=fin["gross_margin"] if fin and fin.get("gross_margin") is not None else "-",
                    rv=fin["rev_yoy"] if fin and fin.get("rev_yoy") is not None else "-",
                ))
            print("    RSI {rsi}  综合 {total}  [{grade} {action}]".format(
                rsi=(ind or {}).get("rsi14", "-"), total=total, grade=grade, action=action))
            time.sleep(0.8)
        except Exception as e:
            errors.append((name, str(e)))
            print("    !! 抓取失败: {e}".format(e=e))

    # 沪深300(基准)
    bench = None
    try:
        q = fetch_quote(INDEX_HS300["secid"])
        k = fetch_kline(INDEX_HS300["secid"], 250)
        if q and k:
            bench = {
                "name": "沪深300", "code": "000300",
                "price": q["price"], "change_pct": q["change_pct"],
                "tech": calc_indicators(k),
            }
    except Exception as e:
        print("沪深300 基准抓取失败:", e)

    # 排序输出
    results.sort(key=lambda r: r["total"], reverse=True)
    ranked = []
    for i, r in enumerate(results):
        ranked.append(dict(r, rank=i + 1))

    # 指数 / ETF 观察列表(宽基 + 行业)
    etf_watch = fetch_etf_watch()
    etf_ok = len(etf_watch["indices"]) + len(etf_watch["industry"])
    print("\n指数/ETF 观察:成功 {ok} 项".format(ok=etf_ok))
    for it in etf_watch["indices"]:
        print("   [宽基] {name:<8} {price:>9}  涨跌 {c}%".format(
            name=it["name"], price=it["price"], c=it["change_pct"]))
    for it in etf_watch["industry"]:
        print("   [行业] {name:<8} {price:>9}  涨跌 {c}%".format(
            name=it["name"], price=it["price"], c=it["change_pct"]))
    if etf_watch["errors"]:
        print("   失败:", [e["name"] for e in etf_watch["errors"]])

    payload = {
        "meta": {
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "data_mode": "real",
            "source": "eastmoney",
            "pool_size": len(ranked),
            "has_errors": [{"stock": n, "error": e} for n, e in errors],
        },
        "benchmark": bench,
        "macro": fetch_macro(),
        "etf": etf_watch,
        "pool": ranked,
        "scores": ranked[:5],
        "weights": [{"name": n, "w": w} for n, w in zip(DIM_NAMES, WEIGHTS)],
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    # JSONP 版本(file:// 双击打开网页时,script 标签加载不受 CORS 限制)
    with open("real_data.js", "w", encoding="utf-8") as f:
        f.write("window.REAL_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n")

    # -----------------------------------------------------------
    # 真实成交 → 净值快照(portfolio_history.json)
    # 读取用户从「交易执行台」导出的 trades_record.json,按最新价
    # 计算持仓市值,追加快照到 portfolio_history.json(主站真实曲线)
    # -----------------------------------------------------------
    try:
        import os
        if os.path.exists("trades_record.json"):
            with open("trades_record.json", encoding="utf-8") as f:
                trades = json.load(f)
            if trades:
                cash = 10000.0
                pos = {}  # code -> {"qty": int, "cost": float}
                realized = {}
                for t in sorted(trades, key=lambda x: x.get("ts", "")):
                    code, qty, price = t["code"], float(t["qty"]), float(t["price"])
                    if t["side"] == "buy":
                        cash -= qty * price
                        p = pos.setdefault(code, {"qty": 0, "cost": 0.0})
                        p["qty"] += qty
                        p["cost"] += qty * price
                    else:
                        if code in pos:
                            p = pos[code]
                            avg = p["cost"] / p["qty"] if p["qty"] else 0
                            cash += qty * price
                            realized[code] = realized.get(code, 0) + (price - avg) * qty
                            p["qty"] -= qty
                            p["cost"] -= avg * qty
                            if p["qty"] <= 0:
                                del pos[code]
                # 持仓市值(按本次抓取的最新价)
                prices = {r["code"]: r["quote"]["price"] for r in results if r.get("quote", {}).get("price")}
                mv = 0.0
                positions = []
                for code, p in pos.items():
                    if p["qty"] <= 0:
                        continue
                    price = prices.get(code, p["cost"] / p["qty"] if p["qty"] else 0)
                    val = price * p["qty"]
                    mv += val
                    name = next((r["name"] for r in results if r["code"] == code), code)
                    positions.append({"code": code, "name": name, "qty": int(p["qty"]), "price": round(price, 2)})
                total = cash + mv
                snapshot = {
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "total": round(total, 2),
                    "cash": round(cash, 2),
                    "totalReturn": round((total / 10000 - 1) * 100, 2),
                    "realizedProfit": round(sum(realized.values()), 2),
                    "positions": positions,
                    "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
                hist = {"series": []}
                if os.path.exists("portfolio_history.json"):
                    try:
                        with open("portfolio_history.json", encoding="utf-8") as f:
                            hist = json.load(f)
                    except Exception:
                        hist = {"series": []}
                # 同一天重复运行则覆盖当天快照
                hist["series"] = [s for s in hist.get("series", []) if s.get("date") != snapshot["date"]]
                hist["series"].append(snapshot)
                hist["series"].sort(key=lambda s: s["date"])
                with open("portfolio_history.json", "w", encoding="utf-8") as f:
                    json.dump(hist, f, ensure_ascii=False, indent=2)
                with open("portfolio_history.js", "w", encoding="utf-8") as f:
                    f.write("window.PORTFOLIO = " + json.dumps(hist, ensure_ascii=False) + ";\n")
                print("\n已读取真实成交 {n} 笔,更新净值快照:总资产 ¥{t:,.2f} (收益 {r}%)".format(
                    n=len(trades), t=total, r=snapshot["totalReturn"]))
    except Exception as e:
        print("\n净值快照计算失败(不影响行情数据):", e)

    print("\n" + "=" * 60)
    print("完成: 成功 {ok} / 共 {total} 只,已写入 {out}".format(
        ok=len(ranked), total=len(POOL), out=OUT_FILE))
    print("排名前 5(今日观察池):")
    for r in ranked[:5]:
        print("   {rank}. {name}  综合 {total}  [{grade} {action}]".format(
            rank=r["rank"], name=r["name"], total=r["total"],
            grade=r["grade"], action=r["action"]))
    if errors:
        print("\n以下标的抓取失败(请检查代码/网络后重试):")
        for n, e in errors:
            print("   -", n, ":", e)
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
