const vscode = require("vscode");
const { spawn } = require("child_process");
const fs = require("fs");

const AI_API_KEY_SECRET_KEY = "xmuoj.ai.apiKey";

function getAiConfig() {
  return {
    enabled: true,
    provider: "auto",
    vendor: "",
    model: "",
    baseUrl: "",
    apiPath: "/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    command: "",
    commandArgs: [],
    requestTimeoutMs: 60000,
    temperature: 0.2,
    maxTokens: 0,
    pickModelOnFirstUse: true
  };
}

function detectAiCapabilities() {
  return {
    hasVsCodeLm: Boolean(vscode.lm && typeof vscode.lm.selectChatModels === "function"),
    hasSecretStorage: true,
    hasFetch: typeof fetch === "function"
  };
}

function detectTraeCliCommand() {
  const candidates = [
    process.env.TRAE_CLI_PATH,
    `${process.env.HOME || ""}/.local/share/trae-cli/trae-cli`,
    "/Applications/Trae CN.app/Contents/Resources/app/bin/trae-cn",
    "/Applications/TRAE SOLO CN.app/Contents/Resources/app/bin/trae-solo-cn"
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (error) {
      return false;
    }
  }) || "";
}

async function getStoredApiKey(context) {
  return context.secrets.get(AI_API_KEY_SECRET_KEY);
}

async function setStoredApiKey(context, apiKey) {
  if (!apiKey) {
    await context.secrets.delete(AI_API_KEY_SECRET_KEY);
    return;
  }
  await context.secrets.store(AI_API_KEY_SECRET_KEY, apiKey.trim());
}

function getModelIdentifier(model) {
  return String(model.id || model.name || model.family || model.vendor || "");
}

function modelMatches(model, target) {
  if (!target) {
    return true;
  }
  const lower = target.toLowerCase();
  return [model.id, model.name, model.family, model.vendor]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(lower));
}

async function listVsCodeLmModels(config = getAiConfig()) {
  if (!vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
    return [];
  }
  const query = config.vendor ? { vendor: config.vendor } : {};
  const models = await vscode.lm.selectChatModels(query);
  return config.model ? models.filter((model) => modelMatches(model, config.model)) : models;
}

class VscodeLmProvider {
  constructor(model) {
    this.model = model;
    this.kind = "vscode-lm";
    this.label = getModelIdentifier(model) || "VS Code Language Model";
  }

  async generateText(prompt) {
    const response = await this.model.sendRequest([
      vscode.LanguageModelChatMessage.User(prompt)
    ], {}, new vscode.CancellationTokenSource().token);
    let text = "";
    for await (const chunk of response.text) {
      text += chunk;
    }
    return text.trim();
  }
}

class OpenAiCompatibleProvider {
  constructor(options) {
    this.kind = "openai-compatible";
    this.label = options.model || "OpenAI Compatible";
    this.options = options;
  }

