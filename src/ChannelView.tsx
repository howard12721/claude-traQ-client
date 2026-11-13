import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Archive, ArrowDown, Bell, BellOff, BellRing, Eye, Hash, Home, Menu, MessagesSquare, Paperclip, Pencil, Pin, Quote, Search,
  SendHorizontal, SmilePlus, Star, X,
} from 'lucide-react'
import { UserAccountState, type Message, type User } from '@traptitech/traq'
import { api, fileUrl, ORIGIN, userIcon } from './api'
import { autosize, GoneTag, MessageItem, showUser } from './Message'
import {
  NONE, archiveThread, createThread, cycleSubscription, editTopic, isGone, labelOf, loadLatest, loadMessages, loadNewer, loadThreads,
  loadViewers, markRead, notifyError, openChannel, openPicker, openSide, renameThread, reversible, sendMessage, setHome, setQuotes,
  toggleStar, useStore, type Side,
} from './store'

/** ファイルのドロップ先になる枠。チャンネルとスレッドパネルで共用 */
function DropZone({ className, onFiles, children }: { className: string; onFiles: (f: File[]) => void; children: ReactNode }) {
  const [drag, setDrag] = useState(0)
  return (
    <section className={className + (drag ? ' dragging' : '')}
      onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) setDrag(d => d + 1) }}
      onDragLeave={() => setDrag(d => Math.max(0, d - 1))}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); setDrag(0); onFiles([...e.dataTransfer.files]) }}>
      {children}
      <div className="drop" aria-hidden><Paperclip size={40} /></div>
    </section>
  )
}

export function ChannelView({ id }: { id: string }) {
  const dmUser = useStore(s => s.dms[id] ? s.users[s.dms[id]] : undefined)
  const name = useStore(s => labelOf(s, id).slice(1))
  // 既読にする前の「どこから未読か」を覚えておく
  const [since] = useState(() => useStore.getState().unread[id]?.since)
  const [files, setFiles] = useState<File[]>([])
  // 開き直したときは最新から。ジャンプ中なら jumpTo が過去の位置を読み直す
  useEffect(() => { loadLatest(id); markRead(id); loadThreads(id); loadViewers(id) }, [id])

  return (
    <DropZone className="channel" onFiles={f => setFiles(x => [...x, ...f])}>
      <header className="ch-head">
        <button className="icon-btn menu" aria-label="チャンネル一覧" onClick={() => useStore.setState({ navOpen: true })}>
          <Menu size={18} />
        </button>
        <div className="head-main">{dmUser ? <DmTitle user={dmUser} /> : <ChannelTitle id={id} />}</div>
        <ViewerPill id={id} />
        {!dmUser && <><ChannelToggles id={id} /><span className="head-sep" /></>}
        <PanelToggles />
      </header>
      <Timeline id={id} since={since} head={dmUser
        ? <div className="ch-start dm"><img className="avatar" src={userIcon(dmUser)} alt="" /><span>{dmUser.displayName}</span></div>
        : <div className="ch-start"><Hash size={36} /><span>{name}</span></div>} />
      <Composer target={id} files={files} setFiles={setFiles} />
    </DropZone>
  )
}

function DmTitle({ user }: { user: User }) {
  return (
    <button className="dm-who" onClick={() => openSide({ kind: 'user', userId: user.id })} title="プロフィール">
      <img className={'avatar sm' + (isGone(user) ? ' gone' : '')} src={userIcon(user)} alt="" />
      <h1 className="leaf">{user.displayName}</h1>
      <span className="handle">@{user.name}</span>
      {isGone(user) && <GoneTag />}
    </button>
  )
}

