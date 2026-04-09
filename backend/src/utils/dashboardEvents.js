/**
 * dashboardEvents.js
 * Central event bus for real-time dashboard updates via SSE.
 *
 * Usage — emitting (in any controller/service after a mutation):
 *   const dashboardEvents = require('../utils/dashboardEvents');
 *   dashboardEvents.emit('dashboard:change', organizationId);
 *
 * Usage — SSE endpoint (in analyticsController):
 *   dashboardEvents.addClient(orgId, role, res);
 */
const EventEmitter = require('events');

class DashboardEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0); // unlimited SSE clients
    /** @type {Map<string, Set<{res: object, role: string}>>} orgId → clients */
    this._clients = new Map();
  }

  /**
   * Register an SSE client. Returns a cleanup function.
   */
  addClient(orgId, role, res) {
    if (!this._clients.has(orgId)) {
      this._clients.set(orgId, new Set());
    }
    const client = { res, role };
    this._clients.get(orgId).add(client);

    return () => {
      const set = this._clients.get(orgId);
      if (set) {
        set.delete(client);
        if (set.size === 0) this._clients.delete(orgId);
      }
    };
  }

  /**
   * Notify all connected SSE clients for a given org that dashboard data changed.
   * @param {string} orgId
   * @param {string} entity - what changed: 'lead', 'opportunity', 'activity', etc.
   */
  notifyOrg(orgId, entity = 'unknown') {
    const set = this._clients.get(orgId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify({ event: 'dashboard:change', entity, timestamp: new Date().toISOString() });
    for (const client of set) {
      try {
        client.res.write(`data: ${payload}\n\n`);
      } catch (_) {
        // client disconnected — will be cleaned up on 'close'
      }
    }
  }

  /** Current connected client count (for health/debug) */
  clientCount(orgId) {
    if (orgId) {
      const set = this._clients.get(orgId);
      return set ? set.size : 0;
    }
    let total = 0;
    for (const set of this._clients.values()) total += set.size;
    return total;
  }
}

// Singleton
module.exports = new DashboardEventBus();
