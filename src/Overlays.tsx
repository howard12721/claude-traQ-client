import { useMemo, useState, type CSSProperties } from 'react'
import { UserAccountState, type User } from '@traptitech/traq'
import { Clock, Hash, IdCard, LayoutGrid, MessageCircle, Search, Settings, Settings2, SmilePlus, Star, Undo2, X } from 'lucide-react'
import { fileUrl, userIcon } from './api'
import { dismiss, hold, isGone, openChannel, openDM, openSettings, openSide, TOAST_MS, useStore } from './store'
import { GoneTag, GradeBadge } from './Message'
import { Bio, useUserDetail } from './Panels'

const isMac = navigator.platform.startsWith('Mac')

/* ---------- チャンネル移動 (⌘K) ---------- */

const subseq = (s: string, q: string) => { let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length }

export function Palette() {
  const p = useStore(s => s.palette)
  return p === false ? null : <PaletteInner initial={p === true ? '' : p} />
}

function PaletteInner({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial)
  const [sel, setSel] = useState(0)
  const { paths, channels, stars, unread, users } = useStore()
  const close = () => useStore.setState({ palette: false })
  // `@` で始めるとユーザー (DM) だけ、それ以外はチャンネル優先でユーザーも混ぜる
  const results = useMemo(() => {
    const onlyUsers = q.startsWith('@')
    const ql = q.toLowerCase().replace(/^[#@]/, '')
    const rank = (full: string, leaf: string) =>
      leaf === ql ? -8 : leaf.startsWith(ql) ? -4 : full.includes(ql) ? -2 : 0
    const chs = onlyUsers ? [] : Object.entries(paths)
      .filter(([id, p]) => !channels[id].archived && subseq(p.toLowerCase(), ql))
      .map(([id, p]) => {
        const lp = p.toLowerCase()
        const score = rank(lp, lp.split('/').at(-1)!) + (stars.includes(id) ? -1.5 : 0) + (unread[id] ? -1 : 0) + p.length / 100
        return { kind: 'ch' as const, id, p, score }
      })
    const us = !ql && !onlyUsers ? [] : Object.values(users)
      .filter(u => u.state === UserAccountState.active && (subseq(u.name.toLowerCase(), ql) || u.displayName.toLowerCase().includes(ql)))
      .map(u => ({ kind: 'user' as const, id: u.id, p: u.name, score: rank(u.name.toLowerCase(), u.name.toLowerCase()) + (onlyUsers ? 0 : 2) + u.name.length / 100 }))
    const found = [...chs, ...us].sort((a, b) => a.score - b.score).slice(0, 40)
    // 最後の行はいつでも「この語でメッセージを検索」
    return ql && !onlyUsers ? [...found, { kind: 'search' as const, id: 'search', p: q.trim(), score: 0 }] : found
  }, [q, paths, channels, stars, unread, users])
  const i = Math.min(sel, results.length - 1)
  const go = (r: (typeof results)[number]) =>
    r.kind === 'ch' ? openChannel(r.id) : r.kind === 'user' ? openDM(r.id) : openSide({ kind: 'search', q: r.p })

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="palette" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="チャンネルへ移動">
        <label className="palette-input">
          <Search size={18} />
          <input autoFocus value={q} placeholder="チャンネル名 / @ユーザー" onChange={e => { setQ(e.target.value); setSel(0) }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
              } else if (e.key === 'Enter' && results[i]) { e.preventDefault(); go(results[i]) }
              else if (e.key === 'Escape') close()
            }} />
          <kbd>esc</kbd>
        </label>
        <ul role="listbox">
          {results.map((r, j) => {
            const segs = r.p.split('/')
            const attrs = {
              role: 'option', 'aria-selected': j === i, onMouseEnter: () => setSel(j), onClick: () => go(r),
              ref: j === i ? (el: HTMLLIElement | null) => el?.scrollIntoView({ block: 'nearest' }) : undefined,
            }
            if (r.kind === 'search') return (
              <li key="search" className="search-row" {...attrs}>
                <Search size={15} className="faint" /><b>{r.p}</b>
              </li>
            )
            if (r.kind === 'user') return (
              <li key={r.id} {...attrs}>
                <img className="avatar xs" src={userIcon(users[r.id])} alt="" />
                <b>{users[r.id].displayName}</b>
                <span className="faint">@{r.p}</span>
                <span className="grow" />
                <MessageCircle size={14} className="faint" />
              </li>
            )
            return (
              <li key={r.id} {...attrs}>
                <Hash size={15} className="faint" />
                <span className="ancestors">{segs.slice(0, -1).map(s => s + '/').join('')}</span>
                <b>{segs.at(-1)}</b>
                <span className="grow" />
                {stars.includes(r.id) && <Star size={13} className="star-mark" />}
                {unread[r.id] && <span className={'badge' + (unread[r.id].noticeable ? ' mention' : '')}>{unread[r.id].count}</span>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/* ---------- スタンプピッカー ---------- */

export function StampPicker() {
  const picker = useStore(s => s.picker)
  return picker ? <PickerInner key={picker.id} /> : null
}

type Tab = 'recent' | 'all' | string
const savedTab = (): Tab => { try { return localStorage.getItem('pickerTab') ?? 'recent' } catch { return 'recent' } }

function PickerInner() {
  const picker = useStore(s => s.picker)!
  const stamps = useStore(s => s.stamps)
  const recent = useStore(s => s.recentStamps)
  const palettes = useStore(s => s.palettes)
  const selected = useStore(s => picker.selected?.(s))
  const [q, setQ] = useState('')
  const [hover, setHover] = useState<string>()
  const [tabState, setTabState] = useState(savedTab)
  const valid = tabState === 'all' || (tabState === 'recent' && recent.length > 0) || palettes.some(p => p.id === tabState)
  // 最近使ったものが無ければ「すべて」から始める
  const tab = valid ? tabState : recent.length ? 'recent' : 'all'
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem('pickerTab', t) } catch { /* */ } }
  const close = () => useStore.setState({ picker: undefined })

  const list = useMemo(() => {
    const ql = q.toLowerCase()
    if (ql) return Object.values(stamps).filter(s => s.name.includes(ql))
      .sort((a, b) => (+!a.name.startsWith(ql) - +!b.name.startsWith(ql)) || a.name.length - b.name.length)
    if (tab === 'all') return Object.values(stamps)
    const ids = tab === 'recent' ? recent : palettes.find(p => p.id === tab)?.stamps ?? []
    return ids.map(id => stamps[id]).filter(Boolean)
  }, [q, tab, stamps, recent, palettes])
  // ponytail: 仮想スクロールなし。先頭 300 件だけ描画、検索やタブで絞り込む前提
  const shown = list.slice(0, 300)
  const first = shown[0]

  const W = 352, H = 440, r = picker.rect
  const style = {
    '--x': Math.max(8, Math.min(r.right - W, innerWidth - W - 8)) + 'px',
    '--y': (r.bottom + 6 + H > innerHeight ? Math.max(8, r.top - H - 6) : r.bottom + 6) + 'px',
  } as CSSProperties
  const pick = (id: string, keep: boolean) => { picker.onPick(id); if (!keep && !picker.multi) close() }
  const hv = hover ? stamps[hover] : first

  return (
    <>
      <div className="picker-scrim" onMouseDown={close} />
      <div className="picker" style={style} role="dialog" aria-label="スタンプ">
        <label className="picker-input">
          <Search size={15} />
          <input autoFocus value={q} placeholder="スタンプを検索" onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && first) pick(first.id, e.shiftKey)
              else if (e.key === 'Escape') close()
            }} />
        </label>
        <div className="picker-tabs" role="tablist" aria-disabled={!!q}>
          <button role="tab" title="最近使ったスタンプ" aria-selected={!q && tab === 'recent'} onClick={() => { setQ(''); setTab('recent') }}>
            <Clock size={17} />
          </button>
          {palettes.map(p => {
            const icon = stamps[p.stamps[0]]
            return (
              <button key={p.id} role="tab" title={p.name} aria-selected={!q && tab === p.id} onClick={() => { setQ(''); setTab(p.id) }}>
                {icon ? <img src={fileUrl(icon.fileId)} alt="" /> : <span className="tab-letter">{p.name.slice(0, 1)}</span>}
              </button>
            )
          })}
          <button role="tab" title="すべて" aria-selected={!q && tab === 'all'} onClick={() => { setQ(''); setTab('all') }}>
            <LayoutGrid size={17} />
          </button>
          <span className="grow" />
          <button className="tab-add" title="スタンプパレットを編集" onClick={() => { close(); openSettings('palettes') }}>
            <Settings2 size={16} />
          </button>
        </div>
        <div className="grid">
          {shown.map(s => (
            <button key={s.id} onClick={e => pick(s.id, e.shiftKey)} onMouseEnter={() => setHover(s.id)} aria-label={s.name}
              aria-pressed={selected ? selected.includes(s.id) : undefined}>
              <img src={fileUrl(s.fileId)} alt="" loading="lazy" />
            </button>
          ))}
          {!shown.length && <span className="picker-empty"><SmilePlus size={32} /></span>}
        </div>
        <footer>
          {hv && <><img src={fileUrl(hv.fileId)} alt="" /><code>:{hv.name}:</code></>}
        </footer>
      </div>
    </>
  )
}

/* ---------- トースト ---------- */

export function Toasts() {
  const toasts = useStore(s => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={'toast' + (t.error ? ' error' : '')} style={{ '--ms': TOAST_MS + 'ms' } as CSSProperties}
          onMouseEnter={() => hold(t.id, true)} onMouseLeave={() => hold(t.id, false)}>
          <span className="toast-text">{t.text}</span>
          {t.undo && (
            <button className="undo" onClick={t.undo}>
              <Undo2 size={15} /> 元に戻す <kbd>{isMac ? '⌘Z' : 'Ctrl+Z'}</kbd>
            </button>
          )}
          <button className="x" aria-label="閉じる" onClick={() => dismiss(t.id)}><X size={14} /></button>
          <i className="timer" />
        </div>
      ))}
    </div>
  )
}

