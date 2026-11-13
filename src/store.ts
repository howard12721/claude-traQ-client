import { create } from 'zustand'
import type { Channel, ChannelSubscribeLevel, ClipFolder, Message, MyUserDetail, Pin, Stamp, UnreadChannel, User, UserGroup } from '@traptitech/traq'
import { UserAccountState } from '@traptitech/traq'
import { api, fileUrl, ORIGIN, rest, type ThreadChannel } from './api'

export type SettingsTab = 'profile' | 'palettes' | 'appearance' | 'notification' | 'security'
export type Palette = { id: string; name: string; description: string; stamps: string[] }
export type Theme = 'system' | 'light' | 'dark'
export type Toast = { id: number; text: string; undo?: () => void; error?: boolean }
type Picker = {
  /** 開くたびに変わる。ピッカーの中身 (検索語など) を開き直しで初期化するため */
  id: number
  rect: DOMRect
  onPick: (stampId: string) => void
  /** 選んでも閉じない (パレット編集用) */
  multi?: boolean
  /** 選択済みとして強調するスタンプ */
  selected?: (s: State) => string[]
}
/** 右側パネル。スレッドもここに含める (id が無いのは作成前の下書き) */
export type Side =
  | { kind: 'thread'; parent: Message; id?: string }
  | { kind: 'search'; q: string }
  | { kind: 'pins' }
  | { kind: 'clips' }
  | { kind: 'activity' }
  | { kind: 'user'; userId: string; back?: Side }
  | { kind: 'group'; groupId: string; back?: Side }
  | { kind: 'tag'; tagId: string; back?: Side }
  | { kind: 'members' }
  | { kind: 'users'; q: string; online?: boolean; who?: 'people' | 'bots' | 'groups' }

export type State = {
  me?: MyUserDetail
  users: Record<string, User>
  usersByName: Record<string, User>
  groups: Record<string, UserGroup>
  /** ユーザー ID → 学年グループ (type が grade) の ID */
  grades: Record<string, string>
  channels: Record<string, Channel>
  paths: Record<string, string>
  /** DM チャンネル ID → 相手のユーザー ID */
  dms: Record<string, string>
  recentDms: string[]
  threads: Record<string, ThreadChannel>
  /** サーバーがスレッド API を持っているか (feat/thread) */
  threadsOk: boolean
  userCard?: { userId: string; rect: DOMRect }
  side?: Side
  /** 設定画面のタブ。開いている間はタイムラインの代わりに出る */
  settings?: SettingsTab
  theme: Theme
  /** ブラウザ通知 (メンション・DM・通知をつけたチャンネル) */
  notify: boolean
  /** ジャンプ先として一瞬強調するメッセージ */
  focus?: string
  clipFolders: ClipFolder[]
  /** メッセージ ID → クリップしたフォルダ ID (既定フォルダ分のみ把握) */
  clipped: Record<string, string>
  onlineUsers: Record<string, boolean>
  /** チャンネルを開いている人 (state: monitoring / editing / stale_viewing / none) */
  viewers: Record<string, { userId: string; state: string }[]>
  /** チャンネル ID → 通知を受け取っている人 (一覧を開いたチャンネルだけ) */
  subscribers: Record<string, string[]>
  /** チャンネル ID → ピン留め (一覧を開いたチャンネルだけ) */
  pins: Record<string, Pin[]>
  /** 投稿欄のチャンネル ID → 送信時に本文の末尾へ付ける引用 */
  quotes: Record<string, string[]>
  /** 自分が投稿欄に入力中か (viewstate を editing にする) */
  typing: boolean
  byPath: Record<string, string>
  stamps: Record<string, Stamp>
  stampsByName: Record<string, Stamp>
  recentStamps: string[]
  palettes: Palette[]
  unread: Record<string, UnreadChannel>
  stars: string[]
  subs: Record<string, number>
  expanded: Record<string, boolean>
  messages: Record<string, Message[]>
  hasMore: Record<string, boolean>
  /** 過去の位置へジャンプして、最新までの間が抜けている */
  hasNewer: Record<string, boolean>
  pending: Record<string, boolean>
  current?: string
  editing?: string
  toasts: Toast[]
  picker?: Picker
  /** ⌘K パレット。文字列なら初期入力 */
  palette: boolean | string
  navOpen: boolean
  online: boolean
}

const ls = {
  get: <T,>(k: string, d: T): T => {
    try { return JSON.parse(localStorage.getItem(k) ?? '') as T } catch { return d }
  },
  set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } },
}

export const useStore = create<State>(() => ({
  users: {}, usersByName: {}, groups: {}, grades: {}, channels: {}, paths: {}, byPath: {}, dms: {}, recentDms: ls.get('recentDms', []),
  threads: {}, threadsOk: true, clipFolders: [], clipped: {}, onlineUsers: {}, viewers: {}, subscribers: {}, pins: {}, quotes: {}, typing: false,
  stamps: {}, stampsByName: {}, recentStamps: [], palettes: [], unread: {}, stars: [], subs: {},
  // ツリーは毎回すべて閉じた状態から始める
  expanded: {}, messages: {}, hasMore: {}, hasNewer: {}, pending: {},
  toasts: [], palette: false, navOpen: false, online: true,
  theme: ls.get<Theme>('theme', 'system'), notify: ls.get('notify', false),
}))
const applyTheme = (t: Theme) => {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
}
applyTheme(useStore.getState().theme)
export function setTheme(theme: Theme) {
  applyTheme(theme)
  ls.set('theme', theme)
  useStore.setState({ theme })
}
export async function setNotify(on: boolean) {
  if (on && 'Notification' in window && Notification.permission !== 'granted') {
    if ((await Notification.requestPermission()) !== 'granted') on = false
  }
  ls.set('notify', on)
  useStore.setState({ notify: on })
}

