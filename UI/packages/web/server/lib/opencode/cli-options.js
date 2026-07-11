export const parseServeCliOptions = ({
  argv = [],
  env = {},
  defaultPort,
  cloudflareProvider,
  managedLocalMode,
}) => {
  const args = Array.isArray(argv) ? [...argv] : [];
  const envPassword =
    env.OPENCHAMBER_UI_PASSWORD ||
    env.OPENCODE_UI_PASSWORD ||
    null;
  const envCfTunnel = env.OPENCHAMBER_TRY_CF_TUNNEL === 'true';
  const envTunnelProvider = env.OPENCHAMBER_TUNNEL_PROVIDER || undefined;
  const envTunnelMode = env.OPENCHAMBER_TUNNEL_MODE || undefined;
  const envTunnelConfigRaw = env.OPENCHAMBER_TUNNEL_CONFIG;
  const envTunnelConfig = typeof envTunnelConfigRaw === 'string'
    ? (envTunnelConfigRaw.trim().length > 0 ? envTunnelConfigRaw.trim() : null)
    : undefined;
  const envTunnelToken = env.OPENCHAMBER_TUNNEL_TOKEN || undefined;
  const envTunnelHostname = env.OPENCHAMBER_TUNNEL_HOSTNAME || undefined;
  const envApiOnly = env.OPENCHAMBER_API_ONLY === '1' || env.OPENCHAMBER_API_ONLY === 'true';
  // dev:server:watch's nodemon --exec string does `--port ${OPENCHAMBER_PORT:-3001}` — that bash
  // parameter-expansion syntax doesn't get interpreted on Windows (nodemon shells out via cmd.exe
  // there), so the literal unexpanded string reaches here and fails parseInt below, silently
  // falling back to defaultPort (3000) regardless of what OPENCHAMBER_PORT was actually set to.
  // Reading the real env var directly (which node's real process.env inheritance delivers
  // correctly regardless of shell dialect) fixes that without touching the dev script.
  const envPort = parseInt(env.OPENCHAMBER_PORT ?? '', 10);
  const resolvedDefaultPort = Number.isFinite(envPort) ? envPort : defaultPort;

  const options = {
    port: resolvedDefaultPort,
    host: undefined,
    uiPassword: envPassword,
    tryCfTunnel: envCfTunnel,
    tunnelProvider: envTunnelProvider,
    tunnelMode: envTunnelMode,
    tunnelConfigPath: envTunnelConfig,
    tunnelToken: envTunnelToken,
    tunnelHostname: envTunnelHostname,
    apiOnly: envApiOnly,
  };

  const consumeValue = (currentIndex, inlineValue) => {
    if (typeof inlineValue === 'string') {
      return { value: inlineValue, nextIndex: currentIndex };
    }
    const nextArg = args[currentIndex + 1];
    if (typeof nextArg === 'string' && !nextArg.startsWith('--')) {
      return { value: nextArg, nextIndex: currentIndex + 1 };
    }
    return { value: undefined, nextIndex: currentIndex };
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const eqIndex = arg.indexOf('=');
    const optionName = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    const inlineValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;

    if (optionName === 'port' || optionName === 'p') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      const parsedPort = parseInt(value ?? '', 10);
      options.port = Number.isFinite(parsedPort) ? parsedPort : resolvedDefaultPort;
      continue;
    }

    if (optionName === 'host') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      options.host = typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
      continue;
    }

    if (optionName === 'ui-password') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      options.uiPassword = typeof value === 'string' ? value : '';
      continue;
    }

    if (optionName === 'api-only') {
      options.apiOnly = true;
      continue;
    }

    if (optionName === 'try-cf-tunnel') {
      options.tryCfTunnel = true;
      continue;
    }

    if (optionName === 'tunnel-provider') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      options.tunnelProvider = typeof value === 'string' ? value : options.tunnelProvider;
      continue;
    }

    if (optionName === 'tunnel-mode') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      options.tunnelMode = typeof value === 'string' ? value : options.tunnelMode;
      continue;
    }

    if (optionName === 'tunnel-config') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      options.tunnelConfigPath = typeof value === 'string' ? value : null;
      continue;
    }

    if (optionName === 'tunnel-token') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      options.tunnelToken = typeof value === 'string' ? value : options.tunnelToken;
      continue;
    }

    if (optionName === 'tunnel-hostname') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      options.tunnelHostname = typeof value === 'string' ? value : options.tunnelHostname;
      continue;
    }

    if (optionName === 'tunnel') {
      const { value, nextIndex } = consumeValue(i, inlineValue);
      i = nextIndex;
      options.tunnelProvider = cloudflareProvider;
      options.tunnelMode = managedLocalMode;
      options.tunnelConfigPath = typeof value === 'string' ? value : null;
    }
  }

  return options;
};
