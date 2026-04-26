import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import type {
  OpenClawPluginApi,
  ProviderAuthContext,
  ProviderAuthResult,
  ProviderCatalogContext,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  MINIMAX_OAUTH_MARKER,
  ensureAuthProfileStore,
  listProfilesForProvider,
} from "openclaw/plugin-sdk/provider-auth";
import { buildOauthProviderAuthResult } from "openclaw/plugin-sdk/provider-auth";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { buildProviderReplayFamilyHooks } from "openclaw/plugin-sdk/provider-model-shared";
import { MINIMAX_FAST_MODE_STREAM_HOOKS } from "openclaw/plugin-sdk/provider-stream-family";
import { fetchMinimaxUsage } from "openclaw/plugin-sdk/provider-usage";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { isMiniMaxModernModelId, MINIMAX_DEFAULT_MODEL_ID } from "./api.js";
import type { MiniMaxRegion } from "./oauth.js";
import { applyMinimaxApiConfig, applyMinimaxApiConfigCn } from "./onboard.js";
import { buildMinimaxPortalProvider, buildMinimaxProvider } from "./provider-catalog.js";

const API_PROVIDER_ID = "minimax";
const PORTAL_PROVIDER_ID = "minimax-portal";
const PROVIDER_LABEL = "MiniMax";
const DEFAULT_MODEL = MINIMAX_DEFAULT_MODEL_ID;
const DEFAULT_BASE_URL_CN = "https://api.minimaxi.com/anthropic";
const DEFAULT_BASE_URL_GLOBAL = "https://api.minimax.io/anthropic";
const MINIMAX_USAGE_ENV_VAR_KEYS = [
  "MINIMAX_OAUTH_TOKEN",
  "MINIMAX_CODE_PLAN_KEY",
  "MINIMAX_CODING_API_KEY",
  "MINIMAX_API_KEY",
] as const;
const MINIMAX_WIZARD_GROUP = {
  groupId: "minimax",
  groupLabel: "MiniMax",
  groupHint: "M2.7 (recommended)",
} as const;
const HYBRID_ANTHROPIC_OPENAI_REPLAY_HOOKS = buildProviderReplayFamilyHooks({
  family: "hybrid-anthropic-openai",
  anthropicModelDropThinkingBlocks: true,
});
const MINIMAX_PROVIDER_HOOKS = {
  ...HYBRID_ANTHROPIC_OPENAI_REPLAY_HOOKS,
  ...MINIMAX_FAST_MODE_STREAM_HOOKS,
  resolveReasoningOutputMode: () => "native" as const,
};

function getDefaultBaseUrl(region: MiniMaxRegion): string {
  return region === "cn" ? DEFAULT_BASE_URL_CN : DEFAULT_BASE_URL_GLOBAL;
}

function resolveMinimaxRegionLabel(region: MiniMaxRegion): string {
  return region === "cn" ? "CN" : "Global";
}

function resolveMinimaxEndpointHint(region: MiniMaxRegion): string {
  return region === "cn" ? "CN endpoint - api.minimaxi.com" : "Global endpoint - api.minimax.io";
}

function apiModelRef(modelId: string): string {
  return `${API_PROVIDER_ID}/${modelId}`;
}

function portalModelRef(modelId: string): string {
  return `${PORTAL_PROVIDER_ID}/${modelId}`;
}

function buildPortalProviderCatalog(params: { baseUrl: string; apiKey: string }) {
  return {
    ...buildMinimaxPortalProvider(),
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
  };
}

function resolveApiCatalog(ctx: ProviderCatalogContext) {
  const apiKey = ctx.resolveProviderApiKey(API_PROVIDER_ID).apiKey;
  if (!apiKey) {
    return null;
  }
  return {
    provider: {
      ...buildMinimaxProvider(ctx.env),
      apiKey,
    },
  };
}

function resolvePortalCatalog(ctx: ProviderCatalogContext) {
  const explicitProvider = ctx.config.models?.providers?.[PORTAL_PROVIDER_ID];
  const envApiKey = ctx.resolveProviderApiKey(PORTAL_PROVIDER_ID).apiKey;
  const authStore = ensureAuthProfileStore(ctx.agentDir, {
    allowKeychainPrompt: false,
  });
  const hasProfiles = listProfilesForProvider(authStore, PORTAL_PROVIDER_ID).length > 0;
  const explicitApiKey = normalizeOptionalString(explicitProvider?.apiKey);
  const apiKey = envApiKey ?? explicitApiKey ?? (hasProfiles ? MINIMAX_OAUTH_MARKER : undefined);
  if (!apiKey) {
    return null;
  }

  const explicitBaseUrl = normalizeOptionalString(explicitProvider?.baseUrl);

  return {
    provider: buildPortalProviderCatalog({
      baseUrl: explicitBaseUrl || buildMinimaxPortalProvider(ctx.env).baseUrl,
      apiKey,
    }),
  };
}