/** 凍結済み (停止・一時停止) のユーザー */
export const isGone = (u?: Pick<User, 'state'>) => !!u && u.state !== UserAccountState.active

/** セレクタで「無いとき」に返す空配列。毎回 [] を作ると再描画が止まらない */
export const NONE: never[] = []

const set = useStore.setState
const get = useStore.getState
const byKey = <T,>(list: T[], key: (t: T) => string) => Object.fromEntries(list.map(t => [key(t), t]))

/* ---------- 初期ロード ---------- */

export async function boot() {
  const me = (await api.getMe()).data
  set({ me })
  await Promise.all([loadChannels(), loadUsers(), loadStamps(), loadUnread(), loadStars(),
    loadGroups(),
    api.getMyChannelSubscriptions().then(r => set({ subs: Object.fromEntries(r.data.map(x => [x.channelId, x.level])) })),
    api.getMyStampHistory(48).then(r => set({ recentStamps: r.data.map(h => h.stampId) })),
    api.getOnlineUsers().then(r => set({ onlineUsers: Object.fromEntries(r.data.map(id => [id, true])) })),
    loadClips(), loadPalettes(),
  ])
}

export async function loadChannels() {
  const { public: list, dm = [] } = (await api.getChannels(true)).data
  const channels = byKey(list, c => c.id)
  const paths: Record<string, string> = {}
  const path = (id: string): string =>
    (paths[id] ??= (channels[id].parentId ? path(channels[id].parentId) + '/' : '') + channels[id].name)
  list.forEach(c => path(c.id))
  set({ channels, paths, dms: Object.fromEntries(dm.map(d => [d.id, d.userId])), byPath: Object.fromEntries(Object.entries(paths).map(([k, v]) => [v, k])) })
}
export async function loadGroups() {
  const list = (await api.getUserGroups()).data
  const grades: Record<string, string> = {}
  for (const g of list) if (g.type === 'grade') for (const m of g.members) grades[m.id] ??= g.id
  set({ groups: byKey(list, g => g.id), grades })
}
export async function loadUsers() {
  // 凍結済みも含める。含めないと過去ログの発言者が名無しになる
  const list = (await api.getUsers(true)).data
  set({ users: byKey(list, u => u.id), usersByName: byKey(list, u => u.name) })
}
export async function loadStamps() {
  const list = (await api.getStamps()).data
  set({ stamps: byKey(list, s => s.id), stampsByName: byKey(list, s => s.name) })
}
export async function loadStars() {
  set({ stars: (await api.getMyStars()).data })
}
export async function loadUnread() {
  const list = (await api.getMyUnreadChannels()).data
  set({ unread: byKey(list.filter(u => u.channelId !== get().current), u => u.channelId) })
}

/* ---------- ルーティング ---------- */

export function urlOf(s: State, id: string) {
  if (s.dms[id]) return '/users/' + encodeURIComponent(s.users[s.dms[id]]?.name ?? '')
  return '/channels/' + s.paths[id]
}

/** 投稿欄などに出す宛先名: #チャンネル / @相手 / スレッド名。セレクタからそのまま使える */
export function labelOf(s: State, id: string) {
  if (s.dms[id]) return '@' + (s.users[s.dms[id]]?.name ?? '')
  if (s.threads[id]) return s.threads[id].name
  return '#' + (s.channels[id]?.name ?? '')
}

export function openChannel(id: string, push = true) {
  const s = get()
  if (!s.paths[id] && !s.dms[id]) return
  const url = urlOf(s, id)
  if (push && location.pathname !== url) history.pushState(null, '', url)
  else history.replaceState(null, '', url)
  const recentDms = s.dms[id] ? [id, ...s.recentDms.filter(x => x !== id)].slice(0, 12) : s.recentDms
  // 別のチャンネルのスレッドは閉じる
  const side = s.side?.kind === 'thread' && s.side.parent.channelId !== id ? undefined : s.side
  set({ current: id, settings: undefined, navOpen: false, palette: false, editing: undefined, userCard: undefined, recentDms, side })
  ls.set('last', id)
  ls.set('recentDms', recentDms)
}

export async function openDM(userId: string, push = true) {
  const s = get()
  let id = Object.keys(s.dms).find(k => s.dms[k] === userId)
  if (!id) {
    const dm = (await api.getUserDMChannel(userId)).data
    set(x => ({ dms: { ...x.dms, [dm.id]: dm.userId } }))
    id = dm.id
  }
  openChannel(id, push)
}

