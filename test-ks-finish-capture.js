/**
 * Capture the exact upload/finish request from Kuaishou browser.
 * Run: node test-ks-finish-capture.js
 * Then upload a video in the browser.
 */
const { chromium } = require('playwright-core')
const path = require('path')
const fs = require('fs')

const PROFILE_DIR = path.join(process.env.APPDATA || '', 'flow-publisher', 'browser-profiles', 'kuaishou')

async function main() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const executablePath = fs.existsSync(edgePath) ? edgePath : chromePath

  console.log(`Using browser: ${executablePath}`)

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    executablePath,
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1366, height: 768 },
    locale: 'zh-CN'
  })

  const page = await context.newPage()

  // Capture upload/finish specifically
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('upload/finish') || url.includes('upload/complete')) {
      console.log(`\n${'='.repeat(80)}`)
      console.log(`[CAPTURED] ${req.method()} ${url}`)
      console.log(`Headers:`)
      const headers = req.headers()
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'cookie') {
          console.log(`  ${k}: (length=${v.length})`)
        } else {
          console.log(`  ${k}: ${v}`)
        }
      }
      const body = req.postData()
      if (body) {
        console.log(`Body (${body.length} chars):`)
        try {
          const parsed = JSON.parse(body)
          console.log(JSON.stringify(parsed, null, 2))
        } catch {
          console.log(body)
        }
      }
      console.log(`${'='.repeat(80)}`)
    }
  })

  // Capture upload/finish response
  page.on('response', async (res) => {
    const url = res.url()
    if (url.includes('upload/finish')) {
      console.log(`\n[FINISH RESPONSE] ${res.status()} ${url}`)
      try {
        const body = await res.text()
        console.log(`Response body: ${body.substring(0, 1000)}`)
      } catch {}
    }
  })

  // Also capture upload/pre to compare
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('upload/pre')) {
      console.log(`\n[PRE REQUEST] ${req.method()} ${url}`)
      const body = req.postData()
      if (body) {
        try {
          const parsed = JSON.parse(body)
          console.log(`Pre body: ${JSON.stringify(parsed, null, 2)}`)
        } catch {
          console.log(`Pre body: ${body}`)
        }
      }
    }
  })

  page.on('response', async (res) => {
    const url = res.url()
    if (url.includes('upload/pre')) {
      console.log(`\n[PRE RESPONSE] ${res.status()} ${url}`)
      try {
        const body = await res.text()
        console.log(`Pre response: ${body.substring(0, 2000)}`)
      } catch {}
    }
  })

  console.log('Navigating to publish page...')
  await page.goto('https://cp.kuaishou.com/article/publish/video', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  })

  console.log(`\nCurrent URL: ${page.url()}`)
  console.log('Upload a video file in the browser to capture the API requests...')
  console.log('Press Ctrl+C when done.\n')

  await new Promise(() => {})
}

main().catch(console.error)