  async generateText(prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
    try {
      const response = await fetch(`${this.options.baseUrl}${this.options.apiPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: this.options.temperature,
          ...(this.options.maxTokens > 0 ? { max_tokens: this.options.maxTokens } : {}),
          messages: [
            { role: "user", content: prompt }
          ]
        }),
        signal: controller.signal
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = null;
      }
      if (!response.ok) {
        throw new Error(payload && payload.error && payload.error.message ? payload.error.message : `AI 请求失败，状态码 ${response.status}`);
      }
      const content = payload
        && payload.choices
        && payload.choices[0]
        && payload.choices[0].message
        && payload.choices[0].message.content;
      if (!content) {
        throw new Error("AI 返回内容为空，请检查模型或接口配置。");
      }
      return String(content).trim();
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`AI 请求超时，已超过 ${this.options.requestTimeoutMs}ms。`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

class CommandAiProvider {
  constructor(options) {
    this.kind = "command";
    this.options = options;
    const firstArg = Array.isArray(options.commandArgs) && options.commandArgs.length ? ` ${options.commandArgs.join(" ")}` : "";
    this.label = options.command ? `${options.command}${firstArg}` : "External Command";
  }

  async generateText(prompt) {
    return new Promise((resolve, reject) => {
      const args = (this.options.commandArgs || []).map((value) => String(value).replace(/\{\{prompt\}\}/g, prompt));
      const hasPromptPlaceholder = args.some((value) => value.includes(prompt));
      const child = spawn(this.options.command, args, {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          child.kill("SIGTERM");
          reject(new Error(`外部 AI 命令执行超时，已超过 ${this.options.requestTimeoutMs}ms。`));
        }
      }, this.options.requestTimeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        finished = true;
        clearTimeout(timer);
        reject(new Error(`无法启动外部 AI 命令：${error.message}`));
      });
      child.on("close", (code) => {
        finished = true;
        clearTimeout(timer);
        const text = String(stdout || "").trim();
        const combinedOutput = String(`${stdout || ""}\n${stderr || ""}`).trim();
        if (code !== 0) {
          if (/panic: runtime error: invalid memory address or nil pointer dereference/i.test(combinedOutput)
            && /conf\.\(\*Model\)\.RealName|root\.go/i.test(combinedOutput)) {
            reject(new Error(
              "Trae CLI 已启动，但在读取默认模型配置时崩溃了。通常是 CLI 当前没有可用的默认模型，或登录态/本地配置没有正确同步到 CLI。请先在 Trae 中打开 AI 对话并明确选择一个可用模型，然后重试；如果仍失败，请升级或重新登录 Trae CLI。"
            ));
            return;
          }
          if (/keyring is not supported on this system/i.test(combinedOutput)) {
            reject(new Error(
              "Trae CLI 无法访问当前环境的系统钥匙串，所以没法正常读取登录态。请在 Trae 自带终端里重新登录/初始化 CLI，或改用 OpenAI Compatible 提供者。"
            ));
            return;
          }
          reject(new Error(String(stderr || text || `外部 AI 命令执行失败，退出码 ${code}`)));
          return;
        }
        if (!text) {
          reject(new Error("外部 AI 命令没有返回内容，请检查命令输出。"));
          return;
        }
        resolve(text);
      });

      if (!hasPromptPlaceholder) {
        child.stdin.write(prompt);
      }
      child.stdin.end();
    });
  }
}

async function resolveVsCodeLmProvider(config) {
  const models = await listVsCodeLmModels(config);
  if (!models.length) {
    return null;
  }
  return new VscodeLmProvider(models[0]);
}

async function resolveOpenAiCompatibleProvider(context, config) {
  const apiKey = await getStoredApiKey(context) || process.env[config.apiKeyEnv || "OPENAI_API_KEY"] || "";
  if (!config.baseUrl || !config.model || !apiKey) {
    return null;
  }
  return new OpenAiCompatibleProvider({
    baseUrl: config.baseUrl,
    apiPath: config.apiPath.startsWith("/") ? config.apiPath : `/${config.apiPath}`,
    apiKey,
    model: config.model,
    requestTimeoutMs: config.requestTimeoutMs,
    temperature: config.temperature,
    maxTokens: config.maxTokens
  });
}

function resolveCommandProvider(config) {
  const detectedCommand = config.command || detectTraeCliCommand();
  if (!detectedCommand) {
    return null;
  }
  return new CommandAiProvider({
    command: detectedCommand,
    commandArgs: Array.isArray(config.commandArgs) && config.commandArgs.length
      ? config.commandArgs.map((item) => String(item))
      : ["-p", "{{prompt}}"],
    requestTimeoutMs: config.requestTimeoutMs
  });
}

function buildOpenAiCompatibleMissingMessage(context, config) {
  const missing = [];
  if (!config.baseUrl) {
    missing.push("xmuoj.ai.baseUrl");
  }
  if (!config.model) {
    missing.push("xmuoj.ai.model");
  }
  return getStoredApiKey(context).then((storedKey) => {
    const apiKey = storedKey || process.env[config.apiKeyEnv || "OPENAI_API_KEY"] || "";
    if (!apiKey) {
      missing.push("AI API Key");
    }
    return `OpenAI Compatible 提供者尚未配置完整。缺少：${missing.join("、")}。请先配置提供者，再填写接口地址、模型和 API Key。`;
  });
}

async function getAiProvider(context) {
  const config = getAiConfig();
  if (!config.enabled || config.provider === "disabled") {
    throw new Error("AI 功能已禁用。");
  }
  if ((config.provider === "auto" || config.provider === "vscode-lm") && detectAiCapabilities().hasVsCodeLm) {
    const provider = await resolveVsCodeLmProvider(config);
    if (provider) {
      return provider;
    }
    if (config.provider === "vscode-lm") {
      throw new Error("当前 IDE 没有可用的 VS Code 语言模型。请检查模型供应商、模型名，或改用 OpenAI Compatible 配置。");
    }
  }
  if (config.provider === "auto" || config.provider === "openai-compatible") {
    const provider = await resolveOpenAiCompatibleProvider(context, config);
    if (provider) {
      return provider;
    }
    if (config.provider === "openai-compatible") {
      throw new Error(await buildOpenAiCompatibleMissingMessage(context, config));
    }
  }
  if (config.provider === "auto" || config.provider === "command") {
    const provider = resolveCommandProvider(config);
    if (provider) {
      return provider;
    }
    if (config.provider === "command") {
      throw new Error("外部命令 AI 尚未配置完整。请先填写 xmuoj.ai.command；如需把提示词放进参数，请在 xmuoj.ai.commandArgs 中使用 {{prompt}} 占位符，否则插件会把提示词写入 stdin。");
    }
  }
  const capabilities = detectAiCapabilities();
  const appName = String((vscode.env && vscode.env.appName) || "当前 IDE");
  if (!capabilities.hasVsCodeLm) {
    throw new Error(`${appName} 当前不支持 vscode.lm 语言模型 API，自动模式下无法调用 IDE 内置模型。`);
  }
  throw new Error("自动模式下未找到可用的 AI 提供者（需要 IDE 暴露语言模型，或可用的 OpenAI 兼容网关 / 外部命令）。");
}

module.exports = {
  AI_API_KEY_SECRET_KEY,
  detectAiCapabilities,
  detectTraeCliCommand,
  getAiConfig,
  getAiProvider,
  getStoredApiKey,
  listVsCodeLmModels,
  setStoredApiKey
};