export function syncRoute() {
  const s = get()
  const path = decodeURIComponent(location.pathname)
  const st = path.match(/^\/settings(?:\/(\w+))?\/?$/)
  if (st) return openSettings((st[1] as SettingsTab) || 'profile', false)
  const user = path.match(/^\/users\/([^/]+)\/?$/)
  if (user && s.usersByName[user[1]]) return void openDM(s.usersByName[user[1]].id, false)
  const m = path.match(/^\/channels\/(.+?)\/?$/)
  // ルートに来たらホームチャンネルから始める
  const fallback = [path === '/' ? s.me?.homeChannel : undefined, ls.get<string>('last', ''), s.byPath['general'], s.stars[0], Object.keys(s.channels)[0]]
  const id = (m && s.byPath[m[1]]) || fallback.find(x => x && (s.channels[x] || s.dms[x]))
  if (id) openChannel(id, false)
}

export function openSettings(tab: SettingsTab = 'profile', push = true) {
  const url = '/settings/' + tab
  if (push && location.pathname !== url) history.pushState(null, '', url)
  set({ settings: tab, navOpen: false, palette: false, userCard: undefined, side: undefined })
}

export function closeSettings() {
  const id = get().current
  set({ settings: undefined })
  if (id) openChannel(id)
  else syncRoute()
}

export function toggleExpanded(id: string) {
  set(s => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } }))
}

/* ---------- 取り消し可能な操作 ---------- */

type Entry = { id: number; text?: string; undo: () => void; timer?: ReturnType<typeof setTimeout>; left?: number; at?: number }
let stack: Entry[] = []
let seq = 0
export const TOAST_MS = 6000

/** run を即座に実行し、undo を Ctrl+Z とトーストから呼べるようにする */
export function reversible(o: { text?: string; run: () => void; undo: () => void }) {
  o.run()
  const e: Entry = { id: ++seq, text: o.text, undo: o.undo }
  stack = [...stack.slice(-29), e]
  if (e.text) {
    set(s => ({ toasts: [...s.toasts.slice(-2), { id: e.id, text: e.text!, undo: () => undo(e) }] }))
    hold(e.id, false)
  }
}
/** トーストにカーソルが乗っている間は確定までのタイマーを止める */
export function hold(id: number, paused: boolean) {
  const e = stack.find(x => x.id === id)
  if (!e) return
  clearTimeout(e.timer)
  if (paused) e.left = (e.left ?? TOAST_MS) - (Date.now() - e.at!)
  else { e.at = Date.now(); e.timer = setTimeout(() => dismiss(e.id), e.left ?? TOAST_MS) }
}
export function undo(e = stack.at(-1)) {
  if (!e) return
  clearTimeout(e.timer)
  stack = stack.filter(x => x !== e)
  dismiss(e.id)
  e.undo()
}
export function dismiss(id: number) {
  set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
}
export function notifyError(text: string) {
  const id = ++seq
  set(s => ({ toasts: [...s.toasts.slice(-2), { id, text, error: true }] }))
  setTimeout(() => dismiss(id), TOAST_MS)
}

/* ---------- メッセージ ---------- */

const PAGE = 50
const inflight: Record<string, Promise<void>> = {}

/** 最新ページ、または older なら読み込み済みより古いページを取る。同時呼び出しは同じ Promise を返す */
export function loadMessages(cid: string, older = false) {
  const key = cid + (older ? ':older' : '')
  return (inflight[key] ??= (async () => {
    try {
      const until = older ? get().messages[cid]?.find(m => !get().pending[m.id])?.createdAt : undefined
      if (older && !until) return
      // 過去の位置を見ている間は最新ページで上書きしない (loadLatest で戻る)
      if (!older && get().hasNewer[cid]) return
      const data = (await api.getMessages(cid, PAGE, 0, undefined, until, false, 'desc')).data.reverse()
      set(s => {
        const list = s.messages[cid] ?? []
        if (older) return {
          messages: { ...s.messages, [cid]: [...data.filter(m => !list.some(x => x.id === m.id)), ...list] },
          hasMore: { ...s.hasMore, [cid]: data.length === PAGE },
        }
        if (s.hasNewer[cid]) return {}
        // 読み込み済みの古いページと重なるなら残す (ジャンプ直後の再取得や再接続で消さない)
        const i = data.length ? list.findIndex(m => m.id === data[0].id) : -1
        return {
          messages: { ...s.messages, [cid]: [...(i >= 0 ? list.slice(0, i) : []), ...data, ...list.filter(m => s.pending[m.id])] },
          hasMore: { ...s.hasMore, [cid]: i >= 0 ? s.hasMore[cid] : data.length === PAGE },
        }
      })
    } finally { delete inflight[key] }
  })())
}

/** 過去の位置を見ているとき、その続き (新しい側) を取る */
export function loadNewer(cid: string) {
  const key = cid + ':newer'
  return (inflight[key] ??= (async () => {
    try {
      const since = get().messages[cid]?.filter(m => !get().pending[m.id]).at(-1)?.createdAt
      if (!since || !get().hasNewer[cid]) return
      const data = (await api.getMessages(cid, PAGE, 0, since, undefined, false, 'asc')).data
      set(s => {
        const list = s.messages[cid] ?? []
        return {
          messages: { ...s.messages, [cid]: [...list, ...data.filter(m => !list.some(x => x.id === m.id))] },
          hasNewer: { ...s.hasNewer, [cid]: data.length === PAGE },
        }
      })
    } finally { delete inflight[key] }
  })())
}

