import { useRef, useState, type ReactNode } from 'react'
import { Activity, Bookmark, CheckCheck, UserSearch, ChevronRight, Hash, Home, Plus, Search, Settings, Star } from 'lucide-react'
import { userIcon } from './api'
import { showUser } from './Message'
import { CHANNEL_NAME, createChannel, isGone, notifyError, openChannel, openSettings, openSide, toggleExpanded, useStore } from './store'

const isMac = navigator.platform.startsWith('Mac')
type View = 'home' | 'channels'
const savedView = (): View => { try { return localStorage.getItem('sideView') === 'channels' ? 'channels' : 'home' } catch { return 'home' } }

export function Sidebar() {
  const me = useStore(s => s.me)!
  const channels = useStore(s => s.channels)
  const stars = useStore(s => s.stars)
  const roots = Object.values(channels)
    .filter(c => !c.parentId && !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
  const side = useStore(s => s.side?.kind)
  const settingsOpen = useStore(s => s.settings)
  const current = useStore(s => s.current)
  const [addingRoot, setAddingRoot] = useState(false)
  const [view, setViewState] = useState(savedView)
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem('sideView', v) } catch { /* */ } }
  const starred = stars.filter(id => channels[id]).sort((a, b) => channels[a].name.localeCompare(channels[b].name))

  return (
    <aside className="side">
      <div className="side-top">
        <button className="me" onClick={e => showUser(me.id, e.currentTarget)}>
          <img className="avatar sm" src={userIcon(me)} alt="" />
          <span>{me.displayName}</span>
        </button>
        <button className="icon-btn" title="設定" aria-pressed={!!settingsOpen} onClick={() => openSettings()}><Settings size={17} /></button>
      </div>
      <button className="search" onClick={() => useStore.setState({ palette: true })}>
        <Search size={15} /> <span>チャンネルへ移動</span> <kbd>{isMac ? '⌘' : 'Ctrl+'}K</kbd>
      </button>
      <div className="quick-nav">
        <button title="ホーム" aria-pressed={view === 'home'} onClick={() => setView('home')}><Home size={17} /></button>
        <button title="すべてのチャンネル" aria-pressed={view === 'channels'} onClick={() => setView('channels')}><Hash size={17} /></button>
        <button title="アクティビティ" aria-pressed={side === 'activity'}
          onClick={() => openSide(side === 'activity' ? undefined : { kind: 'activity' })}><Activity size={17} /></button>
        <button title="クリップ" aria-pressed={side === 'clips'}
          onClick={() => openSide(side === 'clips' ? undefined : { kind: 'clips' })}><Bookmark size={17} /></button>
        <button title="ユーザーを検索" aria-pressed={side === 'users'}
          onClick={() => openSide(side === 'users' ? undefined : { kind: 'users', q: '' })}><UserSearch size={17} /></button>
      </div>
      {view === 'home' ? <HomeView current={current} /> : <nav className="tree">
        {starred.length > 0 && (
          <section className="stars" aria-label="お気に入り">
            <StarTree ids={starred} />
          </section>
        )}
        <section>
          {roots.map(c => <Row key={c.id} id={c.id} depth={0} />)}
          {addingRoot ? <NewChannel parent={null} depth={0} onDone={() => setAddingRoot(false)} />
            : <button className="row add-root" title="チャンネルを作成" onClick={() => setAddingRoot(true)}><span className="chev"><Plus size={14} /></span></button>}
        </section>
      </nav>}
    </aside>
  )
}

function useHasUnread() {
  const channels = useStore(s => s.channels)
  const unread = useStore(s => s.unread)
  // 0: なし 1: 未読 2: メンションあり
  const level = (id: string): number =>
    Math.max(unread[id] ? (unread[id].noticeable ? 2 : 1) : 0, ...(channels[id]?.children ?? []).map(level))
  return level
}

