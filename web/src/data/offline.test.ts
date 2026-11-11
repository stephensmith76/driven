import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _test, flush, overlay, queuedWrite, registerHandler } from './offline'

const netErr = () => new TypeError('Failed to fetch')

describe('offline queue', () => {
  beforeEach(() => _test.reset())

  it('runs a write straight away when online', async () => {
    const run = vi.fn().mockResolvedValue(5)
    expect(await queuedWrite({ kind: 'x', args: [], table: 'characters', id: 'a' }, run, null)).toBe(5)
    expect(_test.pending()).toBe(0)
  })

  it('queues on a network error, shows it at once, and replays in order when back', async () => {
    const calls: number[] = []
    let up = false
    registerHandler('bump', async (d: number) => { if (!up) throw netErr(); calls.push(d) })
    const w = (d: number) => queuedWrite({ kind: 'bump', args: [d], table: 'characters', id: 'a', add: { stress: d } },
      async () => { throw netErr() }, null)
    await w(1); await w(2)
    expect(_test.pending()).toBe(2)
    expect(overlay('characters', [{ id: 'a', stress: 1 }])[0]).toMatchObject({ stress: 4 })
    expect(overlay('characters', [{ id: 'b', stress: 1 }])[0]).toMatchObject({ stress: 1 })
    await flush()
    expect(_test.pending()).toBe(2) // still down
    up = true
    await flush()
    expect(calls).toEqual([1, 2])
    expect(_test.pending()).toBe(0)
  })

  it('does not queue a write the server refused', async () => {
    await expect(queuedWrite({ kind: 'x', args: [], table: 't', id: 'a' }, async () => { throw new Error('permission denied') }, null))
      .rejects.toThrow('permission denied')
    expect(_test.pending()).toBe(0)
  })

  it('shows a queued roll in the log until it lands', async () => {
    registerHandler('insertRoll', async () => { throw netErr() })
    await queuedWrite({ kind: 'insertRoll', args: [], table: 'rolls', id: 'r1', insert: { id: 'r1', total: 12 } }, async () => { throw netErr() }, undefined)
    expect(overlay('rolls', [])).toEqual([{ id: 'r1', total: 12 }])
  })
})