/** 最新に戻る。過去の位置と最新が繋がっていればそのまま、離れていれば最新ページに置き換わる */
export function loadLatest(cid: string) {
  set(s => ({ hasNewer: { ...s.hasNewer, [cid]: false } }))
  return loadMessages(cid)
}

/** 対象メッセージの前後だけを読み込む (古すぎて遡りきれないとき用) */
async function loadAround(cid: string, createdAt: string) {
  const [before, after] = await Promise.all([
    api.getMessages(cid, PAGE, 0, undefined, createdAt, true, 'desc').then(r => r.data.reverse()),
    api.getMessages(cid, PAGE, 0, createdAt, undefined, false, 'asc').then(r => r.data),
  ])
  set(s => ({
    messages: { ...s.messages, [cid]: [...before, ...after.filter(m => !before.some(b => b.id === m.id))] },
    hasMore: { ...s.hasMore, [cid]: before.length === PAGE },
    hasNewer: { ...s.hasNewer, [cid]: after.length === PAGE },
  }))
}

/** メッセージの位置までタイムラインを移動して強調する */
export async function jumpTo(m: { id: string; channelId: string; createdAt?: string }) {
  const s = get()
  if (!s.channels[m.channelId] && !s.dms[m.channelId]) return notifyError('このメッセージのチャンネルを開けません')
  if (s.current !== m.channelId) openChannel(m.channelId)
  set({ navOpen: false })
  const has = () => !!get().messages[m.channelId]?.some(x => x.id === m.id)
  if (!get().messages[m.channelId]) await loadMessages(m.channelId)
  // 近ければ数ページ遡る。それより古ければ前後だけを直接取る
  for (let n = 0; n < 3 && !has() && get().hasMore[m.channelId]; n++) await loadMessages(m.channelId, true)
  if (!has()) {
    try {
      const createdAt = m.createdAt ?? (await api.getMessage(m.id)).data.createdAt
      await loadAround(m.channelId, createdAt)
    } catch { /* 下で見つからない扱い */ }
  }
  if (!has()) return notifyError('メッセージが見つかりませんでした')
  // 狭い画面ではパネルがタイムラインを覆うので閉じる
  set({ focus: m.id, ...(matchMedia('(max-width: 760px)').matches ? { side: undefined } : {}) })
  setTimeout(() => set(x => (x.focus === m.id ? { focus: undefined } : {})), 2400)
}

export function openSide(side?: Side) {
  // 右パネルはチャンネルの横に出るものなので、設定画面からならチャンネルに戻る
  if (side && get().settings) closeSettings()
  set({ side, palette: false, navOpen: false, userCard: undefined })
}

function patchMessage(id: string, fn: (m: Message) => Message) {
  set(s => {
    for (const [cid, list] of Object.entries(s.messages)) {
      const i = list.findIndex(m => m.id === id)
      if (i >= 0) return { messages: { ...s.messages, [cid]: list.with(i, fn(list[i])) } }
    }
    return {}
  })
}

export function upsertMessage(m: Message) {
  set(s => {
    const list = s.messages[m.channelId]
    if (!list) return {}
    const i = list.findIndex(x => x.id === m.id)
    if (i >= 0) return { messages: { ...s.messages, [m.channelId]: list.with(i, m) } }
    // 過去の位置を見ている間は、新着を末尾に足すと間が詰まって見えるので足さない
    if (s.hasNewer[m.channelId]) return {}
    // 投稿日時の順を保って入れる (通知の到着順は前後しうる)
    let at = list.length
    while (at > 0 && list[at - 1].createdAt > m.createdAt) at--
    return { messages: { ...s.messages, [m.channelId]: list.toSpliced(at, 0, m) } }
  })
}

export function removeMessage(id: string) {
  set(s => ({
    messages: Object.fromEntries(Object.entries(s.messages).map(([cid, list]) => [cid, list.filter(m => m.id !== id)])),
  }))
}

export async function sendMessage(cid: string, content: string, files: File[]) {
  const me = get().me!
  if (get().hasNewer[cid]) await loadLatest(cid)
  const temp: Message = {
    id: 'tmp-' + crypto.randomUUID(), userId: me.id, channelId: cid, content: content || '…',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    pinned: false, stamps: [], threadId: null,
  }
  upsertMessage(temp)
  set(s => ({ pending: { ...s.pending, [temp.id]: true } }))
  try {
    const ids = await Promise.all(files.map(f => api.postFile(f, cid).then(r => r.data.id)))
    const body = [content, ...ids.map(id => `${ORIGIN}/files/${id}`)].filter(Boolean).join('\n')
    const real = (await api.postMessage(cid, { content: body, embed: true })).data
    dropTemp(temp.id)
    upsertMessage(real)
    return true
  } catch {
    dropTemp(temp.id)
    notifyError('送信できませんでした。入力内容は残っています')
    return false
  }
}

function dropTemp(id: string) {
  removeMessage(id)
  set(s => { const { [id]: _, ...pending } = s.pending; return { pending } })
}

export function editMessage(m: Message, content: string) {
  const old = m.content
  if (old === content) return
  const apply = (c: string) => () => {
    patchMessage(m.id, x => ({ ...x, content: c, updatedAt: new Date().toISOString() }))
    api.editMessage(m.id, { content: c }).catch(() => notifyError('編集を保存できませんでした'))
  }
  // 編集はトーストを出さない (⌘Z では戻せる)
  reversible({ run: apply(content), undo: apply(old) })
}

