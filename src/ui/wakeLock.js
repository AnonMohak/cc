/**
 * Keep the screen on while wanted (the intro fall: a phone would otherwise
 * dim and lock before the minute is over, and the tap that wakes it would end
 * the fall). Screen Wake Lock API; a silent no-op where it is missing or
 * refused (it needs a secure context: https or localhost).
 *
 * The browser drops the lock when the page is hidden, so it is taken again
 * when the page comes back while still wanted.
 *
 * @param {{ nav?: Navigator, doc?: Document }} [env]
 */
export function createWakeLock({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  const api = nav?.wakeLock;
  let wanted = false;
  let sentinel = null;
  let pending = false;

  async function acquire() {
    if (!api || sentinel || pending || doc?.visibilityState === 'hidden') return;
    pending = true;
    try {
      const lock = await api.request('screen');
      if (wanted) {
        sentinel = lock;
        lock.addEventListener?.('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      } else {
        lock.release();
      }
    } catch {
      // Refused (battery saver, not visible, no permission): run without it.
    } finally {
      pending = false;
    }
  }

  function onVisibility() {
    if (wanted && doc.visibilityState === 'visible') acquire();
  }
  doc?.addEventListener?.('visibilitychange', onVisibility);

  return {
    supported: Boolean(api),
    /** @param {boolean} on keep the screen on (true) or let it sleep */
    set(on) {
      if (on === wanted) return;
      wanted = on;
      if (on) acquire();
      else if (sentinel) {
        const lock = sentinel;
        sentinel = null;
        lock.release().catch(() => {});
      }
    },
    isHeld: () => sentinel !== null,
    dispose() {
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      this.set(false);
    },
  };
}
