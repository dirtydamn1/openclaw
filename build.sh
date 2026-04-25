#!/usr/bin/env bash

# 从源码安装
pnpm install && pnpm ui:build && pnpm build
pnpm link --global
# 运行向导，并安装系统自启服务
# openclaw onboard --install-daemon
openclaw onboard

# openclaw gateway stop
# openclaw gateway --port 19789
# openclaw gateway status