/** 削除はすぐサーバーに送る (取り消しなし)。失敗したら元の位置に戻す */
export function deleteMessage(m: Message) {
  removeMessage(m.id)
  api.deleteMessage(m.id).catch(() => { upsertMessage(m); notifyError('削除できませんでした') })
}

export async function loadPins(cid: string) {
  const list = (await api.getChannelPins(cid)).data.sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt))
  set(s => ({ pins: { ...s.pins, [cid]: list } }))
}

export function togglePin(m: Message) {
  const apply = (v: boolean) => () => {
    patchMessage(m.id, x => ({ ...x, pinned: v }))
    set(s => {
      const list = s.pins[m.channelId]
      if (!list) return {}
      const rest = list.filter(p => p.message.id !== m.id)
      return { pins: { ...s.pins, [m.channelId]: v ? [{ userId: s.me!.id, pinnedAt: new Date().toISOString(), message: { ...m, pinned: true } }, ...rest] : rest } }
    })
    ;(v ? api.createPin(m.id) : api.removePin(m.id)).catch(() => notifyError('ピン留めを変更できませんでした'))
  }
  reversible({ text: m.pinned ? 'ピン留めを外しました' : undefined, run: apply(!m.pinned), undo: apply(m.pinned) })
}

/* ---------- スタンプ ---------- */

export function applyStamp(messageId: string, userId: string, stampId: string, count: number | null) {
  patchMessage(messageId, m => {
    const rest = m.stamps.filter(s => !(s.userId === userId && s.stampId === stampId))
    if (count === null) return { ...m, stamps: rest }
    const now = new Date().toISOString()
    const prev = m.stamps.find(s => s.userId === userId && s.stampId === stampId)
    return { ...m, stamps: [...rest, { userId, stampId, count, createdAt: prev?.createdAt ?? now, updatedAt: now }] }
  })
}

export function toggleStamp(m: Message, stampId: string) {
  const me = get().me!.id
  const mine = get().messages[m.channelId]?.find(x => x.id === m.id)?.stamps
    .find(s => s.userId === me && s.stampId === stampId)
  const add = () => {
    applyStamp(m.id, me, stampId, 1)
    set(s => ({ recentStamps: [stampId, ...s.recentStamps.filter(x => x !== stampId)] }))
    api.addMessageStamp(m.id, stampId).catch(() => notifyError('スタンプを付けられませんでした'))
  }
  const remove = () => {
    applyStamp(m.id, me, stampId, null)
    api.removeMessageStamp(m.id, stampId).catch(() => notifyError('スタンプを外せませんでした'))
  }
  reversible(mine ? { run: remove, undo: add } : { run: add, undo: remove })
}

/* ---------- チャンネル ---------- */

export function toggleStar(cid: string) {
  const starred = get().stars.includes(cid)
  const apply = (v: boolean) => () => {
    set(s => ({ stars: v ? [...s.stars, cid] : s.stars.filter(x => x !== cid) }))
    ;(v ? api.addMyStar({ channelId: cid }) : api.removeMyStar(cid)).catch(() => notifyError('お気に入りを変更できませんでした'))
  }
  reversible({
    text: starred ? `#${get().channels[cid]?.name} をお気に入りから外しました` : undefined,
    run: apply(!starred), undo: apply(starred),
  })
}

const SUB_TEXT = ['通知をオフにしました', '未読のみ通知します', 'すべて通知します']

/** 購読レベル 0:なし → 1:未読のみ → 2:通知 → 0 と巡回 */
export function cycleSubscription(cid: string) {
  const old = get().subs[cid] ?? 0
  const apply = (level: number) => () => {
    set(s => ({ subs: { ...s.subs, [cid]: level } }))
    api.setChannelSubscribeLevel(cid, { level: level as ChannelSubscribeLevel }).catch(() => notifyError('通知設定を変更できませんでした'))
  }
  const next = (old + 1) % 3
  reversible({ text: SUB_TEXT[next], run: apply(next), undo: apply(old) })
}

/* ---------- スレッド (feat/thread) ---------- */

export async function loadThreads(cid: string) {
  if (!get().threadsOk || !get().channels[cid]) return
  try {
    const list = await rest<ThreadChannel[]>('GET', `/channels/${cid}/threads?limit=100`)
    set(s => ({ threads: { ...Object.fromEntries(Object.entries(s.threads).filter(([, t]) => t.parentChannelId !== cid)), ...byKey(list, t => t.id) } }))
  } catch (r) {
    if (r instanceof Response && r.status === 404) set({ threadsOk: false })
  }
}

export const threadOf = (messageId: string) => Object.values(get().threads).find(t => t.parentMessageId === messageId)

export function openThread(parent: Message) {
  openSide({ kind: 'thread', id: threadOf(parent.id)?.id, parent })
  set({ editing: undefined })
}

/** 下書きのスレッドに最初の投稿をしたときに作る。取り消しはアーカイブ */
export async function createThread(parent: Message, name: string) {
  const t = await rest<ThreadChannel>('POST', '/threads', { name, parentMessageId: parent.id })
  set(s => ({ threads: { ...s.threads, [t.id]: t }, messages: { ...s.messages, [t.id]: [] }, hasMore: { ...s.hasMore, [t.id]: false },
    side: s.side?.kind === 'thread' && s.side.parent.id === parent.id ? { ...s.side, id: t.id } : s.side }))
  return t
}

