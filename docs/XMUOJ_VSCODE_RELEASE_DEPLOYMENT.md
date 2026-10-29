# XMUOJ VS Code 插件发布页面部署交接

## 目标

在 XMUOJ 官网部署以下内容：

- 顶部导航：在「关于」下拉框中新增第一项“下载 VS Code 插件”
- 点击后进入插件介绍/下载页：`https://xmuoj.com/vscode`
- 页面内“下载 VSIX”按钮下载：`https://xmuoj.com/downloads/xmuoj-vscode-0.1.6.vsix`
- 主导航不再单独增加“VS Code 插件”入口

当前线上仍是旧版前端；本地页面和 VSIX 均尚未上传到服务器。

## 本次交付物

### 源码修改

以下文件位于本机的 `OnlineJudgeFE` 仓库：

- `src/pages/oj/components/NavBar.vue`：主导航移除独立的“VS Code 插件”入口，改为「关于」下拉第一项“下载 VS Code 插件”，点击进入 `/vscode` 页面
- `src/pages/oj/views/general/VSCodeExtension.vue`：插件介绍与下载页（进入时回到页面顶部）
- `src/pages/oj/router/routes.js`
- `src/pages/oj/views/index.js`

### VSIX

本机文件：

- `/Users/andyshengruilee/Downloads/OpenJudgeFE/xmuoj-vscode/xmuoj-vscode-0.1.6.vsix`
- 大小：约 288 KB
- SHA256：`ff2b25a675e56dfbac5c3715bd538f38512be63d622fd87fe53b7c0c6c7b92d5`

### 前端构建产物

本机目录：

- `/Users/andyshengruilee/Downloads/OpenJudgeFE/OnlineJudgeFE/dist`

其中需要部署的是整个 `dist` 内容，包括：

- `dist/index.html`
- `dist/static/**`

本次构建生成了包含新 `/vscode` 路由的懒加载 JS chunk：

- `dist/static/js/8.8d39dfc0c422976018df.js`
- 对应入口：`dist/static/js/oj.0e07029072e85e1c56cc.js`

> 服务器不能只复制新 HTML 或单独复制 chunk；必须使用整套构建产物，否则 hash 文件、manifest 和懒加载页面会失效。

## 部署前检查

1. 保留现有站点的备份：
   - 前端根目录或 Nginx 发布目录
   - 当前前端容器镜像
   - `/downloads` 目录
2. 确认网站现有 `Nginx` 会把未知前端路由回退到 `index.html`，即支持 HTML5 History fallback：
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```
3. `/api/`、`/static/`、`/public/`、`/admin/` 等原有路由不得被 `/` 规则错误代理或覆盖。

## 方法一：服务器直接构建后部署

适合服务器可以访问前端源码仓库的场景。

```bash
cd <OnlineJudgeFE仓库目录>
git pull

# Vue 2 / Webpack 3 在新版 Node/OpenSSL 下需要兼容参数
export NODE_OPTIONS=--openssl-legacy-provider
npm install
npm run build
```

构建成功后部署生成的 `dist` 目录。

## 方法二：本地构建后上传部署

适合服务器不适合直接构建的场景。

1. 上传 `/Users/andyshengruilee/Downloads/OpenJudgeFE/OnlineJudgeFE/dist` 的全部内容到服务器前端发布目录。
2. 保持目录结构不变：
   - 发布目录 `/index.html`
   - 发布目录 `/static/js/...`
   - 发布目录 `/static/css/...`
3. 上传 VSIX：
   ```text
   <发布站点根目录>/downloads/xmuoj-vscode-0.1.6.vsix
   ```

不要只上传 VSIX。页面使用的路由和导航来自前端构建产物，必须同时部署 `dist`。

## Docker/Nginx 典型部署

先确认服务容器及挂载：

```bash
docker ps
docker inspect <前端容器或Nginx容器>
docker-compose config
```

服务器 AI 应根据实际 Docker/Nginx 配置执行以下逻辑：

1. 找出线上网站实际读取的前端目录或挂载卷。
2. 将本次 `dist` 的完整内容复制到该目录。
3. 将 VSIX 复制到该前端根目录下的 `downloads/`目录。
4. 确保 VSIX 的 HTTP MIME 类型为附件或二进制：
   ```nginx
   location /downloads/ {
       try_files $uri =404;
       default_type application/octet-stream;
   }
   ```
5. 如 Nginx 或 CDN 使用缓存，重新加载配置并清理旧 HTML/静态资源缓存。
6. 可重启前端或重新加载 Nginx，不要重建数据库或判题容器。

## 部署后验证

### 页面与下载地址

```bash
curl -I https://xmuoj.com/vscode
curl -I https://xmuoj.com/downloads/xmuoj-vscode-0.1.6.vsix
```

期望：

- `/vscode` 返回 `200`，由 SPA 正常渲染介绍页
- VSIX 返回 `200`，`Content-Type` 为 `application/octet-stream`（或附件类型），不能是 `text/html`
- VSIX 的 `Content-Length` 与本地文件一致（294813 字节）

```bash
curl -L -o /tmp/xmuoj-vscode-0.1.6.vsix \
  https://xmuoj.com/downloads/xmuoj-vscode-0.1.6.vsix
shasum -a 256 /tmp/xmuoj-vscode-0.1.6.vsix
```

线上 SHA256 应为：

```text
ff2b25a675e56dfbac5c3715bd538f38512be63d622fd87fe53b7c0c6c7b92d5
```

### 浏览器验证

打开 `https://xmuoj.com/`，检查：

- 顶部主导航**不再**单独显示“VS Code 插件”
- 「关于」下拉框的第一项是“下载 VS Code 插件”
- 点击该项进入 `https://xmuoj.com/vscode`，页面从顶部开始显示
- 页面中的“下载 VSIX”按钮可下载 `xmuoj-vscode-0.1.6.vsix`
- 原有题目、比赛、课程、登录和提交页面未受影响

## 回滚

如果部署异常：

1. 立即恢复原来的 `dist`/前端发布目录。
2. 删除或保留本次新增的 VSIX；不要影响原有 `/static/` 资源。
3. 重新加载 Nginx/CDN。
4. 再次访问 `/` 和 `/problem`、`/contest` 等核心路由确认回滚成功。

## 注意事项

- 下载地址已写死为 `/downloads/xmuoj-vscode-0.1.6.vsix`。
- 如果服务器未来切换版本，只需更新页面中的版本号和下载文件名，并重新构建前端。
- 当前推荐交付版本为 `0.1.6`，不是 Marketplace/GitHub 发布，插件由 XMUOJ 官网直接分发。
