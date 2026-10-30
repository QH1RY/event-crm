// Run: PLAYWRIGHT_MODULE=<absolute path to playwright/index.mjs> node --test tests/enquiries-save.browser.mjs
// Uses the real Vite/React app and real headless Edge; all API traffic is intercepted, never sent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer } from 'vite'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const fixture = extra => ({
  id: 'save-test', reference: 'ENQ-TEST', version: 1, client_name: 'Original client', company: null,
  brand: 'Unassigned', status: 'New enquiry', priority: 'normal', brief: null, ...extra,
})
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const mode of ['update', 'create', 'conflict', 'failure']) {
    await test(`delayed ${mode}: edits and navigation locked until response; form survives`, async () => {
      const page = await browser.newPage()
      let saved = fixture(), release, received
      const requestReceived = new Promise(resolve => { received = resolve })
      const responseGate = new Promise(resolve => { release = resolve })
      const writes = []
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) return route.abort() // no external resources/network
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/bookings') return route.fulfill({ json: [] })
        if (route.request().method() === 'GET') return route.fulfill({ json: saved })
        const body = route.request().postDataJSON()
        writes.push({ method: route.request().method(), body })
        received()
        await responseGate // deterministically hold the actual fetch response
        if (mode === 'conflict') {
          saved = fixture({ version: 2, owner: 'Server owner' })
          return route.fulfill({ status: 409, json: { error: 'Version conflict' } })
        }
        if (mode === 'failure') return route.fulfill({ status: 500, json: { error: 'Test save failure' } })
        saved = fixture({ ...body, version: 2 })
        return route.fulfill({ status: mode === 'create' ? 201 : 200, json: saved })
      })
      try {
        await page.goto(origin + (mode === 'create' ? '/enquiries/new' : '/enquiries/save-test'))
        const name = page.locator('#eq-client_name')
        await name.waitFor()
        await name.fill('Zoë Muñoz')
        await page.locator('#eq-brief').fill('Draping — budget £1,500')
        await page.getByRole('button', { name: mode === 'create' ? 'Create enquiry' : 'Save changes', exact: true }).click()
        await requestReceived
        await page.locator('form[aria-busy="true"]').waitFor()
        // :disabled includes semantic disabled-fieldset inheritance, unlike .disabled.
        const editable = await page.locator('form input, form select, form textarea').evaluateAll(nodes => nodes.map(n => ({ id: n.id, disabled: n.matches(':disabled') })))
        assert.ok(editable.length >= 20)
        assert.deepEqual(editable.filter(n => !n.disabled), [], 'all edit controls must be disabled during pending save')
        const nav = page.getByRole('button', { name: 'Enquiries', exact: true })
        const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
        assert.equal(await nav.isDisabled(), true, 'back navigation must be disabled')
        assert.equal(await cancel.isDisabled(), true, 'cancel must be disabled')
        assert.equal(await page.getByRole('button', { name: 'Set last contact to now' }).isDisabled(), true)
        const before = page.url()
        // Real browser input attempts cannot alter disabled controls or navigate.
        await name.evaluate(el => el.focus())
        await page.keyboard.type('late edit')
        await nav.evaluate(el => el.click())
        await cancel.evaluate(el => el.click())
        assert.equal(page.url(), before)
        assert.equal(await name.inputValue(), 'Zoë Muñoz')
        assert.equal(await page.locator('#eq-brief').inputValue(), 'Draping — budget £1,500')
        assert.equal(writes.length, 1)
        assert.equal(writes[0].method, mode === 'create' ? 'POST' : 'PATCH')
        release()
        if (mode === 'create') await page.waitForURL(origin + '/enquiries/save-test')
        await page.locator('form[aria-busy="false"]').waitFor()
        assert.equal(await name.isEnabled(), true)
        assert.equal(await nav.isEnabled(), true)
        assert.equal(await cancel.isEnabled(), true)
        assert.equal(await name.inputValue(), 'Zoë Muñoz')
        assert.equal(await page.locator('#eq-brief').inputValue(), 'Draping — budget £1,500')
        if (mode === 'conflict') {
          await page.getByRole('button', { name: 'Reload latest and keep my edits' }).click()
          await page.getByText(/Your unsaved edits are kept/).waitFor()
          assert.equal(await name.inputValue(), 'Zoë Muñoz')
          assert.equal(await page.locator('#eq-brief').inputValue(), 'Draping — budget £1,500')
          assert.equal(await page.locator('#eq-owner').inputValue(), 'Server owner')
          assert.equal(await page.getByRole('button', { name: 'Save changes', exact: true }).isEnabled(), true)
        } else if (mode === 'failure') {
          await page.getByRole('alert').filter({ hasText: 'Test save failure' }).waitFor()
          assert.equal(await page.getByRole('button', { name: 'Save changes', exact: true }).isEnabled(), true)
        }
      } finally { release(); await page.close() }
    })
  }
} finally { await browser.close(); await server.close() }