function patchThread(id: string, patch: Partial<ThreadChannel>, error: string) {
  set(s => ({ threads: { ...s.threads, [id]: { ...s.threads[id], ...patch } } }))
  rest('PATCH', `/threads/${id}`, patch).catch(() => notifyError(error))
}

export function renameThread(id: string, name: string) {
  const old = get().threads[id]?.name
  if (!old || !name || old === name) return
  reversible({
    run: () => patchThread(id, { name }, 'スレッド名を変更できませんでした'),
    undo: () => patchThread(id, { name: old }, 'スレッド名を戻せませんでした'),
  })
}

export function archiveThread(id: string, silent = false) {
  const apply = (archived: boolean) => () => {
    patchThread(id, { archived }, 'スレッドのアーカイブを変更できませんでした')
    if (archived) set(s => ({ side: s.side?.kind === 'thread' && s.side.id === id ? undefined : s.side }))
  }
  reversible({ text: silent ? undefined : `「${get().threads[id]?.name}」をアーカイブしました`, run: apply(true), undo: apply(false) })
}

/* ---------- クリップ ---------- */

export async function loadClips() {
  const folders = (await api.getClipFolders()).data.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  set({ clipFolders: folders })
  if (!folders[0]) return
  const clips = (await api.getClips(folders[0].id, 200)).data
  set({ clipped: Object.fromEntries(clips.map(c => [c.message.id, folders[0].id])) })
}

async function defaultFolder() {
  const f = get().clipFolders[0]
  if (f) return f.id
  const created = (await api.createClipFolder({ name: 'クリップ', description: '' })).data
  set(s => ({ clipFolders: [...s.clipFolders, created] }))
  return created.id
}

export function toggleClip(m: Message) {
  const folder = get().clipped[m.id]
  const mark = (fid?: string) => set(s => {
    const { [m.id]: _, ...rest } = s.clipped
    return { clipped: fid ? { ...rest, [m.id]: fid } : rest }
  })
  const add = () => {
    mark('…')
    defaultFolder()
      .then(fid => api.clipMessage(fid, { messageId: m.id }).then(() => mark(fid)))
      .catch(() => { mark(); notifyError('クリップできませんでした') })
  }
  const remove = (fid: string) => () => {
    mark()
    api.unclipMessage(fid, m.id).catch(() => { mark(fid); notifyError('クリップを外せませんでした') })
  }
  if (folder) reversible({ text: 'クリップを外しました', run: remove(folder), undo: add })
  else reversible({ run: add, undo: () => { const f = get().clipped[m.id]; if (f && f !== '…') remove(f)() } })
}

/* ---------- プロフィール・チャンネル編集 ---------- */

type ProfilePatch = { displayName?: string; bio?: string; twitterId?: string; homeChannel?: string | null }
const NIL = '00000000-0000-0000-0000-000000000000'

export function editProfile(patch: ProfilePatch, text = 'プロフィールを更新しました') {
  const me = get().me!
  const old = Object.fromEntries(Object.keys(patch).map(k => [k, me[k as keyof ProfilePatch] ?? null])) as ProfilePatch
  const apply = (p: ProfilePatch) => () => {
    set(s => ({ me: s.me && { ...s.me, ...p }, users: { ...s.users, [s.me!.id]: { ...s.users[s.me!.id], ...p } } }))
    // homeChannel を外すときは nil UUID を送る
    const { homeChannel, ...rest } = p
    api.editMe('homeChannel' in p ? { ...rest, homeChannel: homeChannel ?? NIL } : rest).catch(() => notifyError('プロフィールを保存できませんでした'))
  }
  reversible({ text, run: apply(patch), undo: apply(old) })
}

export function setHome(cid: string | null) {
  editProfile({ homeChannel: cid }, cid ? `#${get().channels[cid]?.name} をホームにしました` : 'ホームを解除しました')
}

export async function changeIcon(file: File) {
  const me = get().me!
  // 取り消せるよう、いまのアイコンを手元に持っておく
  const old = await fetch(fileUrl(me.iconFileId)).then(r => r.blob()).catch(() => undefined)
  // アイコンのファイル ID が変わるので、自分とユーザー一覧を取り直せば表示も変わる
  const refresh = async () => { set({ me: (await api.getMe()).data }); await loadUsers() }
  const put = (f: Blob) => api.changeMyIcon(f as File).then(refresh, () => notifyError('アイコンを変更できませんでした'))
  await put(file)
  if (old) reversible({ text: 'アイコンを変更しました', run: () => {}, undo: () => void put(new File([old], 'icon.png', { type: old.type })) })
}

export function editTopic(cid: string, topic: string) {
  const old = get().channels[cid]?.topic ?? ''
  if (old === topic) return
  const apply = (t: string) => () => {
    set(s => ({ channels: { ...s.channels, [cid]: { ...s.channels[cid], topic: t } } }))
    api.editChannelTopic(cid, { topic: t }).catch(() => notifyError('トピックを変更できませんでした'))
  }
  reversible({ text: 'トピックを変更しました', run: apply(topic), undo: apply(old) })
}

