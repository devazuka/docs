import { Meilisearch } from 'npm:meilisearch'
import { Doc } from './types.ts'

const host = Deno.env.get('MEILI_URL')
const apiKey = Deno.env.get('MEILI_MASTER_KEY')
const indexName = Deno.env.get('MEILI_INDEX')
if (!host || !apiKey) throw Error('missing env for meilisearch')
const client = new Meilisearch({ host, apiKey })

const docsIndex = await client.getIndex(indexName).catch(async (err) => {
  if (err?.cause?.code !== 'index_not_found') throw err
  const createTask = await client.createIndex(indexName, { primaryKey: 'sha' })
  await client.tasks.waitForTask(createTask.taskUid)
  return client.getIndex(indexName)
})

docsIndex.updateSettings({
  sortableAttributes: ['uploadedAt', 'size', 'name'],
  filterableAttributes: ['uploadedAt', 'mime', 'type', 'tags'],
}).then(task => client.tasks.waitForTask(task)).then(result => {
  console.log('index confirmed', result)
})

export const getDocument = (sha: string) => docsIndex.getDocument(sha)
export const addDocument = (doc: Doc) => addDocuments([doc])
export const addDocuments = async (docs: Doc[]) => {
  console.log('adding documents', { docs })
  const task = await docsIndex.addDocuments(docs)
  return docsIndex.tasks.waitForTask(task)
}

export const deleteDocument = (sha: string) => docsIndex.deleteDocument(sha)

const apiUrl = `${host}/indexes/${indexName}/search`
export const proxyRequest = (req: Request) => {
  const headers = new Headers(req.headers)
  headers.set('Authorization', `Bearer ${apiKey}`)
  return fetch(apiUrl, {
    headers,
    method: req.method,
    signal: req.signal,
    body: req.body,
  })
}
