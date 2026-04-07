# OpenJudge Backup

这是当前可运行 OpenJudge 栈的一份干净代码备份，保留了已经验证通过的本机部署改动、云端前端切换结果，以及对应的回滚脚本。

## 仓库内容

包含以下目录：

- `OnlineJudgeDeploy`: Docker Compose 部署层
- `OnlineJudge`: 后端 Django 服务
- `OnlineJudgeFE`: 前端工程
- `JudgeServer`: 判题服务
- `frontend-compare/cloud-canary`: 云端前端切换与回滚脚本

刻意排除以下内容：

- SQL 导出文件
- testcase 压缩包与运行时数据
- `node_modules`、`dist`、`build` 等产物
- 临时文件、缓存文件、本机开发垃圾文件

## 目录关系

当前这套代码的主要关系如下：

1. `OnlineJudgeDeploy/docker-compose.yml` 负责启动 `oj-backend`、`oj-postgres`、`oj-judge`、`oj-redis`。
2. `OnlineJudge` 提供后端 API、静态资源服务入口和判题业务逻辑。
3. `OnlineJudgeFE` 是前端源码，构建产物最终会进入后端容器的 `/app/dist`。
4. `JudgeServer` 是独立判题服务，对应 Compose 里的 `oj-judge`。
5. `frontend-compare/cloud-canary` 是云端前端灰度/切换工具，不依赖数据库迁移。

## 当前验证状态

这份备份对应的状态是：

1. 本机 Apple Silicon 环境已适配，`OnlineJudgeDeploy/docker-compose.yml` 中的 `oj-judge` 使用 `onlinejudge/judge_server:arm64-local`。
2. 后端启动脚本和健康检查已按当前环境做过兼容修正。
3. 前端已完成云端切换验证。
4. 云端真实提交已验证通过，C、C++、Java、Python2、Python3 都能正常判题。

## 云端当前状态

当前云端已经完成前端切换，状态如下：

1. `xmuoj.com` 现在是新前端。
2. `http://122.51.69.77:8081/` 现在保留旧前端，作为回退入口。
3. 两个前端都继续复用同一个现有后端和数据库。
4. 正式切换方式不是改数据库或后端逻辑，而是替换 `oj-backend:/app/dist` 与 8081 的静态文件来源。

## 关键脚本

云端前端切换与回滚的关键文件在 `frontend-compare/cloud-canary`：

1. `docker-compose.yml`: 8081 前端容器定义
2. `nginx.canary.conf`: `/api` 与 `/public` 反代到 `oj-backend:8000`
3. `rollback_switch.sh`: 把正式入口恢复为旧前端、把新前端恢复到 8081

如果云端需要回滚到切换前状态：

```bash
cd /home/ubuntu/cloud-canary
SUDO_PASSWORD='<your-sudo-password>' ./rollback_switch.sh
```

## 本机部署提示

如果要基于这份备份在本机继续恢复或维护，优先关注：

1. `OnlineJudgeDeploy/docker-compose.yml`
2. `OnlineJudge/deploy/entrypoint.sh`
3. `OnlineJudge/deploy/health_check.py`
4. `OnlineJudgeFE/redeploy_local.sh`

前端仍是旧技术栈，构建时通常需要：

```bash
NODE_OPTIONS=--openssl-legacy-provider
```

## 推送到 GitHub

如果当前机器已经完成 GitHub CLI 登录，可自动创建并推送仓库：

```bash
./create_repo_and_push.sh AndyLishengrui xmuojFE
```

如果远端仓库已存在，则直接推送：

```bash
./push_to_github.sh https://github.com/AndyLishengrui/XMUOJFE.git
```