export const CHANNEL_NAME = /^[a-zA-Z0-9_-]{1,20}$/

export async function createChannel(name: string, parent: string | null) {
  const c = (await api.createChannel({ name, parent })).data
  await loadChannels()
  openChannel(c.id)
}

/* ---------- スタンプパレット ---------- */

// API の型は Set<string> だが JSON では配列でやりとりする
type StampList = Set<string>
const asList = (a: string[]) => a as unknown as StampList

export async function loadPalettes() {
  const list = (await api.getStampPalettes()).data
  const me = get().me?.id
  set({
    palettes: list.filter(p => p.creatorId === me).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(p => ({ id: p.id, name: p.name, description: p.description, stamps: [...(p.stamps as unknown as string[])] })),
  })
}

function patchPaletteLocal(id: string, patch: Partial<Palette>) {
  set(s => ({ palettes: s.palettes.map(p => (p.id === id ? { ...p, ...patch } : p)) }))
}

/** 名前・並び・中身の変更。トーストは出さず ⌘Z で戻せる */
export function editPalette(id: string, patch: Partial<Pick<Palette, 'name' | 'stamps'>>, text?: string) {
  const cur = get().palettes.find(p => p.id === id)
  if (!cur) return
  const old = Object.fromEntries(Object.keys(patch).map(k => [k, cur[k as keyof Palette]])) as typeof patch
  const apply = (p: typeof patch) => () => {
    patchPaletteLocal(id, p)
    api.editStampPalette(id, { name: p.name, stamps: p.stamps && asList(p.stamps) })
      .catch(() => notifyError('パレットを保存できませんでした'))
  }
  reversible({ text, run: apply(patch), undo: apply(old) })
}

export function toggleInPalette(id: string, stampId: string) {
  const p = get().palettes.find(x => x.id === id)
  if (!p) return
  if (p.stamps.includes(stampId)) editPalette(id, { stamps: p.stamps.filter(x => x !== stampId) })
  else if (p.stamps.length >= 200) notifyError('パレットに入れられるのは 200 個までです')
  else editPalette(id, { stamps: [...p.stamps, stampId] })
}

export async function createPalette(stamps: string[] = []) {
  const n = get().palettes.length + 1
  const p = (await api.createStampPalette({ name: `パレット ${n}`, description: '', stamps: asList(stamps) })).data
  const pal = { id: p.id, name: p.name, description: p.description, stamps }
  set(s => ({ palettes: [...s.palettes, pal] }))
  return pal.id
}

export function deletePalette(id: string) {
  const s0 = get().palettes
  const idx = s0.findIndex(p => p.id === id)
  const pal = s0[idx]
  if (!pal) return
  set(s => ({ palettes: s.palettes.filter(p => p.id !== id) }))
  api.deleteStampPalette(id).catch(() => {
    set(s => ({ palettes: s.palettes.toSpliced(idx, 0, pal) }))
    notifyError('パレットを削除できませんでした')
  })
}

/** 自分のタグの付け外し。取り消しは逆の操作 */
export function toggleMyTag(tag: string, tagId: string, mine: boolean) {
  const add = () => api.addMyUserTag({ tag }).then(r => set(s => ({
    me: s.me && { ...s.me, tags: [...s.me.tags.filter(t => t.tagId !== r.data.tagId), r.data] },
  })), () => notifyError('タグを付けられませんでした'))
  const remove = () => {
    set(s => ({ me: s.me && { ...s.me, tags: s.me.tags.filter(t => t.tagId !== tagId) } }))
    api.removeMyUserTag(tagId).catch(() => notifyError('タグを外せませんでした'))
  }
  reversible(mine ? { text: `タグ「${tag}」を外しました`, run: remove, undo: () => void add() } : { run: () => void add(), undo: remove })
}

export async function loadSubscribers(cid: string) {
  const list = (await api.getChannelSubscribers(cid)).data
  set(s => ({ subscribers: { ...s.subscribers, [cid]: list } }))
}

export async function loadViewers(cid: string) {
  try {
    const v = (await api.getChannelViewers(cid)).data
    set(s => ({ viewers: { ...s.viewers, [cid]: v.map(x => ({ userId: x.userId, state: x.state })) } }))
  } catch { /* DM などで取れなくても表示に困らない */ }
}

/* ---------- ユーザーグループの管理 (グループ管理者のみサーバーが許可する) ---------- */

