#!/usr/bin/env bash

######feature-dirtydamn start######
### 设置环境变量
# 持久化整个容器-home，在容器内安装了 Playwright 浏览器，该变量可以避免每次启动容器都重新下载几百 MB 的浏览器内核
export OPENCLAW_HOME_VOLUME="openclaw_home"
# 指定浏览器安装路径并确保其在持久化范围内
export PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
# 安装额外的apt包，jq后面为browser需要的依赖，fonts-wqy-zenhei为中文字体(截图时中文不会乱码)
export OPENCLAW_DOCKER_APT_PACKAGES="curl less vim lsof wget net-tools netcat-openbsd telnet git jq fonts-wqy-zenhei libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxcb1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libxfixes3 "
# 工作目录
export OPENCLAW_CONFIG_DIR=/home/ops/.openclaw
export OPENCLAW_WORKSPACE_DIR=/home/ops/.openclaw/workspace
# 指定时区
export OPENCLAW_TZ=Asia/Shanghai
# lan 会使网关监听容器内的所有网络接口（相当于 0.0.0.0）
export OPENCLAW_GATEWAY_BIND=lan
# 启用沙箱，需要将docker.sock映射给openclaw容器，宿主机运行stat -c '%g' /var/run/docker.sock
# export DOCKER_GID=990
export DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
# docker操作工具，这会安装/usr/bin/docker 
export OPENCLAW_INSTALL_DOCKER_CLI=1
# export OPENCLAW_SANDBOX=1
# 额外挂载路径
export OPENCLAW_EXTRA_MOUNTS=
export OPENCLAW_IMAGE=v2026.5.3
######feature-dirtydamn end######

docker compose -f docker-compose.yml -f docker-compose.extra.yml up -d openclaw-gateway