/** パンくず (親は押すと移動) とトピック */
function ChannelTitle({ id }: { id: string }) {
  const path = useStore(s => s.paths[id])
  const byPath = useStore(s => s.byPath)
  const topic = useStore(s => s.channels[id].topic)
  const segs = path.split('/')
  return (
    <>
      <h1 className="crumbs">
        <Hash size={18} className="crumb-hash" />
        {segs.map((seg, i) => {
          const sub = segs.slice(0, i + 1).join('/')
          return (
            <Fragment key={i}>
              {i > 0 && <span className="sep">/</span>}
              {i === segs.length - 1 ? <span className="leaf">{seg}</span>
                : <a href={'/channels/' + sub} onClick={e => { e.preventDefault(); openChannel(byPath[sub]) }}>{seg}</a>}
            </Fragment>
          )
        })}
      </h1>
      <Topic id={id} topic={topic} />
    </>
  )
}

/** このチャンネルに対する自分の設定: 通知・お気に入り・ホーム */
function ChannelToggles({ id }: { id: string }) {
  const starred = useStore(s => s.stars.includes(id))
  const sub = useStore(s => s.subs[id] ?? 0)
  const isHome = useStore(s => s.me?.homeChannel === id)
  return (
    <>
      <button className={'icon-btn toggle sub lv' + sub} aria-label="通知" onClick={() => cycleSubscription(id)}
        title={['通知なし', '未読のみ', 'すべて通知'][sub]}>
        {sub === 0 ? <BellOff size={18} /> : sub === 1 ? <Bell size={18} /> : <BellRing size={18} />}
      </button>
      <button className={'icon-btn toggle star' + (starred ? ' on' : '')} aria-pressed={starred}
        title={starred ? 'お気に入りから外す' : 'お気に入り'} onClick={() => toggleStar(id)}>
        <Star size={18} />
      </button>
      <button className={'icon-btn toggle home-toggle' + (isHome ? ' on' : '')} aria-pressed={isHome}
        title={isHome ? 'ホームを解除' : 'ホームに設定'} onClick={() => setHome(isHome ? null : id)}>
        <Home size={18} />
      </button>
    </>
  )
}

function Topic({ id, topic }: { id: string; topic: string }) {
  const [draft, setDraft] = useState<string>()
  if (draft !== undefined) return (
    <input className="topic topic-edit" autoFocus value={draft} maxLength={200} placeholder="トピック"
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { editTopic(id, draft.trim()); setDraft(undefined) }}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(undefined)
      }} />
  )
  return (
    <button className={'topic' + (topic ? '' : ' empty')} title={topic || 'トピックを編集'} onClick={() => setDraft(topic)}>
      {topic || <Pencil size={13} />}
    </button>
  )
}

/** 右パネルの切り替え。開いているものは押し込まれた見た目になる */
function PanelToggles() {
  const kind = useStore(s => s.side?.kind)
  const toggle = (next: 'pins' | 'search') => openSide(kind === next ? undefined : next === 'pins' ? { kind: next } : { kind: next, q: '' })
  return (
    <>
      <button className="icon-btn panel-toggle" aria-pressed={kind === 'pins'} title="ピン留め" onClick={() => toggle('pins')}><Pin size={18} /></button>
      <button className="icon-btn panel-toggle" aria-pressed={kind === 'search'} title="検索" onClick={() => toggle('search')}><Search size={18} /></button>
    </>
  )
}

/* ---------- 閲覧者 ---------- */

const viewOrder = (st: string) => (st === 'editing' ? 0 : st === 'monitoring' ? 1 : 2)

/** 自分以外の閲覧者。入力中 → 見ている → 別タブで開いているだけ、の順 */
function useOtherViewers(cid: string) {
  const viewers = useStore(s => s.viewers[cid] ?? NONE)
  const meId = useStore(s => s.me!.id)
  return useMemo(() => viewers.filter(v => v.userId !== meId).sort((a, b) => viewOrder(a.state) - viewOrder(b.state)), [viewers, meId])
}

const toggleMembers = () => openSide(useStore.getState().side?.kind === 'members' ? undefined : { kind: 'members' })

/** 狭い画面のヘッダー用。人数だけ (広い画面では右端の列が代わりに出る) */
function ViewerPill({ id }: { id: string }) {
  const others = useOtherViewers(id)
  const pressed = useStore(s => s.side?.kind === 'members')
  return (
    <button className={'viewer-pill' + (others.length ? ' some' : '')} aria-pressed={pressed}
      title={`このチャンネルを見ている人 ${others.length}`} onClick={toggleMembers}>
      <Eye size={16} /><b>{others.length}</b>
    </button>
  )
}

