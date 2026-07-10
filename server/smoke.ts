/**
 * Non-destructive end-to-end credential check.
 *   npm run smoke                 # checks Jira /myself + Tempo token
 *   npm run smoke -- REACT-1540   # also resolves a ticket key -> numeric id
 */
import { assertConfigured, config } from './config'
import { buildClients } from './factory'

async function main(): Promise<void> {
  const sampleKey = process.argv[2]

  console.log('Checking configuration...')
  assertConfigured()
  console.log(`  Jira:  ${config.jira.baseUrl} (as ${config.jira.email})`)
  console.log(`  Tempo: ${config.tempo.baseUrl}`)

  const { jira, tempo } = buildClients()

  console.log('\n[1/3] Jira /myself ...')
  const me = await jira.myself()
  console.log(`  OK  accountId=${me.accountId}  ${me.displayName}  tz=${me.timeZone}`)

  if (sampleKey) {
    console.log(`\n[2/3] Jira resolve issue ${sampleKey} ...`)
    const issue = await jira.resolveIssue(sampleKey)
    console.log(`  OK  ${issue.key} -> id ${issue.id}  "${issue.summary}"`)
  } else {
    console.log('\n[2/3] Skipped (pass a key to test resolution: npm run smoke -- REACT-1540)')
  }

  console.log('\n[3/3] Tempo read worklogs (verifies token, writes nothing) ...')
  await tempo.listWorklogs(1)
  console.log('  OK  Tempo token accepted')

  console.log('\nAll checks passed. Credentials are working end-to-end.')
}

main().catch((err) => {
  console.error(`\nSMOKE TEST FAILED:\n  ${(err as Error).message}`)
  process.exit(1)
})
