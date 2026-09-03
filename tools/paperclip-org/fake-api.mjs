// A stub Paperclip API over node:http, so the reconciler is testable end to end
// with no credential and no live service — the analogue of
// tools/claude-fallback/stub.mjs.
//
// It models only what the tool touches, plus the behaviors that actually bite:
// canAssignTasks is rejected at create time, and triggers have no upsert.

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

export function createFakeApi({ companyId, requireAuth = true, seedAgents = [] } = {}) {
  const state = {
    company: { id: companyId, name: 'Focx.ai (fake)', budgetMonthlyCents: 0 },
    agents: [...seedAgents],
    routines: [],
    triggers: new Map(),
    policies: [],
    secrets: [{ name: 'claude_subscription_token' }, { name: 'github_focx_write_token' }],
    skills: [{ key: 'design' }, { key: 'artifact-design' }, { key: 'design:design-handoff' },
      { key: 'design:ux-copy' }, { key: 'design:design-critique' },
      { key: 'design:accessibility-review' }, { key: 'design:design-system' }],
    models: {
      claude_local: [{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }],
      codex_local: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.4' }],
    },
    calls: [],
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
    state.calls.push({ method: req.method, path, body })

    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload ?? {}))
    }
    if (path === '/api/health') return send(200, { status: 'ok', deploymentMode: 'authenticated' })
    if (requireAuth && !req.headers.authorization) return send(401, { message: 'unauthenticated' })

    let m
    if (req.method === 'GET' && path === `/api/companies/${companyId}`) return send(200, state.company)
    if (req.method === 'GET' && path === `/api/companies/${companyId}/agents`) return send(200, state.agents)
    if (req.method === 'GET' && path === `/api/companies/${companyId}/routines`) return send(200, state.routines)
    if (req.method === 'GET' && path === `/api/companies/${companyId}/secrets`) return send(200, state.secrets)
    if (req.method === 'GET' && path === `/api/companies/${companyId}/skills`) return send(200, state.skills)
    if ((m = path.match(new RegExp(`^/api/companies/${companyId}/adapters/([^/]+)/models$`)))) {
      return send(200, state.models[m[1]] ?? [])
    }

    if (req.method === 'POST' && path === `/api/companies/${companyId}/agents`) {
      // The real API rejects canAssignTasks at create time; a tool that sends it
      // is silently relying on a permission it never actually set.
      if (body?.permissions && 'canAssignTasks' in body.permissions) {
        return send(400, { message: 'canAssignTasks is not accepted at create time' })
      }
      const agent = {
        id: randomUUID(), status: 'idle', ...body,
        adapterType: body.adapterType, budgetMonthlyCents: body.budgetMonthlyCents ?? 0,
        permissions: { ...body.permissions, canAssignTasks: false },
      }
      state.agents.push(agent)
      return send(201, agent)
    }

    if ((m = path.match(/^\/api\/agents\/([^/]+)$/)) && req.method === 'PATCH') {
      const a = state.agents.find((x) => x.id === m[1]); if (!a) return send(404, {})
      Object.assign(a, body); return send(200, a)
    }
    if ((m = path.match(/^\/api\/agents\/([^/]+)\/(pause|terminate|resume)$/)) && req.method === 'POST') {
      const a = state.agents.find((x) => x.id === m[1]); if (!a) return send(404, {})
      a.status = m[2] === 'pause' ? 'paused' : m[2] === 'terminate' ? 'terminated' : 'idle'
      return send(200, a)
    }
    if ((m = path.match(/^\/api\/agents\/([^/]+)\/permissions$/)) && req.method === 'PATCH') {
      const a = state.agents.find((x) => x.id === m[1]); if (!a) return send(404, {})
      a.permissions = { ...a.permissions, ...body }; return send(200, a)
    }
    if ((m = path.match(/^\/api\/agents\/([^/]+)\/budgets$/)) && req.method === 'PATCH') {
      const a = state.agents.find((x) => x.id === m[1]); if (!a) return send(404, {})
      a.budgetMonthlyCents = body.budgetMonthlyCents; return send(200, a)
    }
    if ((m = path.match(/^\/api\/agents\/([^/]+)\/skills\/sync$/)) && req.method === 'POST') return send(200, {})
    if ((m = path.match(/^\/api\/agents\/([^/]+)\/runtime-state$/))) return send(200, { status: 'idle', activeRuns: 0 })
    if ((m = path.match(/^\/api\/agents\/([^/]+)\/configuration$/))) {
      const a = state.agents.find((x) => x.id === m[1]); if (!a) return send(404, {})
      return send(200, { adapterType: a.adapterType, adapterConfig: a.adapterConfig, runtimeConfig: a.runtimeConfig, permissions: a.permissions })
    }
    if ((m = path.match(/^\/api\/agents\/([^/]+)\/instructions-bundle$/))) {
      const a = state.agents.find((x) => x.id === m[1]); if (!a) return send(404, {})
      return send(200, a.instructionsBundle ?? { files: {} })
    }

    if (req.method === 'PATCH' && path === `/api/companies/${companyId}/budgets`) {
      state.company.budgetMonthlyCents = body.budgetMonthlyCents; return send(200, state.company)
    }
    if (req.method === 'POST' && path === `/api/companies/${companyId}/budgets/policies`) {
      state.policies.push(body); return send(201, body)
    }
    if (req.method === 'POST' && path === `/api/companies/${companyId}/routines`) {
      const r = { id: randomUUID(), ...body }; state.routines.push(r); state.triggers.set(r.id, []); return send(201, r)
    }
    if ((m = path.match(/^\/api\/routines\/([^/]+)$/))) {
      const r = state.routines.find((x) => x.id === m[1]); if (!r) return send(404, {})
      if (req.method === 'PATCH') { Object.assign(r, body); return send(200, r) }
      return send(200, { ...r, triggers: state.triggers.get(r.id) ?? [] })
    }
    if ((m = path.match(/^\/api\/routines\/([^/]+)\/triggers$/)) && req.method === 'POST') {
      // No upsert: every POST stacks another trigger. A tool that posts blindly
      // ends up double-firing every schedule, and this is where that shows up.
      const list = state.triggers.get(m[1]) ?? []
      const t = { id: randomUUID(), ...body }
      list.push(t); state.triggers.set(m[1], list); return send(201, t)
    }
    if ((m = path.match(/^\/api\/routine-triggers\/([^/]+)$/)) && req.method === 'PATCH') {
      for (const list of state.triggers.values()) {
        const t = list.find((x) => x.id === m[1])
        if (t) { Object.assign(t, body); return send(200, t) }
      }
      return send(404, {})
    }
    return send(404, { message: `no fake route for ${req.method} ${path}` })
  })

  return {
    state,
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((r) => server.close(r)),
  }
}
