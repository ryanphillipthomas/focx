import { createHash } from 'node:crypto'

export const sha256 = text => createHash('sha256').update(text).digest('hex')
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}
export const hash = value => sha256(JSON.stringify(canonical(value)))
export function approvalDigest(operations, target, contractSha) {
  return hash({ operations, target: { baseUrl: target.baseUrl.replace(/\/$/, ''), companyId: target.companyId ?? null }, contractSha })
}
