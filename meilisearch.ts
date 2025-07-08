import { Meilisearch } from 'npm:meilisearch'
import { Doc } from './types.ts'

const host = Deno.env.get('MEILI_URL')
const apiKey = Deno.env.get('MEILI_MASTER_KEY')
if (!host || !apiKey) throw Error('missing env for meilisearch')
const client = new Meilisearch({ host, apiKey })

const docsIndex = await client.getIndex('docs').catch(async (err) => {
  if (err?.cause?.code !== 'index_not_found') throw err
  const task = await client.createIndex('docs', { primaryKey: 'sha' })
  await client.tasks.waitForTask(task)
  return client.getIndex('docs')
})

export const addDocument = (doc: Doc) => addDocuments([doc])
export const addDocuments = async (docs: Doc[]) => {
  console.log('adding documents', { docs })
  const task = await docsIndex.addDocuments(docs)
  return docsIndex.tasks.waitForTask(task)
}

export const deleteDocument = (sha: string) => docsIndex.deleteDocument(sha)

export const proxyRequest = (req: Request) => {
  const headers = new Headers(req.headers)
  headers.set('Authorization', `Bearer ${apiKey}`)
  return fetch(`${host}/indexes/docs/search`, {
    headers,
    method: req.method,
    signal: req.signal,
    body: req.body,
  })
}