/** ホーム: ホームチャンネルと、通知が来ている (未読がある) チャンネルと DM だけ */
function HomeView({ current }: { current?: string }) {
  const channels = useStore(s => s.channels)
  const unread = useStore(s => s.unread)
  const subs = useStore(s => s.subs)
  const home = useStore(s => (s.me?.homeChannel && s.channels[s.me.homeChannel] ? s.me.homeChannel : undefined))
  // 開いた瞬間に既読になって行が消えると迷子になるので、いま開いているものは離れるまで残す
  const keep = useRef<string | undefined>(undefined)
  if (current !== keep.current) keep.current = current && unread[current] ? current : undefined
  // 未読はすべて。メンション・引用・通知オンのものを上にまとめ、その下に普通の未読
  const loud = (id: string) => !!unread[id] && (unread[id].noticeable || subs[id] === 2)
  const ids = Object.keys(unread)
    .filter(id => channels[id] && id !== home)
    .sort((a, b) => (+loud(b) - +loud(a)) || unread[b].updatedAt.localeCompare(unread[a].updatedAt))
  if (keep.current && channels[keep.current] && !ids.includes(keep.current) && keep.current !== home) ids.unshift(keep.current)

  return (
    <nav className="tree">
      <section>
        {/* ホームは子チャンネルを開けるよう木として出す。どこにあるかは親を薄く添える */}
        {home ? <Row id={home} depth={0} showPath />
          : <button className="row add-home" onClick={() => openSettings('profile')}><span className="chev"><Home size={13} /></span>ホームを設定</button>}
      </section>
      <DmStrip />
      <section>
        {ids.map((id, i) => (
          <div key={id} className={i > 0 && unread[id] && !loud(id) && loud(ids[i - 1]) ? 'quiet-start' : undefined}>
            <Row id={id} depth={0} flat glyph={<Hash size={13} />} />
          </div>
        ))}
        {!ids.length && <div className="all-read" title="未読はありません"><CheckCheck size={40} /></div>}
      </section>
    </nav>
  )
}

function Row({ id, depth, flat, glyph, showPath }: { id: string; depth: number; flat?: boolean; glyph?: ReactNode; showPath?: boolean }) {
  const c = useStore(s => s.channels[id])
  const channels = useStore(s => s.channels)
  const path = useStore(s => s.paths[id])
  const active = useStore(s => s.current === id && !s.settings)
  const open = useStore(s => !!s.expanded[id])
  const u = useStore(s => s.unread[id])
  const unreadLevel = useHasUnread()
  const kids = flat ? [] : c.children.filter(k => channels[k] && !channels[k].archived)
    .sort((a, b) => channels[a].name.localeCompare(channels[b].name))
  const hiddenUnread = open ? 0 : Math.max(0, ...kids.map(unreadLevel))
  // 閉じた親の中に今いるチャンネルがあれば、親を強調して居場所を示す
  const holdsCurrent = useStore(s => {
    if (open) return false
    for (let p = s.channels[s.current ?? '']?.parentId; p; p = s.channels[p]?.parentId) if (p === id) return !s.settings
    return false
  })
  const parents = path.split('/').slice(0, -1)
  const [adding, setAdding] = useState(false)
  const isHome = useStore(s => s.me?.homeChannel === id)

  return (
    <>
      <div className={'row' + (active ? ' active' : '') + (holdsCurrent ? ' holds-current' : '') + (u ? ' unread' : '')} style={{ '--d': depth } as React.CSSProperties}>
        {flat ? <span className={'chev' + (glyph ? '' : ' starred')}>{glyph ?? <Star size={13} />}</span> : kids.length > 0 ? (
          <button className="chev" aria-expanded={open} aria-label={c.name + ' の子チャンネル'} onClick={() => toggleExpanded(id)}>
            <ChevronRight size={14} />
          </button>
        ) : <span className="chev"><Hash size={13} /></span>}
        <a href={'/channels/' + path} onClick={e => { e.preventDefault(); openChannel(id) }}>
          {(flat || showPath) && parents.length > 0 && <span className="ancestors">{parents.join('/')}/</span>}
          <span className="name">{c.name}</span>
          {isHome && !glyph && <Home size={12} className="home-mark" aria-label="ホーム" />}
        </a>
        {u ? <span className={'badge' + (u.noticeable ? ' mention' : '')}>{u.count > 99 ? '99+' : u.count}</span>
          : hiddenUnread > 0 && <span className={'dot' + (hiddenUnread > 1 ? ' mention' : '')} />}
        {!flat && (
          <button className="row-add" title="子チャンネルを作成"
            onClick={() => { setAdding(true); if (!open && kids.length) toggleExpanded(id) }}><Plus size={14} /></button>
        )}
      </div>
      {((open && kids.length > 0) || adding) && (
        <div className="kids" style={{ '--d': depth } as React.CSSProperties}>
          {adding && <NewChannel parent={id} depth={depth + 1} onDone={() => setAdding(false)} />}
          {open && kids.map(k => <Row key={k} id={k} depth={depth + 1} />)}
        </div>
      )}
    </>
  )
}

/**
 * お気に入りを木にまとめる。お気に入りとその祖先だけを残し、
 * 分岐しない祖先の連なり (gps/times など) は1行に畳む
 */
function StarTree({ ids }: { ids: string[] }) {
  const channels = useStore(s => s.channels)
  const starred = new Set(ids)
  const keep = new Set<string>()
  for (const id of ids) for (let p: string | null | undefined = id; p && !keep.has(p); p = channels[p]?.parentId) keep.add(p)
  const kids = (id: string) => channels[id].children.filter(k => keep.has(k)).sort((a, b) => channels[a].name.localeCompare(channels[b].name))
  const roots = [...keep].filter(id => !channels[id].parentId || !keep.has(channels[id].parentId!))
    .sort((a, b) => channels[a].name.localeCompare(channels[b].name))
  return <>{roots.map(id => <StarNode key={id} id={id} depth={0} starred={starred} kids={kids} />)}</>
}