/** 画面の右端に縦に並べる閲覧者。上の 👁 で一覧パネル、顔を押すとユーザーカード */
export function ViewerRail({ id }: { id: string }) {
  const others = useOtherViewers(id)
  const users = useStore(s => s.users)
  const pressed = useStore(s => s.side?.kind === 'members')
  return (
    <aside className={'viewer-rail' + (others.length ? ' some' : '')} aria-label="このチャンネルを見ている人">
      <button className="rail-head" aria-pressed={pressed} title={`見ている人 ${others.length}`} onClick={toggleMembers}>
        <Eye size={17} /><b>{others.length}</b>
      </button>
      <div className="rail-faces">
        {others.map(v => (
          <button key={v.userId} className={'rail-face ' + v.state} title={users[v.userId]?.displayName}
            onClick={e => showUser(v.userId, e.currentTarget)}>
            <img src={userIcon(users[v.userId])} alt={users[v.userId]?.name} />
            {v.state === 'editing' && <span className="rail-typing"><i /><i /><i /></span>}
          </button>
        ))}
      </div>
    </aside>
  )
}

/** 投稿欄の上に、入力中の人のアイコンと点滅する点を出す */
function Typing({ id }: { id: string }) {
  const typing = useOtherViewers(id).filter(v => v.state === 'editing')
  const users = useStore(s => s.users)
  if (!typing.length) return null
  return (
    <div className="typing" title={typing.map(v => users[v.userId]?.displayName).join(', ') + ' が入力中'}>
      {typing.slice(0, 3).map(v => <img key={v.userId} src={userIcon(users[v.userId])} alt="" />)}
      <span className="dots"><i /><i /><i /></span>
    </div>
  )
}

/* ---------- スレッド ---------- */

/** 右側のスレッドパネル。スレッドが無ければ最初の投稿で作る */
export function ThreadPanel({ side }: { side: Extract<Side, { kind: 'thread' }> }) {
  const { parent, id } = side
  const thread = useStore(s => (id ? s.threads[id] : undefined))
  const [name, setName] = useState(() => thread?.name ?? defaultThreadName(parent.content))
  const [files, setFiles] = useState<File[]>([])
  useEffect(() => { if (id) { loadMessages(id); markRead(id) } }, [id])
  useEffect(() => { if (thread) setName(thread.name) }, [thread?.name])
  const commitName = () => { if (id) { if (name.trim()) renameThread(id, name.trim()); else setName(thread!.name) } }
  const head = <div className="thread-parent"><MessageItem m={parent} cont={false} inThread /></div>

  const createAndSend = async (text: string, fs: File[]) => {
    try {
      const created = await createThread(parent, name.trim() || defaultThreadName(parent.content))
      reversible({ text: `スレッド「${created.name}」を作成しました`, run: () => {}, undo: () => archiveThread(created.id, true) })
      return sendMessage(created.id, text, fs)
    } catch {
      notifyError('スレッドを作成できませんでした。名前が重複していないか確認してください')
      return false
    }
  }

  return (
    <DropZone className="channel thread-panel" onFiles={f => setFiles(x => [...x, ...f])}>
      <header className="ch-head">
        <div className="head-main">
          <MessagesSquare size={18} className="crumb-hash" />
          <input className="thread-name" value={name} aria-label="スレッド名" maxLength={50}
            onChange={e => setName(e.target.value)} onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(thread?.name ?? name); e.currentTarget.blur() } }} />
        </div>
        {id && <button className="icon-btn" title="アーカイブ" onClick={() => archiveThread(id)}><Archive size={18} /></button>}
        <button className="icon-btn" title="閉じる" onClick={() => openSide()}><X size={18} /></button>
      </header>
      {/* 下書き中は投稿がまだ無いので、親メッセージだけを見せる */}
      {id ? <Timeline id={id} head={head} /> : <div className="tl-wrap"><div className="scroller"><div className="timeline">{head}</div></div></div>}
      <Composer target={id ?? 'thread-draft:' + parent.id} label={name} files={files} setFiles={setFiles}
        onSend={id ? undefined : createAndSend} />
    </DropZone>
  )
}

