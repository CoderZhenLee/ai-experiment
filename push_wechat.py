#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通过 PushPlus 推送消息到微信「服务通知」。
用法:
    python3 push_wechat.py "标题" "正文内容"
    python3 push_wechat.py "标题" "正文" --token <你的token>   # 或写入 ~/.workbuddy/pushplus_token.txt
Token 优先从 ~/.workbuddy/pushplus_token.txt 读取,避免明文出现在命令行/脚本仓库。
"""
import sys
import json
import os
import urllib.request

TOKEN_FILE = os.path.expanduser("~/.workbuddy/pushplus_token.txt")
API = "https://www.pushplus.plus/send"


def send(title, content, token=None):
    if not token:
        if not os.path.exists(TOKEN_FILE):
            print("ERROR: 未找到 token,请先把 PushPlus token 写入 " + TOKEN_FILE)
            sys.exit(1)
        token = open(TOKEN_FILE, encoding="utf-8").read().strip()
    body = json.dumps({"token": token, "title": title, "content": content}).encode("utf-8")
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