/* ---------- ユーザーカード ---------- */

export function UserCard() {
  const card = useStore(s => s.userCard)
  const user = useStore(s => card && s.users[card.userId])
  return card && user ? <UserCardInner key={card.userId} card={card} user={user} /> : null
}

/** アイコンや名前を押したときの小さなカード。詳しくはプロフィールパネル、編集は設定へ */
function UserCardInner({ card, user }: { card: { rect: DOMRect }; user: User }) {
  const isMe = useStore(s => user.id === s.me?.id)
  const online = useStore(s => !!s.onlineUsers[user.id])
  const detail = useUserDetail(user.id)
  const close = () => useStore.setState({ userCard: undefined })
  const W = 300, H = 230, r = card.rect
  const style = {
    '--x': Math.max(8, Math.min(r.left, innerWidth - W - 8)) + 'px',
    '--y': (r.bottom + 6 + H > innerHeight ? Math.max(8, r.top - H - 6) : r.bottom + 6) + 'px',
  } as CSSProperties
  const profile = () => openSide({ kind: 'user', userId: user.id })

  return (
    <>
      <div className="picker-scrim" onMouseDown={close} />
      <div className="user-card" style={style} role="dialog" aria-label={user.name}
        onKeyDown={e => { if (e.key === 'Escape') close() }}>
        {/* 中に学年バッジ (ボタン) が入るので、外側は button にしない */}
        <div className="user-top" role="button" tabIndex={0} onClick={profile}
          onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) profile() }}>
          <span className={'user-icon' + (isGone(user) ? ' gone' : '')}>
            <img src={userIcon(user)} alt="" />
            {online && <span className="online" />}
          </span>
          <span className="user-names">
            <b>{user.displayName}</b>
            <span className="faint">@{user.name}{user.bot ? <span className="bot">BOT</span> : <GradeBadge userId={user.id} />}{isGone(user) && <GoneTag />}</span>
            {!online && detail?.lastOnline && <LastOnline iso={detail.lastOnline} />}
          </span>
        </div>
        {detail?.bio && <Bio text={detail.bio} clamp />}
        <div className="card-actions">
          {isMe ? (
            <button className="primary" autoFocus onClick={() => openSettings('profile')}><Settings size={15} /> 編集</button>
          ) : (
            <button className="primary" autoFocus onClick={() => openDM(user.id)}><MessageCircle size={15} /> DM</button>
          )}
          <button className="ghost" onClick={profile}><IdCard size={15} /> プロフィール</button>
        </div>
      </div>
    </>
  )
}

export function LastOnline({ iso }: { iso: string }) {
  return (
    <span className="faint last-online" title={new Date(iso).toLocaleString('ja-JP')}>
      <Clock size={11} /> {ago(iso)}
    </span>
  )
}

export function ago(iso: string) {
  const m = Math.round((Date.now() - +new Date(iso)) / 60e3)
  if (m < 60) return `${Math.max(1, m)}分前`
  if (m < 1440) return `${Math.round(m / 60)}時間前`
  return `${Math.round(m / 1440)}日前`
}
