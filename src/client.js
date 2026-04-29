const vscode = require("vscode");

let undiciLoadAttempted = false;
let undiciModule = null;

function loadUndici() {
  if (undiciLoadAttempted) {
    return undiciModule;
  }
  undiciLoadAttempted = true;
  try {
    undiciModule = require("node:undici");
  } catch (_error) {
    try {
      undiciModule = require("undici");
    } catch (_error2) {
      undiciModule = null;
    }
  }
  return undiciModule;
}

/** 固定站点（无证书时使用 HTTP，不在设置中暴露可改项） */
const PLUGIN_SITE_ORIGIN = "http://xmuoj.com";

class XmuojClient {
  constructor(context) {
    this.context = context;
    this.tokenKey = "xmuoj.token";
    this._pluginDispatcher = null;
    this._pluginDispatcherTlsMode = null;
  }

  get baseUrl() {
    return PLUGIN_SITE_ORIGIN;
  }

  get allowInsecureTls() {
    // 当使用 HTTP 时，不需要 TLS 配置
    if (/^http:/i.test(this.baseUrl)) {
      return false;
    }
    // 当使用 HTTPS 时，始终允许自签名证书
    return true;
  }

  async getToken() {
    return this.context.secrets.get(this.tokenKey);
  }

  async setToken(token) {
    if (!token) {
      await this.context.secrets.delete(this.tokenKey);
      return;
    }
    await this.context.secrets.store(this.tokenKey, token);
  }

