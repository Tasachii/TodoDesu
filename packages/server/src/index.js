import { openDb, defaultDbPath } from './db/index.js'
import { buildApp } from './app.js'

const host = process.env.TODOO_HOST || '127.0.0.1'
const port = Number(process.env.TODOO_PORT || 4521)
const token = process.env.TODOO_TOKEN || null

const db = openDb()
const app = buildApp({ db, host, token })

try {
  await app.listen({ host, port })
  console.log(`todoo server → http://${host}:${port}  (db: ${defaultDbPath()})`)
  if (host !== '127.0.0.1') {
    if (token) {
      console.log('🔒 LAN mode: writes require the TODOO_TOKEN bearer header.')
    } else {
      console.log('⚠️  LAN mode: anyone on this network can read/write your tasks.')
      console.log('   Set TODOO_TOKEN to require a bearer token on writes.')
    }
  }
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
