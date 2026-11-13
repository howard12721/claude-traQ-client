import type { Message } from '@traptitech/traq'
import { api, userIcon } from './api'
import {
  applyStamp, jumpTo, labelOf, loadChannels, loadGroups, loadMessages, loadPalettes, loadPins, loadStamps, loadSubscribers, loadThreads,
  loadUnread, loadUsers, removeMessage, upsertMessage, useStore, type State,
} from './store'

/** traQ の WebSocket イベントのうち、このクライアントが使うもの */
type WsEvent =
  | { type: 'MESSAGE_CREATED' | 'MESSAGE_UPDATED'; body: { id: string } }
  | { type: 'MESSAGE_DELETED'; body: { id: string } }
  | { type: 'MESSAGE_STAMPED'; body: { message_id: string; user_id: string; stamp_id: string; count: number } }
  | { type: 'MESSAGE_UNSTAMPED'; body: { message_id: string; user_id: string; stamp_id: string } }
  | { type: 'MESSAGE_PINNED' | 'MESSAGE_UNPINNED'; body: { message_id: string; channel_id: string } }
  | { type: 'MESSAGE_READ'; body: { id: string } }
  | { type: 'CHANNEL_CREATED' | 'CHANNEL_UPDATED' | 'CHANNEL_DELETED'; body: { id: string } }
  | { type: 'CHANNEL_VIEWERS_CHANGED'; body: { id: string; viewers: { userId: string; state: string }[] } }
  | { type: 'CHANNEL_SUBSCRIBERS_CHANGED'; body: { id: string } }
  | { type: 'STAMP_CREATED' | 'STAMP_UPDATED' | 'STAMP_DELETED'; body: { id: string } }
  | { type: 'STAMP_PALETTE_CREATED' | 'STAMP_PALETTE_UPDATED' | 'STAMP_PALETTE_DELETED'; body: { id: string } }
  | { type: 'USER_JOINED' | 'USER_UPDATED' | 'USER_ICON_UPDATED'; body: { id: string } }
  | { type: 'USER_ONLINE' | 'USER_OFFLINE'; body: { id: string } }
  | { type: 'USER_GROUP_CREATED' | 'USER_GROUP_UPDATED' | 'USER_GROUP_DELETED'; body: { id: string } }
  | { type: 'THREAD_CREATED'; body: { id: string } }

let ws: WebSocket | undefined
let unreadTimer: ReturnType<typeof setTimeout> | undefined
const refreshUnread = () => { clearTimeout(unreadTimer); unreadTimer = setTimeout(loadUnread, 400) }

/** viewstate は 1 チャンネル分しか持てないので、スレッドを開いている間はそちらを見ていることにする */
const viewing = (s: State) => (s.side?.kind === 'thread' && s.side.id) || s.current

function sendView() {
  const s = useStore.getState()
  const target = viewing(s)
  const state = !document.hasFocus() ? 'none' : s.typing ? 'editing' : 'monitoring'
  if (ws?.readyState === WebSocket.OPEN && target) ws.send(`viewstate:${target}:${state}`)
}

