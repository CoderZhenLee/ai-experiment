#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通过 PushPlus 推送消息到微信「服务通知」。
用法:
    python3 push_wechat.py "标题" "正文内容"
    python3 push_wechat.py "标题" "正文" --token <你的token>   # 或写入 ~/.workbuddy/pushplus_token.txt
Token 优先从 ~/.workbuddy/pushplus_token.txt 读取,避免明文出现在命令行/脚本仓库。

模板说明:
  - 默认 markdown 模板,内容中裸 URL 会被自动包成 [域名](URL) 链接
  - 这样微信会识别为非裸链接,显示为正常的「服务通知」,而不是「设备通知」
"""
import sys
import json
import os
import re
import urllib.request

TOKEN_FILE = os.path.expanduser("~/.workbuddy/pushplus_token.txt")
API = "https://www.pushplus.plus/send"
URL_RE = re.compile(r"(https?://[^\s\n]+)")


def auto_markdown_link(content):
    """把裸 URL 包成 markdown 链接 [域名](URL),避免微信把消息降级为「设备通知」。"""
    def replace(m):
        url = m.group(1).rstrip(".,;:!?)])")
        # 域名做链接文字(去掉 www.)
        host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
        return f"[{host}]({url})"
    return URL_RE.sub(replace, content)


def hardbreak_lines(content):
    """将内容中的单个换行转为 Markdown 硬换行(<br>)。

    PushPlus 使用 markdown 模板时,标准 Markdown 规则是「单个换行=空格」,
    导致多行内容被挤成一行。此函数保留段落间空行,仅把段内换行转为 <br>。
    """
    # 按段落分割(连续两个及以上换行 = 段落分隔)
    paragraphs = re.split(r'\n{2,}', content)
    # 段内单个换行 -> <br>
    converted = [re.sub(r'\n', '<br>', p) for p in paragraphs]
    return '\n\n'.join(converted)


def send(title, content, token=None):
    if not token:
        if not os.path.exists(TOKEN_FILE):
            print("ERROR: 未找到 token,请先把 PushPlus token 写入 " + TOKEN_FILE)
            sys.exit(1)
        token = open(TOKEN_FILE, encoding="utf-8").read().strip()
    # 使用 markdown 模板: 先转硬换行(防止单换行被吞),再自动链接化
    content_md = auto_markdown_link(hardbreak_lines(content))
    body = json.dumps({
        "token": token,
        "title": title,
        "content": content_md,
        "template": "markdown",
    }).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法:")
        print("  python3 push_wechat.py \"标题\" \"正文\" [--token xxx]")
        print("  echo \"正文\" | python3 push_wechat.py \"标题\" [--token xxx]   # 正文走 stdin,避免 shell 引号问题")
        sys.exit(1)
    title = sys.argv[1]
    if len(sys.argv) >= 3 and sys.argv[2] != "--token":
        content = sys.argv[2]
    elif len(sys.argv) == 2 and not sys.stdin.isatty():
        # 仅标题 + stdin 管道(echo/printf 方式),读正文
        content = sys.stdin.read().strip()
    else:
        print("用法:")
        print("  python3 push_wechat.py \"标题\" \"正文\" [--token xxx]")
        print("  echo \"正文\" | python3 push_wechat.py \"标题\" [--token xxx]   # 正文走 stdin,避免 shell 引号问题")
        sys.exit(1)
    token = None
    if "--token" in sys.argv:
        token = sys.argv[sys.argv.index("--token") + 1]
    result = send(title, content, token)
    print(result)
    if '"code":200' in result or '"code": 200' in result:
        print("✅ 推送成功:已发送到微信「服务通知」")
    else:
        print("⚠️ 推送响应异常,请检查 token 是否正确")