function StarNode({ id, depth, starred, kids }: { id: string; depth: number; starred: Set<string>; kids: (id: string) => string[] }) {
  const channels = useStore(s => s.channels)
  // お気に入りでも分岐点でもない祖先は、子が1つなら次とまとめる
  const chain = [id]
  while (!starred.has(chain.at(-1)!) && kids(chain.at(-1)!).length === 1) chain.push(kids(chain.at(-1)!)[0])
  const last = chain.at(-1)!
  const children = kids(last)
  const [open, setOpen] = useState(true)
  const isStar = starred.has(last)
  const active = useStore(s => s.current === last && !s.settings)
  const u = useStore(s => s.unread[last])
  const path = useStore(s => s.paths[last])
  return (
    <>
      <div className={'row' + (active ? ' active' : '') + (u ? ' unread' : '') + (isStar ? '' : ' star-branch')}
        style={{ '--d': depth } as React.CSSProperties}>
        {children.length > 0 ? (
          <button className="chev" aria-expanded={open} onClick={() => setOpen(o => !o)}><ChevronRight size={14} /></button>
        ) : <span className={'chev' + (isStar ? ' starred' : '')}><Star size={13} /></span>}
        <a href={'/channels/' + path} onClick={e => { e.preventDefault(); openChannel(last) }}>
          {chain.length > 1 && <span className="ancestors">{chain.slice(0, -1).map(c => channels[c].name).join('/')}/</span>}
          <span className="name">{channels[last].name}</span>
          {isStar && children.length > 0 && <Star size={11} className="star-inline" aria-label="お気に入り" />}
        </a>
        {u && <span className={'badge' + (u.noticeable ? ' mention' : '')}>{u.count > 99 ? '99+' : u.count}</span>}
      </div>
      {open && children.length > 0 && (
        <div className="kids" style={{ '--d': depth } as React.CSSProperties}>
          {children.map(k => <StarNode key={k} id={k} depth={depth + 1} starred={starred} kids={kids} />)}
        </div>
      )}
    </>
  )
}

/** 未読のある DM と最近開いた DM をアイコンで並べる */
function DmStrip() {
  const dms = useStore(s => s.dms)
  const users = useStore(s => s.users)
  const unread = useStore(s => s.unread)
  const recent = useStore(s => s.recentDms)
  const current = useStore(s => s.current)
  const online = useStore(s => s.onlineUsers)
  const ids = [...new Set([
    ...Object.keys(dms).filter(id => unread[id]).sort((a, b) => unread[b].updatedAt.localeCompare(unread[a].updatedAt)),
    ...recent.filter(id => dms[id]),
  ])].slice(0, 12)
  return (
    <section className="dm-strip" aria-label="ダイレクトメッセージ">
      {ids.map(id => {
        const u = users[dms[id]]
        return (
          <a key={id} href={'/users/' + encodeURIComponent(u?.name ?? '')} title={u?.displayName} className={id === current ? 'active' : ''}
            onClick={e => { e.preventDefault(); openChannel(id) }}>
            <img className={'avatar' + (isGone(u) ? ' gone' : '')} src={userIcon(u)} alt={u?.name} />
            {online[dms[id]] && <span className="online" />}
            {unread[id] && <span className="badge mention">{unread[id].count}</span>}
          </a>
        )
      })}
      <button className="dm-new" title="DM を始める" onClick={() => useStore.setState({ palette: '@' })}><Plus size={18} /></button>
    </section>
  )
}

/** ツリーの中にそのまま出る新規チャンネル名の入力欄 */
function NewChannel({ parent, depth, onDone }: { parent: string | null; depth: number; onDone: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const bad = name !== '' && !CHANNEL_NAME.test(name)
  const submit = async () => {
    if (!name || bad) return
    setBusy(true)
    try { await createChannel(name, parent); onDone() } catch {
      notifyError('チャンネルを作成できませんでした。同じ名前が無いか確認してください')
      setBusy(false)
    }
  }
  return (
    <div className={'row new-channel' + (bad ? ' bad' : '')} style={{ '--d': depth } as React.CSSProperties}>
      <span className="chev"><Hash size={13} /></span>
      <input autoFocus value={name} disabled={busy} maxLength={20} aria-invalid={bad} placeholder="new-channel"
        onChange={e => setName(e.target.value)}
        onBlur={() => { if (!name) onDone() }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          if (e.key === 'Escape') onDone()
        }} />
      {busy && <span className="spinner" />}
    </div>
  )
}
