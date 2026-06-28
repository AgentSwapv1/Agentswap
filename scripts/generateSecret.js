/**
 * generateSecret.js
 * Generates a Circle entity secret and shows what to do with it.
 *
 * Run: node scripts/generateSecret.js
 *
 * The secret will print above. Copy the 64-char hex string and:
 *   1. Add to .env:  CIRCLE_ENTITY_SECRET=<the hex string>
 *   2. Register at:  https://console.circle.com → Entity Secret → Register
 */
import { generateEntitySecret } from '@circle-fin/developer-controlled-wallets'

console.log('\n─── Generating Entity Secret ─────────────────')
console.log('(The secret will appear between the ==== lines above)\n')
generateEntitySecret()
console.log('\n─── What to do with it ───────────────────────')
console.log('  1. Copy the 64-char hex string from above')
console.log('  2. Open your .env file')
console.log('  3. Set: CIRCLE_ENTITY_SECRET=<paste here>')
console.log('  4. Go to https://console.circle.com')
console.log('     → Settings → Entity Secret → Register')
console.log('     (paste the same secret there too)')
console.log('\n  Then run: npm run setup:arc')
console.log('─────────────────────────────────────────────\n')