function handle(ev: WsEvent) {
  const s = useStore.getState()
  switch (ev.type) {
    case 'MESSAGE_CREATED':
    case 'MESSAGE_UPDATED':
      api.getMessage(ev.body.id).then(r => {
        const cid = r.data.channelId
        upsertMessage(r.data)
        if (ev.type !== 'MESSAGE_CREATED') return
        if (!s.channels[cid] && !s.dms[cid] && !s.threads[cid]) loadChannels() // 新しい DM
        if (cid !== viewing(s) && r.data.userId !== s.me?.id) refreshUnread()
        desktopNotify(r.data)
      })
      return
    case 'MESSAGE_DELETED': return removeMessage(ev.body.id)
    case 'MESSAGE_STAMPED': return applyStamp(ev.body.message_id, ev.body.user_id, ev.body.stamp_id, ev.body.count)
    case 'MESSAGE_UNSTAMPED': return applyStamp(ev.body.message_id, ev.body.user_id, ev.body.stamp_id, null)
    case 'MESSAGE_PINNED': case 'MESSAGE_UNPINNED':
      if (s.pins[ev.body.channel_id]) loadPins(ev.body.channel_id)
      return
    // 別の端末で既読にした
    case 'MESSAGE_READ': return useStore.setState(x => { const { [ev.body.id]: _, ...unread } = x.unread; return { unread } })
    case 'CHANNEL_CREATED': case 'CHANNEL_UPDATED': case 'CHANNEL_DELETED': return void loadChannels()
    case 'CHANNEL_VIEWERS_CHANGED':
      return useStore.setState(x => ({ viewers: { ...x.viewers, [ev.body.id]: ev.body.viewers.map(({ userId, state }) => ({ userId, state })) } }))
    case 'CHANNEL_SUBSCRIBERS_CHANGED':
      if (s.subscribers[ev.body.id]) loadSubscribers(ev.body.id)
      return
    case 'STAMP_CREATED': case 'STAMP_UPDATED': case 'STAMP_DELETED': return void loadStamps()
    case 'STAMP_PALETTE_CREATED': case 'STAMP_PALETTE_UPDATED': case 'STAMP_PALETTE_DELETED': return void loadPalettes()
    case 'USER_JOINED': case 'USER_UPDATED': case 'USER_ICON_UPDATED': return void loadUsers()
    case 'USER_ONLINE': case 'USER_OFFLINE':
      return useStore.setState(x => ({ onlineUsers: { ...x.onlineUsers, [ev.body.id]: ev.type === 'USER_ONLINE' } }))
    case 'USER_GROUP_CREATED': case 'USER_GROUP_UPDATED': case 'USER_GROUP_DELETED': return void loadGroups()
    case 'THREAD_CREATED': return void (s.current && loadThreads(s.current))
  }
}

/** メンション・DM・「すべて通知」のチャンネルへの投稿を、見ていないときだけ OS に通知する */
function desktopNotify(m: Message) {
  const s = useStore.getState()
  if (!s.notify || !('Notification' in window) || Notification.permission !== 'granted') return
  if (m.userId === s.me?.id || (document.hasFocus() && (m.channelId === s.current || m.channelId === viewing(s)))) return
  const mentioned = m.content.includes(`"id":"${s.me?.id}"`)
  if (!mentioned && !s.dms[m.channelId] && s.subs[m.channelId] !== 2) return
  const user = s.users[m.userId]
  // 埋め込み記法 !{"raw":"@foo",...} は表示用の raw に戻す
  const body = m.content.replace(/!\{[^}]*"raw":"([^"]*)"[^}]*\}/g, '$1').slice(0, 200)
  const n = new Notification(`${user?.displayName ?? ''} · ${labelOf(s, m.channelId)}`, { body, icon: userIcon(user), tag: m.id })
  n.onclick = () => { focus(); jumpTo(m); n.close() }
}

let started = false

/** ログイン後に一度だけ呼ぶ。切れたら間隔を伸ばしながら繋ぎ直す */
export function connect() {
  if (started) return
  started = true
  let retry = 0
  let first = true
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v3/ws`)
    ws.onopen = () => {
      retry = 0
      useStore.setState({ online: true })
      sendView()
      // 切断中に取りこぼした分を取り直す
      if (!first) { const c = useStore.getState().current; if (c) loadMessages(c); loadUnread() }
      first = false
    }
    ws.onmessage = e => handle(JSON.parse(e.data) as WsEvent)
    ws.onclose = () => {
      useStore.setState({ online: false })
      setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++))
    }
  }
  open()
  useStore.subscribe((s, p) => {
    if (viewing(s) !== viewing(p) || s.typing !== p.typing) sendView()
    // スレッドを閉じたら、その間に取りこぼした本流を取り直す
    if (p.side?.kind === 'thread' && p.side.id && s.side?.kind !== 'thread' && s.current) loadMessages(s.current)
  })
  addEventListener('focus', sendView)
  addEventListener('blur', sendView)
}
