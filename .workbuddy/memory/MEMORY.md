# 项目长期笔记(ai-experiment)

## 投资实验网站
- 180 天 A 股实验,初始资金 ¥10,000,公开站点 https://coderzhenlee.github.io/ai-experiment/
- 真实数据更新:python3 update_data.py(输出"完成: 成功 10 / 共 10 只"为准),排名在 real_data.json 的 `scores` 数组(已按 rank 排序,字段 total/grade/action)
- 自动化 automation-1785918218488:每天 15:35 更新数据 + git push + 报告;已开启微信推送(push_to_wechat=true),报告含今日 3 词白话解释
- ⚠️ --quick 模式不抓财务/K线,会清空 real_data.json 的 tech/finance/research,测试后必须重跑完整模式再部署

## 指数 / ETF 专区(2026-08-11 新增)
- 页面 etf.html + etf.js,入口在 index.html 导航「ETF专区」;数据在 real_data.json 的 `etf` 字段(indices 5 宽基 + industry 6 行业ETF)
- ⚠️ 关键坑:东财 push2 对 ETF 价格字段与股票差 10 倍(军工ETF 显示 11.55 实为 1.155),指数/ETF 一律走腾讯源 fetch_quote_tencent
- 宽基:上证50 1.000016 / 沪深300 1.000300 / 中证500 1.000905 / 创业板指 0.399006 / 科创50 1.000688;行业ETF:军工512660 / 医药512010 / 半导体512480 / 白酒512690 / 新能源516160 / 证券512880
- 用户需求背景:零基础用户想了解"板块/ETF 打包买"这种不用选公司的投资方式

## 每日知识卡(2026-08-11 新增)
- glossary.js 末尾 window.KNOWLEDGE_CARDS(20 条 ETF/板块主题,小白友好),推送按「开课第 N 天,索引=(N-1)%20」轮取
- 14:00 快报 4 部分(时间/前3/情绪/知识卡)、15:35 日报 6 部分(含 ETF 速览+知识卡)已更新 prompt

## 投资学堂
- glossary.js:GLOSSARY_START=2026-08-07,每天 3 词;第 N 课 = 开课日起第 N 天,词汇索引 (N-1)*3 起
- 用户偏好:零基础,需要大白话+真实例子,抵触术语堆砌

## 通知/微信
- 【重要】微信推送最终方案 = **PushPlus 服务通知**(2026-08-11 验证通过):
  - token 存于 ~/.workbuddy/pushplus_token.txt(权限600),不在 git 内
  - 推送脚本 /Users/lizhen/ai-experiment/push_wechat.py:`echo "正文" | python3 push_wechat.py "标题"`(支持 stdin/argv)
  - 接收要求:微信关注「pushplus 推送加」公众号 + 消息开关开启;实名已付费 ¥3.9 一次性
  - 勿再用 WorkBuddy 内置 push_to_wechat:工具不持久化该字段,小程序端用户不可见
- 推送节奏(3 个自动化,prompt 内置 PushPlus 推送,均指向 /Users/lizhen/ai-experiment):
  - 09:30 每日投资学堂提醒(automation-1786416869287,每天,今日 3 词白话+例子)
  - 14:00 盘中快报(automation-1786416869322,工作日)
  - 15:35 每日更新+部署+收盘日报(automation-1785918218488,每天)
  - (曾建 09:35/11:35 盘中快报,用户 2026-08-11 要求精简为上述 3 点,已删除)
