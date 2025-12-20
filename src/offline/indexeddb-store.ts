// Capa de persistencia offline basada en IndexedDB.
// Diseñada para funcionar en navegadores modernos sin dependencias externas.

import type { Commit, Finding, Plano, SerializedWorkspaceState, UUID } from "@/src/core"
import { serializeWorkspace, deserializeWorkspace } from "@/src/core"

const DB_NAME = "ssp_offline"
const DB_VERSION = 1

type StoreName = "planos" | "findings" | "commits" | "workspace"

export interface OfflineAdapter {
  savePlano: (plano: Plano) => Promise<void>
  getPlano: (id: UUID) => Promise<Plano | undefined>
  saveFinding: (finding: Finding) => Promise<void>
  saveCommit: (commit: Commit) => Promise<void>
  saveWorkspaceState: (state: SerializedWorkspaceState) => Promise<void>
  loadWorkspaceState: () => Promise<SerializedWorkspaceState | undefined>
}

export function createIndexedDBAdapter(): OfflineAdapter {
  return {
    async savePlano(plano) {
      const db = await openDb()
      await put(db, "planos", plano)
      db.close()
    },
    async getPlano(id) {
      const db = await openDb()
      const result = (await get(db, "planos", id)) as Plano | undefined
      db.close()
      return result
    },
    async saveFinding(finding) {
      const db = await openDb()
      await put(db, "findings", finding)
      db.close()
    },
    async saveCommit(commit) {
      const db = await openDb()
      await put(db, "commits", commit)
      db.close()
    },
    async saveWorkspaceState(state) {
      const db = await openDb()
      await put(db, "workspace", state, "current")
      db.close()
    },
    async loadWorkspaceState() {
      const db = await openDb()
      const result = (await get(db, "workspace", "current")) as SerializedWorkspaceState | undefined
      db.close()
      return result
    },
  }
}

export async function saveWorkspaceSnapshot(
  adapter: OfflineAdapter,
  snapshot: SerializedWorkspaceState,
): Promise<void> {
  await adapter.saveWorkspaceState(snapshot)
}

export async function loadWorkspaceSnapshot(
  adapter: OfflineAdapter,
): Promise<ReturnType<typeof deserializeWorkspace> | undefined> {
  const serialized = await adapter.loadWorkspaceState()
  if (!serialized) return undefined
  return deserializeWorkspace(serialized)
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB no está disponible en este entorno"))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("planos")) {
        db.createObjectStore("planos", { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains("findings")) {
        db.createObjectStore("findings", { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains("commits")) {
        db.createObjectStore("commits", { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains("workspace")) {
        db.createObjectStore("workspace")
      }
    }
  })
}

function put(db: IDBDatabase, storeName: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const request = key ? store.put(value, key) : store.put(value)
    request.onerror = () => reject(request.error ?? new Error("Error al guardar en IndexedDB"))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("Transacción IndexedDB fallida"))
  })
}

function get(db: IDBDatabase, storeName: StoreName, key: IDBValidKey): Promise<unknown | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly")
    const store = tx.objectStore(storeName)
    const request = store.get(key)
    request.onerror = () => reject(request.error ?? new Error("Error al leer desde IndexedDB"))
    request.onsuccess = () => resolve(request.result ?? undefined)
  })
}

