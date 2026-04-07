# Cloud Frontend Canary

这套文件用于把新版前端单独部署到云端新端口，不影响现有 `xmuoj.com` 上运行的旧版。

## 目标

- 旧版继续由现有 `oj-backend` 提供，对外域名仍是 `xmuoj.com`
- 新版前端由一个新的 `nginx` 容器单独提供，对外使用新端口 `8081`
- `/api` 和 `/public` 仍然反代到现有 `oj-backend:8000`
- 回滚方式是一条命令：停止并删除 `oj-frontend-canary`

## 云端前提

- 已确认远端存在 Docker 网络 `onlinejudgedeploy_default`
- 已确认旧版运行容器名是 `oj-backend`
- 已确认旧版域名 `xmuoj.com` 不做修改

## 本地准备

本地先准备一份可上传的前端静态目录，推荐使用已经验证过的预处理方式：

```bash
rm -rf frontend-compare/cloud-canary/dist
mkdir -p frontend-compare/cloud-canary/dist
cp -R OnlineJudgeFE/dist/. frontend-compare/cloud-canary/dist/
find frontend-compare/cloud-canary/dist -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) -exec perl -0pi -e 's#/__STATIC_CDN_HOST__/#/#g' {} +
```

## 上传到云端

把整个 `cloud-canary` 目录上传到云端，例如：

```bash
scp -r frontend-compare/cloud-canary ubuntu@<server-ip>:/home/ubuntu/
```

## 上线新端口版本

在云端执行：

```bash
cd /home/ubuntu/cloud-canary
echo '<your-sudo-password>' | sudo -S docker compose up -d
```

## 验证

先在云端本机验证：

```bash
curl -I http://127.0.0.1:8081/
curl -s http://127.0.0.1:8081/api/profile/
```

如果服务器安全组或防火墙允许，再从外部访问：

```text
http://<server-ip>:8081/
```

## 一键回滚

如果新版有问题，云端执行：

```bash
cd /home/ubuntu/cloud-canary
echo '<your-sudo-password>' | sudo -S docker compose down
```

这不会影响现有 `xmuoj.com`，因为旧版仍由 `oj-backend` 对外提供。

如果已经执行过正式切换，希望恢复到“正式入口=旧前端，8081=新前端”的切换前状态，执行：

```bash
cd /home/ubuntu/cloud-canary
chmod +x rollback_switch.sh
SUDO_PASSWORD='<your-sudo-password>' ./rollback_switch.sh
```

这个脚本依赖切换时保留的以下目录：

```text
/home/ubuntu/frontend-switch/old-dist
/home/ubuntu/frontend-switch/new-dist
```

执行完成后，脚本会自动：

```text
1. 把旧前端恢复到 oj-backend:/app/dist
2. 重启 oj-backend
3. 把新前端重新放回 8081 对应的 canary 容器
```

## 过渡期结束后的切换建议

推荐两种方式，优先级按稳妥程度排序：

1. 继续保留 canary 容器，把现有域名入口从旧容器切到 `oj-frontend-canary:80`
2. 把验证通过的新 `dist` 覆盖进 `oj-backend:/app/dist`，然后重启 `oj-backend`

如果目标是“只更新前端、最少改动线上结构”，第二种更贴近你现有架构；如果目标是“保留一段时间双版本并可秒切换”，第一种更适合。
