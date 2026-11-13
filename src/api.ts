import { Apis, Configuration } from '@traptitech/traq'

declare const __TRAQ_ORIGIN__: string
/** traQ 本体のオリジン。メッセージ内の埋め込みURLはこのオリジンで書かれる */
export const ORIGIN = __TRAQ_ORIGIN__

export const api = new Apis(new Configuration({ basePath: '/api/v3' }))

export const fileUrl = (id: string) => `/api/v3/files/${id}`
export const thumbUrl = (id: string) => `/api/v3/files/${id}/thumbnail`
/** ユーザーのアイコン。変更するとファイル ID が変わるので、キャッシュの心配がない */
export const userIcon = (u?: { iconFileId: string } | null) => (u ? fileUrl(u.iconFileId) : undefined)

/** 型付きクライアントにまだ無いエンドポイント (feat/thread) 用 */
export async function rest<T = void>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api/v3' + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw r
  return (r.status === 204 ? undefined : await r.json()) as T
}

export type ThreadChannel = { id: string; parentChannelId: string; parentMessageId: string; archived: boolean; name: string }
