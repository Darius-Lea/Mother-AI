/** Hosting configuration is separate from the privileged installed desktop app. */
export function deploymentConfig(env = process.env, desktopToken) {
  const onRender = env.RENDER === 'true';
  const mode = desktopToken ? 'desktop' : onRender || env.MOTHER_MODE === 'hosted-preview' ? 'hosted-preview' : 'local';
  const configuredHosts = (env.MOTHER_ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (onRender && env.RENDER_EXTERNAL_HOSTNAME) configuredHosts.push(env.RENDER_EXTERNAL_HOSTNAME);
  if (onRender && env.RENDER_EXTERNAL_URL) {
    try { configuredHosts.push(new URL(env.RENDER_EXTERNAL_URL).hostname); } catch { /* A malformed optional URL does not broaden host access. */ }
  }
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  return {
    mode,
    host: env.HOST || (onRender || mode === 'hosted-preview' ? '0.0.0.0' : '127.0.0.1'),
    port,
    allowedHosts: [...new Set(configuredHosts)],
  };
}

export function publicCapabilities(mode) {
  const hosted = mode === 'hosted-preview';
  return {
    localTools: true,
    modelSetup: !hosted,
    projectAccess: !hosted,
    appGrants: !hosted,
    datasetLinks: !hosted,
    securityBridge: !hosted,
    neuralChat: !hosted,
  };
}