function createOAuthHandler(region: MiniMaxRegion) {
  const defaultBaseUrl = getDefaultBaseUrl(region);
  const regionLabel = resolveMinimaxRegionLabel(region);

  return async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
    const progress = ctx.prompter.progress(`Starting MiniMax OAuth (${regionLabel})…`);
    try {
      const { loginMiniMaxPortalOAuth } = await import("./oauth.runtime.js");
      const result = await loginMiniMaxPortalOAuth({
        openUrl: ctx.openUrl,
        note: ctx.prompter.note,
        progress,
        region,
      });

      progress.stop("MiniMax OAuth complete");

      if (result.notification_message) {
        await ctx.prompter.note(result.notification_message, "MiniMax OAuth");
      }

      const baseUrl = result.resourceUrl || defaultBaseUrl;

      return buildOauthProviderAuthResult({
        providerId: PORTAL_PROVIDER_ID,
        defaultModel: portalModelRef(DEFAULT_MODEL),
        access: result.access,
        refresh: result.refresh,
        expires: result.expires,
        configPatch: {
          models: {
            providers: {
              [PORTAL_PROVIDER_ID]: {
                baseUrl,
                api: "anthropic-messages",
                authHeader: true,
                models: [],
              },
            },
          },
          agents: {
            defaults: {
              models: {
                [portalModelRef("MiniMax-M2.7")]: { alias: "minimax-m2.7" },
                [portalModelRef("MiniMax-M2.7-highspeed")]: {
                  alias: "minimax-m2.7-highspeed",
                },
              },
            },
          },
        },
        notes: [
          "MiniMax OAuth tokens auto-refresh. Re-run login if refresh fails or access is revoked.",
          `Base URL defaults to ${defaultBaseUrl}. Override models.providers.${PORTAL_PROVIDER_ID}.baseUrl if needed.`,
          ...(result.notification_message ? [result.notification_message] : []),
        ],
      });
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      progress.stop(`MiniMax OAuth failed: ${errorMsg}`);
      await ctx.prompter.note(
        "If OAuth fails, verify your MiniMax account has portal access and try again.",
        "MiniMax OAuth",
      );
      throw err;
    }
  };
}