  configureTlsBehavior() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = this.allowInsecureTls ? "0" : "1";
  }

  /**
   * Node 内置 fetch（undici）默认会协商 HTTP/2；部分 OJ 站点证书链或 H2 实现异常时会在首包后 RST，
   * 仅表现为 fetch failed / ECONNRESET。此处强制走 HTTP/1.1，并在允许时显式关闭证书校验。
   */
  getPluginDispatcher(undici) {
    const insecure = this.allowInsecureTls;
    if (this._pluginDispatcher && this._pluginDispatcherTlsMode === insecure) {
      return this._pluginDispatcher;
    }
    if (this._pluginDispatcher && typeof this._pluginDispatcher.close === "function") {
      void this._pluginDispatcher.close().catch(() => {});
    }
    const { Agent } = undici;
    this._pluginDispatcher = new Agent({
      allowH2: false,
      ...(insecure ? { connect: { rejectUnauthorized: false } } : {})
    });
    this._pluginDispatcherTlsMode = insecure;
    return this._pluginDispatcher;
  }

  async pluginFetch(url, options) {
    const maxAttempts = 4;
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.pluginFetchOnce(url, options);
      } catch (error) {
        lastError = error;
        const causeCode = error && error.cause && error.cause.code ? error.cause.code : "";
        const retriable = causeCode === "ECONNRESET" || /ECONNRESET/i.test(String(error && error.message ? error.message : error));
        if (!retriable || attempt === maxAttempts - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  pluginFetchOnce(url, options) {
    const undici = loadUndici();
    if (!undici) {
      this.configureTlsBehavior();
      return globalThis.fetch(url, options);
    }
    this.configureTlsBehavior();
    const dispatcher = this.getPluginDispatcher(undici);
    return undici.fetch(url, Object.assign({}, options, { dispatcher }));
  }

  buildFetchErrorMessage(error) {
    const rawMessage = String(error && error.message ? error.message : error);
    const causeCode = error && error.cause && error.cause.code ? error.cause.code : "";
    const message = `${causeCode} ${rawMessage}`.trim();
    const usingHttps = /^https:\/\//i.test(this.baseUrl);
    
    // 处理自签名证书（仅在使用 HTTPS 时可能出现）
    if (/DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|self-signed/i.test(message)) {
      return "连接失败：HTTPS 证书无法通过校验。官方插件固定使用 HTTP 访问 xmuoj.com；若你自行改为 HTTPS，请联系管理员更换为受信任证书。";
    }

    if (/CERT_HAS_EXPIRED|certificate has expired/i.test(message)) {
      return `连接失败：${this.baseUrl} 的 HTTPS 证书已过期。官方插件固定使用 HTTP 访问 xmuoj.com。`;
    }

    if (/fetch failed/i.test(message)) {
      if (/ECONNRESET/i.test(message)) {
        return `连接失败：无法访问 ${this.baseUrl}（连接被服务端重置）。请检查网络或联系站点管理员。`;
      }
      if (/ECONNREFUSED/i.test(message)) {
        return `连接失败：无法连接到 ${this.baseUrl}（连接被拒绝）。请检查网络连接和服务端状态。`;
      }
      if (/ENOTFOUND/i.test(message)) {
        return `连接失败：无法找到 ${this.baseUrl}（域名解析失败）。请检查网络连接和DNS设置。`;
      }
      if (usingHttps) {
        return `连接失败：无法访问 ${this.baseUrl}。请检查网络、HTTPS 证书或服务端配置。`;
      }
      return `连接失败：无法访问 ${this.baseUrl}。请检查本机网络、代理以及 xmuoj.com 服务是否可达。`;
    }
    
    return rawMessage;
  }

  parseResponseBody(text, contentType) {
    if ((contentType || "").includes("application/json")) {
      return JSON.parse(text || "{}");
    }
    return null;
  }

  buildHttpErrorMessage(response, payload, fallbackText) {
    if (payload && payload.data) {
      return payload.data;
    }
    if (response.status === 404) {
      return `请求地址 ${response.url} 返回 404。当前站点上没有部署 XMUOJ 插件 API，请确认服务端已部署 /api/plugin/ 接口。`;
    }
    if (response.status === 401 || response.status === 403) {
      return "访问被拒绝：请确认登录状态、比赛权限或比赛密码是否正确。";
    }
    return fallbackText || `请求失败，状态码 ${response.status}`;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = Object.assign({
      "Content-Type": "application/json",
      Connection: "close",
      "User-Agent": "Mozilla/5.0 (compatible; XMUOJ-VSCode-Plugin)"
    }, options.headers || {});
    const token = await this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await this.pluginFetch(url, Object.assign({}, options, { headers }));
    } catch (error) {
      throw new Error(this.buildFetchErrorMessage(error));
    }
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let data = null;
    try {
      data = this.parseResponseBody(text, contentType);
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      throw new Error(this.buildHttpErrorMessage(response, data, `请求失败，状态码 ${response.status}`));
    }
    if (!data) {
      throw new Error(`请求地址 ${response.url} 返回了非 JSON 响应。请确认当前站点已经部署 XMUOJ 插件 API。`);
    }
    if (data.error) {
      throw new Error(data.data || data.error);
    }
    return data.data;
  }

  async requestBinary(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = Object.assign({
      Connection: "close",
      "User-Agent": "Mozilla/5.0 (compatible; XMUOJ-VSCode-Plugin)"
    }, options.headers || {});
    const token = await this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await this.pluginFetch(url, Object.assign({}, options, { headers }));
    } catch (error) {
      throw new Error(this.buildFetchErrorMessage(error));
    }
    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        throw new Error(this.buildHttpErrorMessage(response, data, `请求失败，状态码 ${response.status}`));
      }
      const text = await response.text();
      throw new Error(this.buildHttpErrorMessage(response, null, text || `请求失败，状态码 ${response.status}`));
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const disposition = response.headers.get("content-disposition") || "";
    const fileNameMatch = disposition.match(/filename=([^;]+)/i);
    return {
      buffer,
      fileName: fileNameMatch ? fileNameMatch[1].replace(/"/g, "") : null
    };
  }

  async login(username, password, tfaCode) {
    const payload = { username, password };
    if (tfaCode) {
      payload.tfa_code = tfaCode;
    }
    const data = await this.request("/api/plugin/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await this.setToken(data.token);
    return data;
  }

  async logout() {
    try {
      await this.request("/api/plugin/logout", {
        method: "POST",
        body: JSON.stringify({})
      });
    } finally {
      await this.setToken("");
    }
  }

  getBootstrap() {
    return this.request("/api/plugin/bootstrap");
  }

  getContests(params = {}) {
    const query = new URLSearchParams();
    Object.entries(Object.assign({ limit: 100, offset: 0 }, params)).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    });
    return this.request(`/api/plugin/contests?${query.toString()}`);
  }

  getProblemset(params = {}) {
    const query = new URLSearchParams();
    Object.entries(Object.assign({ limit: 100, offset: 0 }, params)).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    });
    return this.request(`/api/plugin/problemset?${query.toString()}`);
  }

  getContestWorkspace(contestId, contestPassword) {
    const params = new URLSearchParams({ contest_id: String(contestId) });
    if (contestPassword) {
      params.set("contest_password", contestPassword);
    }
    return this.request(`/api/plugin/contest_workspace?${params.toString()}`);
  }

  getProblemWorkspace(problemId, contestId, contestPassword) {
    const params = new URLSearchParams({ problem_id: String(problemId) });
    if (contestId) {
      params.set("contest_id", String(contestId));
    }
    if (contestPassword) {
      params.set("contest_password", contestPassword);
    }
    return this.request(`/api/plugin/problem_workspace?${params.toString()}`);
  }

  submitSolution(payload) {
    return this.request("/api/plugin/submission", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getSubmission(submissionId) {
    return this.request(`/api/plugin/submission?submission_id=${encodeURIComponent(submissionId)}`);
  }

  downloadTestCases(problemId, contestPassword) {
    const query = new URLSearchParams({ problem_id: String(problemId) });
    if (contestPassword) {
      query.set("contest_password", contestPassword);
    }
    return this.requestBinary(`/api/plugin/test_case_download?${query.toString()}`);
  }
}

module.exports = {
  XmuojClient,
  PLUGIN_SITE_ORIGIN
};
