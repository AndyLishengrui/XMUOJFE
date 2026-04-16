const vscode = require("vscode");

class XmuojClient {
  constructor(context) {
    this.context = context;
    this.tokenKey = "xmuoj.token";
  }

  get baseUrl() {
    const config = vscode.workspace.getConfiguration("xmuoj");
    return (config.get("baseUrl") || "http://www.xmuoj.com").replace(/\/$/, "");
  }

  get allowInsecureTls() {
    const config = vscode.workspace.getConfiguration("xmuoj");
    return Boolean(config.get("allowInsecureTls") || false);
  }

  async setBaseUrl(url) {
    await vscode.workspace.getConfiguration("xmuoj").update("baseUrl", url.replace(/\/$/, ""), vscode.ConfigurationTarget.Global);
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

  buildFetchErrorMessage(error) {
    const rawMessage = String(error && error.message ? error.message : error);
    const causeCode = error && error.cause && error.cause.code ? error.cause.code : "";
    const message = `${causeCode} ${rawMessage}`.trim();
    if (/DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|self-signed/i.test(message)) {
      return "连接失败：当前 XMUOJ 站点使用了自签名证书。请在设置中开启 xmuoj.allowInsecureTls，或改用受信任证书的站点地址。";
    }
    if (/fetch failed/i.test(message)) {
      return `连接失败：无法访问 ${this.baseUrl}。请检查站点地址、网络连通性以及 HTTPS 证书。`;
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
      return `请求地址 ${response.url} 返回 404。当前站点上没有部署 XMUOJ 插件 API，请确认 baseUrl 是否指向已部署 /api/plugin/ 的后端。`;
    }
    if (response.status === 401 || response.status === 403) {
      return "访问被拒绝：请确认登录状态、比赛权限或比赛密码是否正确。";
    }
    return fallbackText || `请求失败，状态码 ${response.status}`;
  }

  async request(path, options = {}) {
    this.configureTlsBehavior();
    const url = `${this.baseUrl}${path}`;
    const headers = Object.assign({
      "Content-Type": "application/json"
    }, options.headers || {});
    const token = await this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await fetch(url, Object.assign({}, options, { headers }));
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
    this.configureTlsBehavior();
    const url = `${this.baseUrl}${path}`;
    const headers = Object.assign({}, options.headers || {});
    const token = await this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await fetch(url, Object.assign({}, options, { headers }));
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
  XmuojClient
};