const defaultThreadName = (content: string) =>
  (content.split('\n').find(l => l.trim())?.replace(/https?:\/\/\S+/g, '').trim() || 'スレッド').slice(0, 30)

/* ---------- タイムライン ---------- */

const dayKey = (iso: string) => new Date(iso).toDateString()
function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date()
  const diff = Math.round((+new Date(now.toDateString()) - +new Date(d.toDateString())) / 864e5)
  if (diff === 0) return '今日'
  if (diff === 1) return '昨日'
  return d.toLocaleDateString('ja-JP', { year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function Timeline({ id, since, head }: { id: string; since?: string; head: ReactNode }) {
  const list = useStore(s => s.messages[id])
  const more = useStore(s => s.hasMore[id])
  const newer = useStore(s => !!s.hasNewer[id])
  const meId = useStore(s => s.me!.id)
  const last = list?.at(-1)
  const lastPending = useStore(s => !!last && !!s.pending[last.id])
  const scroller = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const [awayAt, setAwayAt] = useState<string>()

  useEffect(() => {
    if (!top.current) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMessages(id, true) },
      { root: scroller.current, rootMargin: '800px 0px 0px 0px' })
    io.observe(top.current)
    return () => io.disconnect()
  }, [id, list?.length, more])

  useEffect(() => {
    if (!bottom.current) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadNewer(id) },
      { root: scroller.current, rootMargin: '0px 0px 600px 0px' })
    io.observe(bottom.current)
    return () => io.disconnect()
  }, [id, list?.length, newer])

  // 自分が送ったら、読み返していた位置からでも最新へ
  useEffect(() => { if (lastPending) scroller.current?.scrollTo({ top: 0 }) }, [lastPending, last?.id])

  // column-reverse なので scrollTop は最下部が 0、上に行くほど負
  const onScroll = () => {
    const away = Math.abs(scroller.current!.scrollTop) > 400
    if (away && !awayAt) setAwayAt(last?.id)
    if (!away && awayAt) setAwayAt(undefined)
  }

  let newShown = false
  return (
    <div className="tl-wrap">
      <div className="scroller" ref={scroller} onScroll={onScroll}>
        <div className="timeline">
          {!list && <Skeleton />}
          {list && more && <div ref={top} className="loading-more"><span className="spinner" /></div>}
          {list && !more && head}
          {list?.map((m, i) => {
            const prev = list[i - 1]
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
            const isNew = !newShown && !!since && +new Date(m.createdAt) >= +new Date(since) && m.userId !== meId
            if (isNew) newShown = true
            const cont = !!prev && !newDay && !isNew && prev.userId === m.userId
              && +new Date(m.createdAt) - +new Date(prev.createdAt) < 5 * 60e3
            return (
              <Fragment key={m.id}>
                {newDay && <div className="day"><span>{dayLabel(m.createdAt)}</span></div>}
                {isNew && <div className="new-line"><span>新着</span></div>}
                <MessageItem m={m} cont={cont} />
              </Fragment>
            )
          })}
          {newer && <div ref={bottom} className="loading-more"><span className="spinner" /></div>}
        </div>
      </div>
      {(awayAt || newer) && (
        <button className={'jump' + (newer || last?.id !== awayAt ? ' fresh' : '')} aria-label="最新へ"
          onClick={async () => {
            if (newer) await loadLatest(id)
            scroller.current?.scrollTo({ top: 0, behavior: newer ? 'auto' : 'smooth' })
          }}>
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  )
}

function Skeleton() {
  return <>{[64, 40, 82, 55, 30].map((w, i) => (
    <div key={i} className="msg skel"><div className="gutter"><span className="avatar" /></div>
      <div className="body"><i style={{ width: '18%' }} /><i style={{ width: w + '%' }} /></div></div>
  ))}</>
}

/* ---------- 投稿欄 ---------- */

type Cand = { key: string; label: string; img?: string; insert: string }

const SEND_KEY = navigator.platform.startsWith('Mac') ? '⌘Enter' : 'Ctrl+Enter'

/** target は投稿先のチャンネル (スレッドの下書きなら仮のキー)。下書き・引用はこのキーごとに持つ */
function Composer({ target, label, files, setFiles, onSend }: {
  target: string; label?: string; files: File[]; setFiles: (f: File[]) => void
  onSend?: (text: string, files: File[]) => Promise<boolean>
}) {
  const name = useStore(s => label ?? labelOf(s, target))
  const quotes = useStore(s => s.quotes[target] ?? NONE)
  const users = useStore(s => s.users)
  const stamps = useStore(s => s.stamps)
  const [text, setText] = useState(() => localStorage.getItem('draft:' + target) ?? '')
  const [caret, setCaret] = useState(0)
  const [sel, setSel] = useState(0)
  const [dismissed, setDismissed] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)
  // 入力中なら viewstate を editing にして、相手側に「入力中」を出す
  const typing = focused && !!text.trim()
  useEffect(() => { useStore.setState({ typing }) }, [typing])
  useEffect(() => () => useStore.setState({ typing: false }), [])

  useEffect(() => {
    try { if (text) localStorage.setItem('draft:' + target, text); else localStorage.removeItem('draft:' + target) } catch { /* private mode */ }
  }, [target, text])
  useLayoutEffect(() => autosize(ta.current), [text])
  // 引用が積まれたら書き足せるよう入力欄へ
  useEffect(() => { if (quotes.length) ta.current?.focus() }, [quotes.length])
  useEffect(() => { if (matchMedia('(pointer: fine)').matches) ta.current?.focus() }, [target])

  // @ユーザー / :スタンプ の補完
  const token = text.slice(0, caret).match(/(?:^|\s)([@:])([\w+\-.]+)$/)
  const word = token && token[0] !== dismissed ? token[0].trim() : ''
  const cands = useMemo<Cand[]>(() => {
    if (!word) return []
    const kind = word[0], q = word.slice(1).toLowerCase()
    const rank = (n: string) => (n.toLowerCase().startsWith(q) ? 0 : 1) + n.length / 1000
    if (kind === '@') return Object.values(users)
      .filter(u => u.state === UserAccountState.active && u.name.toLowerCase().includes(q))
      .sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 8)
      .map(u => ({ key: u.id, label: u.name, img: userIcon(u), insert: '@' + u.name + ' ' }))
    return Object.values(stamps).filter(st => st.name.includes(q)).sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 8)
      .map(st => ({ key: st.id, label: st.name, img: fileUrl(st.fileId), insert: ':' + st.name + ':' }))
  }, [word, users, stamps])
  const pick = (c: Cand) => {
    const start = caret - word.length
    setText(text.slice(0, start) + c.insert + text.slice(caret))
    const pos = start + c.insert.length
    requestAnimationFrame(() => { ta.current?.setSelectionRange(pos, pos); setCaret(pos) })
  }

  const send = async () => {
    const t = text.trim()
    if (!t && !files.length && !quotes.length) return
    const fs = files, qs = quotes
    const body = [t, ...qs.map(q => `${ORIGIN}/messages/${q}`)].filter(Boolean).join('\n')
    setText(''); setFiles([]); setQuotes(target, [])
    if (!(await (onSend ?? ((b, f) => sendMessage(target, b, f)))(body, fs))) { setText(t); setFiles(fs); setQuotes(target, qs) }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (cands.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSel(i => (i + (e.key === 'ArrowDown' ? 1 : cands.length - 1)) % cands.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(cands[Math.min(sel, cands.length - 1)]); return }
      if (e.key === 'Escape') { setDismissed(token![0]); return }
    }
    // Enter は改行。⌘Enter (Windows/Linux は Ctrl+Enter) で送信
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
    else if (e.key === 'ArrowUp' && !text) {
      // 空のときの ↑ は自分の最後の投稿を編集
      const s = useStore.getState()
      const mine = s.messages[target]?.findLast(m => m.userId === s.me!.id && !s.pending[m.id])
      if (mine) { e.preventDefault(); useStore.setState({ editing: mine.id }) }
    }
  }

  /** ピッカーで選んだスタンプをカーソル位置に :name: で入れる */
  const insertStamp = (sid: string) => {
    const st = stamps[sid]
    const el = ta.current
    if (!st || !el) return
    const a = el.selectionStart, b = el.selectionEnd, tok = `:${st.name}:`
    setText(t => t.slice(0, a) + tok + t.slice(b))
    useStore.setState(s => ({ recentStamps: [sid, ...s.recentStamps.filter(x => x !== sid)] }))
    requestAnimationFrame(() => {
      el.setSelectionRange(a + tok.length, a + tok.length)
      setCaret(a + tok.length)
      // Shift で続けて選んでいる間はピッカーの検索欄にフォーカスを残す
      if (!useStore.getState().picker) el.focus()
    })
  }

  const ready = !!text.trim() || files.length > 0 || quotes.length > 0
  return (
    <div className="composer">
      <Typing id={target} />
      {cands.length > 0 && (
        <ul className="complete" role="listbox">
          {cands.map((c, i) => (
            <li key={c.key} role="option" aria-selected={i === Math.min(sel, cands.length - 1)}
              onMouseDown={e => { e.preventDefault(); pick(c) }} onMouseEnter={() => setSel(i)}>
              <img src={c.img} alt="" /><span>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
      {quotes.length > 0 && (
        <div className="quote-chips">
          {quotes.map(q => <QuoteChip key={q} id={q} onRemove={() => setQuotes(target, quotes.filter(x => x !== q))} />)}
        </div>
      )}
      {files.length > 0 && (
        <div className="attachments">
          {files.map((f, i) => <FileChip key={i} file={f} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />)}
        </div>
      )}
      <div className="field">
        <label className="icon-btn attach" title="ファイルを添付">
          <Paperclip size={18} />
          <input type="file" multiple hidden onChange={e => { setFiles([...files, ...(e.target.files ?? [])]); e.target.value = '' }} />
        </label>
        <textarea ref={ta} rows={1} value={text} placeholder={`${name} へ投稿`}
          onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); setSel(0); setDismissed('') }}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); setFiles([...files, ...e.clipboardData.files]) } }} />
        <button className="icon-btn stamp-btn" title="スタンプ"
          onClick={e => openPicker(e.currentTarget, insertStamp)}><SmilePlus size={18} /></button>
        <button className={'send' + (ready ? ' ready' : '')} disabled={!ready} onClick={send} aria-label="送信" title={`送信 (${SEND_KEY})`}>
          <SendHorizontal size={18} />
        </button>
      </div>
    </div>
  )
}

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return (
    <div className="att" title={file.name}>
      {url ? <img src={url} alt="" /> : <span className="att-name">{file.name}</span>}
      <button aria-label="添付を外す" onClick={onRemove}><X size={12} /></button>
    </div>
  )
}

/** 送信前の引用。送ると本文の末尾に URL として付く */
function QuoteChip({ id, onRemove }: { id: string; onRemove: () => void }) {
  const [m, setM] = useState<Message>()
  useEffect(() => {
    const loaded = Object.values(useStore.getState().messages).flat().find(x => x.id === id)
    if (loaded) setM(loaded)
    else api.getMessage(id).then(r => setM(r.data), () => {})
  }, [id])
  const user = useStore(s => (m ? s.users[m.userId] : undefined))
  return (
    <div className="quote-chip">
      <Quote size={14} className="faint" />
      {user && <img className="avatar xs" src={userIcon(user)} alt="" />}
      <b>{user?.displayName}</b>
      <span className="quote-chip-text">{m?.content.replace(/\s+/g, ' ')}</span>
      <button aria-label="引用をやめる" onClick={onRemove}><X size={13} /></button>
    </div>
  )
}