export const GROUP_NAME = /^[^@＠#＃:： 　]{1,30}$/

function patchGroupLocal(id: string, fn: (g: UserGroup) => UserGroup) {
  set(s => (s.groups[id] ? { groups: { ...s.groups, [id]: fn(s.groups[id]) } } : {}))
}
const fail = (text: string) => () => { notifyError(text); loadGroups() }

export async function createGroup(name: string) {
  const g = (await api.createUserGroup({ name, description: '', type: '' })).data
  set(s => ({ groups: { ...s.groups, [g.id]: g } }))
  reversible({
    text: `グループ「${name}」を作成しました`,
    run: () => {},
    undo: () => {
      set(s => { const { [g.id]: _, ...groups } = s.groups; return { groups, side: s.side?.kind === 'group' && s.side.groupId === g.id ? s.side.back : s.side } })
      api.deleteUserGroup(g.id).catch(fail('グループを削除できませんでした'))
    },
  })
  return g.id
}

export function editGroup(id: string, patch: { name?: string; description?: string; type?: string }) {
  const g = get().groups[id]
  if (!g) return
  const old = Object.fromEntries(Object.keys(patch).map(k => [k, g[k as keyof typeof patch]])) as typeof patch
  const apply = (p: typeof patch) => () => {
    patchGroupLocal(id, x => ({ ...x, ...p }))
    api.editUserGroup(id, p).catch(fail('グループを変更できませんでした'))
  }
  reversible({ text: 'グループを変更しました', run: apply(patch), undo: apply(old) })
}

export async function changeGroupIcon(id: string, file: File) {
  const oldIcon = get().groups[id]?.icon
  const old = oldIcon ? await fetch(fileUrl(oldIcon)).then(r => r.blob()).catch(() => undefined) : undefined
  const put = (f: Blob) => api.changeUserGroupIcon(id, f as File).then(() => loadGroups(), fail('アイコンを変更できませんでした'))
  await put(file)
  if (old) reversible({ text: 'グループのアイコンを変更しました', run: () => {}, undo: () => void put(new File([old], 'icon.png', { type: old.type })) })
}

export function addGroupMember(id: string, userId: string, role = '') {
  const add = () => {
    patchGroupLocal(id, g => ({ ...g, members: [...g.members.filter(m => m.id !== userId), { id: userId, role }] }))
    api.addUserGroupMember(id, { id: userId, role }).catch(fail('メンバーを追加できませんでした'))
  }
  const remove = () => {
    patchGroupLocal(id, g => ({ ...g, members: g.members.filter(m => m.id !== userId) }))
    api.removeUserGroupMember(id, userId).catch(fail('メンバーを外せませんでした'))
  }
  reversible({ run: add, undo: remove })
}

export function removeGroupMember(id: string, userId: string) {
  const role = get().groups[id]?.members.find(m => m.id === userId)?.role ?? ''
  const name = get().users[userId]?.name
  const remove = () => {
    patchGroupLocal(id, g => ({ ...g, members: g.members.filter(m => m.id !== userId) }))
    api.removeUserGroupMember(id, userId).catch(fail('メンバーを外せませんでした'))
  }
  const add = () => {
    patchGroupLocal(id, g => ({ ...g, members: [...g.members, { id: userId, role }] }))
    api.addUserGroupMember(id, { id: userId, role }).catch(fail('メンバーを戻せませんでした'))
  }
  reversible({ text: `@${name} をグループから外しました`, run: remove, undo: add })
}

export function setGroupRole(id: string, userId: string, role: string) {
  const old = get().groups[id]?.members.find(m => m.id === userId)?.role ?? ''
  if (old === role) return
  const apply = (r: string) => () => {
    patchGroupLocal(id, g => ({ ...g, members: g.members.map(m => (m.id === userId ? { ...m, role: r } : m)) }))
    api.editUserGroupMember(id, userId, { role: r }).catch(fail('役割を変更できませんでした'))
  }
  reversible({ run: apply(role), undo: apply(old) })
}

export function toggleGroupAdmin(id: string, userId: string) {
  const isAdmin = !!get().groups[id]?.admins.includes(userId)
  const apply = (on: boolean) => () => {
    patchGroupLocal(id, g => ({ ...g, admins: on ? [...new Set([...g.admins, userId])] : g.admins.filter(a => a !== userId) }))
    ;(on ? api.addUserGroupAdmin(id, { id: userId }) : api.removeUserGroupAdmin(id, userId))
      .catch(fail(on ? '管理者にできませんでした' : '管理者から外せませんでした (最後の管理者は外せません)'))
  }
  reversible({ text: isAdmin ? `@${get().users[userId]?.name} を管理者から外しました` : undefined, run: apply(!isAdmin), undo: apply(isAdmin) })
}

export function deleteGroup(id: string) {
  const g = get().groups[id]
  if (!g) return
  set(s => {
    const { [id]: _, ...groups } = s.groups
    return { groups, side: s.side?.kind === 'group' && s.side.groupId === id ? s.side.back : s.side }
  })
  api.deleteUserGroup(id).catch(() => {
    set(s => ({ groups: { ...s.groups, [id]: g } }))
    notifyError('グループを削除できませんでした')
  })
}

/** 引用は本文とは別に積み、送るときに本文の末尾へ付ける (traQ は末尾の URL だけを埋め込みにする) */
export function addQuote(cid: string, messageId: string) {
  set(s => ({ quotes: { ...s.quotes, [cid]: [...new Set([...(s.quotes[cid] ?? []), messageId])] } }))
}
export function setQuotes(cid: string, ids: string[]) {
  set(s => ({ quotes: { ...s.quotes, [cid]: ids } }))
}

export function markRead(cid: string) {
  if (!get().unread[cid]) return
  set(s => { const { [cid]: _, ...unread } = s.unread; return { unread } })
  api.readChannel(cid).catch(() => {})
}

export function openPicker(el: Element, onPick: (id: string) => void, opts?: Pick<Picker, 'multi' | 'selected'>) {
  set({ picker: { id: ++seq, rect: el.getBoundingClientRect(), onPick, ...opts } })
}
