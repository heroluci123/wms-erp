import { createClient } from '@libsql/client'
import dotenv from 'dotenv'

dotenv.config()

const db = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
})

async function run() {
  try {
    await db.execute('ALTER TABLE romaneios ADD COLUMN operador_expedicao_nome TEXT')
    console.log('Column added.')
  } catch (e) {
    console.log('Error (maybe column exists?):', e.message)
  }
}

run()