// 这段代码的核心作用是动态生成一个用于 MiniMax 提供者（Provider）的 API Key 身份验证方法配置。
// 定义一个工厂函数，根据传入的 MiniMax 区域（region，如 "global" 或 "cn"）创建对应的 API Key 身份验证方法
function createMinimaxApiKeyMethod(region: MiniMaxRegion) {
  // 解析给定区域的显示标签（例如，对于 "cn" 会返回 "CN"，对于 "global" 返回 "Global"）
  const regionLabel = resolveMinimaxRegionLabel(region);

  // 解析给定区域对应的 API 端点提示地址（例如 "api.minimaxi.com" 或 "api.minimax.io"）
  const endpointHint = resolveMinimaxEndpointHint(region);

  // 判断当前配置的是否为中国大陆（CN）节点，后续的多数判断都基于这个布尔值
  const isCn = region === "cn";

  // 调用 OpenClaw 插件 SDK 的工厂函数，创建并返回一个标准的 Provider API Key 验证方法对象
  return createProviderApiKeyAuthMethod({
    // 绑定所属的 Provider 规范标识符（这里对应我们在 openclaw.plugin.json 中声明的 "minimax"）
    providerId: API_PROVIDER_ID,
    // 为这个具体的验证方法指定内部唯一 ID，区分是国内版 API 还是全球版 API
    methodId: isCn ? "api-cn" : "api-global",

    // 在系统控制台或向导的选项列表中，显示给用户的选项名称
    label: `MiniMax API key (${regionLabel})`,

    // UI 面板或命令行列表中，选项下方显示的辅助提示文字（通常是对应的 API 域名）
    hint: endpointHint,

    // 内部选项的键名，用于在简易单标志身份验证流中识别该选项
    optionKey: "minimaxApiKey",

    // 为这个选项注册的命令行 (CLI) 参数标志。允许用户通过如 `openclaw onboard --minimax-api-key <key>` 直接传入
    flagName: "--minimax-api-key",

    // 声明此认证方式关联的系统环境变量名（MINIMAX_API_KEY），用于探测和自动加载凭证
    envVar: "MINIMAX_API_KEY",

    // 当需要在终端中提示用户手动输入密钥时，打印的引导说明及申请密钥的官网链接。根据中外版本提供不同域名的指引
    promptMessage: isCn
      ? "Enter MiniMax CN API key (sk-api- or sk-cp-)\nhttps://platform.minimaxi.com/user-center/basic-information/interface-key"
      : "Enter MiniMax API key (sk-api- or sk-cp-)\nhttps://platform.minimax.io/user-center/basic-information/interface-key",

    // 配置生成后的凭据将要保存的 Profile 唯一标识符（在 ~/.openclaw/agents/<agentId>/agent/auth-profiles.json 中使用），如下
    /**
     * {
     *   "version": 1,
     *   "profiles": {
     *     "minimax:cn": {
     *       "type": "api_key",
     *       "provider": "minimax",
     *       "key": "sk-cp-xxxxxxx"
     *     }
     *   }
     * }
     */
    profileId: isCn ? "minimax:cn" : "minimax:global",

    // 是否允许用户在向导中自定义这个凭证文件的 Profile 名字。这里设为 false，强制使用上面固定的 profileId
    allowProfile: false,

    // 当该验证方法配置成功后，向系统推荐将哪个模型设为当前 Agent 的默认模型（如 MiniMax-M2.7）
    defaultModel: apiModelRef(DEFAULT_MODEL),

    // 声明完成该认证后可以被激活/支持的 Provider 列表。国内版节点可能同时映射了 "minimax" 和 "minimax-cn" 两个提供者钩子
    expectedProviders: isCn ? ["minimax", "minimax-cn"] : ["minimax"],

    // 这是一个回调函数，当向导结束并应用配置时被触发。它会根据是国内还是全球版本，调用不同的配置写入逻辑（如修改 ~/.openclaw/openclaw.json）
    applyConfig: (cfg) => (isCn ? applyMinimaxApiConfigCn(cfg) : applyMinimaxApiConfig(cfg)),

    // 专门用于用户引导向导 (Wizard/Onboarding) 面板的元数据区块
    wizard: {
      // 对应之前在 openclaw.plugin.json 的 `providerAuthChoices` 中定义的 choiceId，使代码逻辑与静态配置产生绑定
      choiceId: isCn ? "minimax-cn-api" : "minimax-global-api",
      // 向导交互菜单中展示的选项标签名
      choiceLabel: `MiniMax API key (${regionLabel})`,
      // 向导交互菜单中展示的端点地址提示
      choiceHint: endpointHint,
      // 使用扩展运算符展开 `MINIMAX_WIZARD_GROUP` 常量，注入该选项所属的归类信息（如 groupId: "minimax", groupLabel: "MiniMax"），保证向导中选项折叠与分组正确
      ...MINIMAX_WIZARD_GROUP,
    },
  });
}

function createMinimaxOAuthMethod(region: MiniMaxRegion) {
  const regionLabel = resolveMinimaxRegionLabel(region);
  const endpointHint = resolveMinimaxEndpointHint(region);
  const isCn = region === "cn";
  return {
    id: isCn ? "oauth-cn" : "oauth",
    label: `MiniMax OAuth (${regionLabel})`,
    hint: endpointHint,
    kind: "device_code" as const,
    wizard: {
      choiceId: isCn ? "minimax-cn-oauth" : "minimax-global-oauth",
      choiceLabel: `MiniMax OAuth (${regionLabel})`,
      choiceHint: endpointHint,
      ...MINIMAX_WIZARD_GROUP,
    },
    run: createOAuthHandler(region),
  };
}

