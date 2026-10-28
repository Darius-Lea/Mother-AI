const identity = value => ({
  version: typeof value?.version === 'string' ? value.version : '',
  commit: typeof (value?.buildCommit || value?.sourceCommit || value?.commit) === 'string' ? (value.buildCommit || value.sourceCommit || value.commit) : '',
  time: Date.parse(value?.buildTime || value?.builtAt || value?.generatedAt || '') || 0,
});

/** A website update is always an explicit refresh. Conversation memory stays in local storage. */
export function createWebUpdateMonitor({
  onState = () => {}, fetchImpl = globalThis.fetch,
  serviceWorker = globalThis.navigator?.serviceWorker,
  currentBuild = {}, reload = () => globalThis.location.reload(),
  activationTimeout = 15000,
} = {}) {
  const installed = identity(currentBuild);
  let status = { source: 'web', state: 'idle', installedVersion: installed.version,
    installedCommit: installed.commit, availableVersion: '', availableCommit: '', progress: null, error: null };
  let disposed = false, checking, applying, cancelActivation;
  let operation;
  const getStatus = () => ({ ...status });
  const update = change => { status = { ...status, ...change }; if (!disposed) onState(getStatus()); };

  async function check() {
    if (disposed) return getStatus();
    if (checking) return checking;
    if (applying) return getStatus();
    operation = new AbortController();
    checking = (async () => {
      update({ state: 'checking', error: null });
      try {
        const response = await fetchImpl('/api/health', { cache: 'no-store', signal: operation.signal });
        if (!response.ok) throw Error('Mother could not check for updates. Try again when you are online.');
        const available = identity(await response.json());
        // A missing identity is not evidence of an update. Do not repeatedly refresh
        // older deployments that have no build metadata or a stale CDN response.
        const changed = installed.commit && available.commit && installed.commit !== available.commit
          && !(installed.time && available.time && available.time < installed.time);
        update({ state: changed ? 'available' : 'current', availableVersion: available.version,
          availableCommit: available.commit, error: null });
        return getStatus();
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') update({ state: 'error', error: error.message || 'Could not check for updates.' });
        return getStatus();
      } finally { checking = null; operation = null; }
    })();
    return checking;
  }

  function activate(registration) {
    const waiting = registration?.waiting;
    if (!waiting || !serviceWorker?.addEventListener) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        serviceWorker.removeEventListener('controllerchange', changed);
        if (cancelActivation === cancel) cancelActivation = null;
        if (error) reject(error); else resolve(true);
      };
      const changed = () => finish();
      const cancel = () => finish(Object.assign(new Error('Update cancelled.'), { name: 'AbortError' }));
      const timer = setTimeout(() => finish(Error('The update is not ready to refresh yet. Keep working and try Update again.')), activationTimeout);
      cancelActivation = cancel;
      serviceWorker.addEventListener('controllerchange', changed);
      try { waiting.postMessage({ type: 'ACTIVATE_UPDATE' }); } catch (error) { finish(error); }
    });
  }

  async function apply() {
    if (disposed || applying || status.state !== 'available') return getStatus();
    applying = (async () => {
      update({ state: 'installing', error: null });
      try {
        const registration = await serviceWorker?.getRegistration?.();
        if (registration) {
          await registration.update();
          // update() may resolve while a new worker is still installing.
          const installing = registration.installing;
          if (installing && !registration.waiting) await new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
              if (settled) return; settled = true; clearTimeout(timer);
              installing.removeEventListener('statechange', changed);
              if (cancelActivation === cancel) cancelActivation = null;
              if (error) reject(error); else resolve();
            };
            const changed = () => {
              if (installing.state === 'installed') finish();
              if (installing.state === 'redundant') finish(Error('The new interface could not be prepared. Try Update again.'));
            };
            const cancel = () => finish(Object.assign(Error('Update cancelled.'), { name: 'AbortError' }));
            const timer = setTimeout(() => finish(Error('The interface is still preparing. Keep working and try Update again.')), activationTimeout);
            cancelActivation = cancel;
            installing.addEventListener('statechange', changed); changed();
          });
          await activate(registration);
        }
        if (!disposed) reload();
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') update({ state: 'error', error: error.message || 'Could not apply the update. Keep working and try again.' });
      } finally { applying = null; }
      return getStatus();
    })();
    return applying;
  }

  return { check, apply, getStatus, dispose() { disposed = true; operation?.abort(); cancelActivation?.(); } };
}
