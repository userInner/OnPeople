class BrowserTargetRegistry {
  constructor() {
    this.routes = new Map();
    this.aliases = new Map();
  }

  normalizeRoute(value) {
    const route = String(value || "").trim();
    if (!route) throw new Error("浏览器任务路由无效");
    return route;
  }

  resolveRoute(value) {
    let route = this.normalizeRoute(value);
    const visited = new Set();
    while (this.aliases.has(route) && !visited.has(route)) {
      visited.add(route);
      route = this.aliases.get(route);
    }
    return route;
  }

  attach(routeId, target, ownerWebContentsId) {
    const route = this.normalizeRoute(routeId);
    const owner = Number(ownerWebContentsId);
    if (!target) throw new Error("浏览器页面不可用");
    if (!Number.isInteger(owner)) throw new Error("浏览器窗口无效");

    for (const [existingRoute, record] of this.routes) {
      if (record.target !== target || existingRoute === route) continue;
      this.routes.delete(existingRoute);
      for (const [alias, destination] of this.aliases) {
        if (destination === existingRoute) this.aliases.set(alias, route);
      }
    }
    this.aliases.delete(route);
    this.routes.set(route, { routeId: route, target, ownerWebContentsId: owner });
    return this.routes.get(route);
  }

  bind(aliasId, routeId) {
    const alias = this.normalizeRoute(aliasId);
    const route = this.resolveRoute(routeId);
    if (alias === route) this.aliases.delete(alias);
    else this.aliases.set(alias, route);
    return route;
  }

  get(routeId) {
    const route = this.resolveRoute(routeId);
    const record = this.routes.get(route);
    if (!record || record.target?.isDestroyed?.()) {
      if (record) {
        this.routes.delete(route);
        for (const [alias, target] of this.aliases) {
          if (target === route) this.aliases.delete(alias);
        }
      }
      return null;
    }
    return record;
  }

  owns(routeId, ownerWebContentsId) {
    return this.get(routeId)?.ownerWebContentsId === Number(ownerWebContentsId);
  }

  recordForTarget(target) {
    for (const record of this.routes.values()) {
      if (record.target === target) return record;
    }
    return null;
  }

  detach(routeId) {
    const route = this.resolveRoute(routeId);
    const removed = this.routes.delete(route);
    for (const [alias, destination] of this.aliases) {
      if (alias === route || destination === route) this.aliases.delete(alias);
    }
    return removed;
  }

  detachOwner(ownerWebContentsId) {
    const owner = Number(ownerWebContentsId);
    const removed = [];
    for (const [route, record] of this.routes) {
      if (record.ownerWebContentsId !== owner) continue;
      this.routes.delete(route);
      removed.push(route);
    }
    for (const [alias, destination] of this.aliases) {
      if (removed.includes(destination) || removed.includes(alias)) this.aliases.delete(alias);
    }
    return removed;
  }

  snapshot() {
    return {
      routes: [...this.routes.values()].map(({ routeId, ownerWebContentsId }) => ({ routeId, ownerWebContentsId })),
      aliases: [...this.aliases.entries()].map(([alias, routeId]) => ({ alias, routeId })),
    };
  }
}

module.exports = { BrowserTargetRegistry };