export function registerMinimaxProviders(api: OpenClawPluginApi) {
  // 调用 OpenClaw 的插件 API，在系统中注册一个大语言模型（文本推理）提供者 [1]。
  api.registerProvider({
    // 提供者的唯一规范标识符，必须与 openclaw.plugin.json 声明的 ID 匹配（如 "minimax"） [2]。
    id: API_PROVIDER_ID,

    // 面向用户显示的提供者名称标签 [2]。
    label: PROVIDER_LABEL,

    // 钩子别名声明。告诉系统如果遇到 "minimax-cn" 这个提供者 ID，也复用当前提供者的逻辑与权限 [3]。
    hookAliases: ["minimax-cn"],

    // 在官方文档或 OpenClaw 控制面板中指向该提供者帮助说明的路径。
    docsPath: "/providers/minimax",

    // 声明运行时所需的环境变量名，系统会利用它探查 API Key 是否已配置 [3]。
    envVars: ["MINIMAX_API_KEY"],

    // 注册该提供者支持的身份验证方法，这里通过工厂函数注册了全局 ("global") 和国内 ("cn") 两种验证方式 [2]。
    auth: [createMinimaxApiKeyMethod("global"), createMinimaxApiKeyMethod("cn")],

    // catalog（模型目录）配置块，用于定义 OpenClaw 该如何获取和合并这个提供者的可用模型列表 [2]。
    catalog: {
      // 设置目录合并时的排序优先级。"simple" 代表基础 API Key 提供者，会在合并时作为第一顺位（First pass）优先处理 [4]。
      order: "simple",

      // 动态获取模型列表的执行函数。当系统成功解析到凭证后会调用此方法（可能通过网络请求拉取最新的模型列表） [5]。
      run: async (ctx) => resolveApiCatalog(ctx),
    },

    // [生命周期钩子] 自定义逻辑：解析用于查询“账户余额/用量 (Usage)”的授权凭证 [6]。
    resolveUsageAuth: async (ctx) => {
      // 首先，尝试从系统中解析基于 OAuth 授权登录的门户 (Portal) 凭证。
      const portalOauth = await ctx.resolveOAuthToken({ provider: PORTAL_PROVIDER_ID });

      // 如果成功获取到了 OAuth 凭证...
      if (portalOauth) {
        // ...则优先返回 OAuth 凭证，用于后续的用量查询。
        return portalOauth;
      }

      // 如果没有 OAuth 凭证，则尝试回退到解析传统的 API Key。
      const apiKey = ctx.resolveApiKeyFromConfigAndStore({
        // 允许从 API_PROVIDER_ID 或 PORTAL_PROVIDER_ID 这两个关联配置中查找保存的密钥。
        providerIds: [API_PROVIDER_ID, PORTAL_PROVIDER_ID],
        // 同时也直接从当前的进程系统环境变量中映射读取可能的 API Key。
        envDirect: MINIMAX_USAGE_ENV_VAR_KEYS.map((name) => ctx.env[name]),
      });

      // 如果解析到了 API Key，将其包装成标准的 token 对象返回；否则返回 null，表示缺乏查询账单的凭证。
      return apiKey ? { token: apiKey } : null;
    },

    // 使用扩展运算符 (...) 将 MiniMax 专属的其他运行时生命周期钩子（如流式处理、请求头重写、重播策略等）注入到配置中 [7]。
    ...MINIMAX_PROVIDER_HOOKS,

    // [生命周期钩子] 验证某个模型 ID 是否属于此提供者当前支持的现代模型版本（Live/Smoke 匹配检测） [6]。
    isModernModelRef: ({ modelId }) => isMiniMaxModernModelId(modelId),

    // [生命周期钩子] 实际执行账单/用量查询的方法。当用户在终端输入 `openclaw status --usage` 时会触发此函数 [6, 8]。
    fetchUsageSnapshot: async (ctx) =>
      // 调用封装好的 fetch 函数向 MiniMax 接口请求用量快照，并传入上面 `resolveUsageAuth` 解析出的 token、超时设置以及底层 fetch 客户端 [6]。
      await fetchMinimaxUsage(ctx.token, ctx.timeoutMs, ctx.fetchFn),
  });

  api.registerProvider({
    id: PORTAL_PROVIDER_ID,
    label: PROVIDER_LABEL,
    hookAliases: ["minimax-portal-cn"],
    docsPath: "/providers/minimax",
    envVars: ["MINIMAX_OAUTH_TOKEN", "MINIMAX_API_KEY"],
    catalog: {
      run: async (ctx) => resolvePortalCatalog(ctx),
    },
    auth: [createMinimaxOAuthMethod("global"), createMinimaxOAuthMethod("cn")],
    ...MINIMAX_PROVIDER_HOOKS,
    isModernModelRef: ({ modelId }) => isMiniMaxModernModelId(modelId),
  });
}
