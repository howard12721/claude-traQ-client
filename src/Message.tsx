import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { FileInfo, Message, Ogp } from '@traptitech/traq'
import { Bookmark, ChevronRight, MessageSquareQuote, UserX, FileText, MessagesSquare, Pencil, Pin, Quote, SmilePlus, Trash2 } from 'lucide-react'
import { api, fileUrl, userIcon, thumbUrl } from './api'
import { render } from './markdown'
import { addQuote, deleteMessage, editMessage, isGone, jumpTo, labelOf, openChannel, openPicker, openSide, openThread, toggleClip, toggleStamp, togglePin, useStore } from './store'

export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

/** メッセージ本文中のリンクを SPA 内遷移 / 新しいタブに振り分ける */
export function onMarkdownClick(e: MouseEvent) {
  const spoiler = (e.target as HTMLElement).closest('.spoiler')
  if (spoiler) return spoiler.classList.toggle('shown')
  const a = (e.target as HTMLElement).closest('a')
  if (!a || e.metaKey || e.ctrlKey) return
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('#user:')) { e.preventDefault(); return showUser(href.slice(6), a) }
  if (href.startsWith('#group:')) { e.preventDefault(); return openSide({ kind: 'group', groupId: href.slice(7) }) }
  if (href === '#') return e.preventDefault()
  const ch = decodeURIComponent(a.pathname).match(/^\/channels\/(.+)$/)
  if (a.origin === location.origin && ch) {
    e.preventDefault()
    const id = useStore.getState().byPath[ch[1]]
    if (id) openChannel(id)
  } else if (a.origin !== location.origin) {
    e.preventDefault()
    open(a.href, '_blank', 'noopener')
  }
}

/** 学年 (type が grade のグループ) を名前の横に出す。押すとグループ詳細 */
export function GradeBadge({ userId }: { userId: string }) {
  const g = useStore(s => s.groups[s.grades[userId]])
  if (!g) return null
  return (
    <button className="bot grade" title={g.description || g.name}
      onClick={e => { e.stopPropagation(); openSide({ kind: 'group', groupId: g.id }) }}>{g.name}</button>
  )
}

/** 凍結済みの印。名前の横に出す */
export function GoneTag() {
  return <span className="bot gone-tag" title="凍結済みのユーザー"><UserX size={10} />凍結</span>
}

export function showUser(userId: string, el: Element) {
  useStore.setState({ userCard: { userId, rect: el.getBoundingClientRect() } })
}

export const MessageItem = memo(function MessageItem({ m, cont, inThread }: { m: Message; cont: boolean; inThread?: boolean }) {
  const user = useStore(s => s.users[m.userId])
  const meId = useStore(s => s.me!.id)
  const pending = useStore(s => !!s.pending[m.id])
  const editing = useStore(s => s.editing === m.id)
  const thread = useStore(s => Object.values(s.threads).find(t => t.parentMessageId === m.id && !t.archived))
  const threadUnread = useStore(s => thread && s.unread[thread.id])
  const canThread = useStore(s => s.threadsOk && !!s.channels[m.channelId]) && !inThread
  const clipped = useStore(s => !!s.clipped[m.id])
  const focused = useStore(s => s.focus === m.id)
  const el = useRef<HTMLElement>(null)
  useEffect(() => { if (focused) el.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [focused])
  const r = render(m.content)
  const mine = m.userId === meId
  const urls = r.embeddings.flatMap(e => e.type === 'url' ? [e.url] : []).slice(0, 2)
  const edited = +new Date(m.updatedAt) - +new Date(m.createdAt) > 1000
  const mentionsMe = r.renderedText.includes('link-highlight')
  const pick = (el: Element) => openPicker(el, sid => {
    const cur = useStore.getState().messages[m.channelId]?.find(x => x.id === m.id) ?? m
    if (!cur.stamps.some(s => s.userId === meId && s.stampId === sid)) toggleStamp(m, sid)
  })
  const gone = isGone(user)
  const cls = ['msg', gone && 'gone', cont && 'cont', pending && 'pending', m.pinned && 'pinned', mentionsMe && 'mentioned', editing && 'editing', focused && 'focus']

  return (
    <article ref={el} className={cls.filter(Boolean).join(' ')} id={'m-' + m.id}>
      <div className="gutter">
        {cont ? <time className="hover-time" dateTime={m.createdAt}>{hhmm(m.createdAt)}</time>
          : <button className="avatar-btn" onClick={e => showUser(m.userId, e.currentTarget)} aria-label={user?.name}>
            <img className="avatar" src={userIcon(user)} alt="" />
          </button>}
      </div>
      <div className="body">
        {!cont && (
          <header>
            <button className="author" onClick={e => showUser(m.userId, e.currentTarget)}>{user?.displayName ?? '…'}</button>
            {user?.bot ? <span className="bot">BOT</span> : <GradeBadge userId={m.userId} />}
            {gone && <GoneTag />}
            <time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString('ja-JP')}>{hhmm(m.createdAt)}</time>
          </header>
        )}
        {editing ? <Editor m={m} /> : (
          <div className="md" onClick={onMarkdownClick}>
            <span dangerouslySetInnerHTML={{ __html: r.renderedText }} />
            {edited && <Pencil className="edited" size={11} aria-label={'編集済み ' + hhmm(m.updatedAt)} />}
            {m.pinned && <Pin className="pin-mark" size={12} aria-label="ピン留め" />}
          </div>
        )}
        {r.embeddings.length > 0 && (
          <div className="embeds">
            {r.embeddings.map((e, i) => e.type === 'file' ? <FileEmbed key={i} id={e.id} />
              : e.type === 'message' ? <QuoteEmbed key={i} id={e.id} /> : null)}
            {urls.map(u => <OgpCard key={u} url={u} />)}
          </div>
        )}
        <Stamps m={m} meId={meId} onAdd={pick} />
        {thread && !inThread && (
          <button className={'thread-chip' + (threadUnread ? ' unread' : '')} onClick={() => openThread(m)}>
            <MessagesSquare size={15} /><span>{thread.name}</span>
            {threadUnread && <span className={'badge' + (threadUnread.noticeable ? ' mention' : '')}>{threadUnread.count}</span>}
            <ChevronRight size={14} className="faint" />
          </button>
        )}
      </div>
      {!pending && !editing && (
        <div className="tools" role="toolbar">
          <button title="スタンプ" onClick={e => pick(e.currentTarget)}><SmilePlus size={16} /></button>
          {canThread && (
            <button title={thread ? 'スレッドを開く' : 'スレッドで返信'} onClick={() => openThread(m)}><MessagesSquare size={16} /></button>
          )}
          <button title="引用" onClick={() => addQuote(m.channelId, m.id)}>
            <Quote size={16} />
          </button>
          <button title="このメッセージを引用している投稿を探す"
            onClick={() => openSide({ kind: 'search', q: `cites:${m.id} ` })}><MessageSquareQuote size={16} /></button>
          <button title={clipped ? 'クリップを外す' : 'クリップ'} aria-pressed={clipped} className="clip" onClick={() => toggleClip(m)}>
            <Bookmark size={16} />
          </button>
          <button title={m.pinned ? 'ピン留めを外す' : 'ピン留め'} aria-pressed={m.pinned} onClick={() => togglePin(m)}><Pin size={16} /></button>
          {mine && <button title="編集" onClick={() => useStore.setState({ editing: m.id })}><Pencil size={16} /></button>}
          {mine && <button title="削除" className="danger" onClick={() => deleteMessage(m)}><Trash2 size={16} /></button>}
        </div>
      )}
    </article>
  )
})

type StampGroup = { count: number; who: { userId: string; count: number; at: string }[]; mine: boolean; at: string }

function Stamps({ m, meId, onAdd }: { m: Message; meId: string; onAdd: (el: Element) => void }) {
  const stamps = useStore(s => s.stamps)
  const groups = useMemo(() => {
    const g = new Map<string, StampGroup>()
    for (const s of m.stamps) {
      const e = g.get(s.stampId) ?? { count: 0, who: [], mine: false, at: s.createdAt }
      e.count += s.count
      e.who.push({ userId: s.userId, count: s.count, at: s.createdAt })
      e.mine ||= s.userId === meId
      if (s.createdAt < e.at) e.at = s.createdAt
      g.set(s.stampId, e)
    }
    for (const e of g.values()) e.who.sort((a, b) => a.at.localeCompare(b.at))
    return [...g].sort((a, b) => a[1].at.localeCompare(b[1].at))
  }, [m.stamps, meId])
  // カーソルを乗せると「誰が何回」のカードを出す。カードへ移る間は少し待つ
  const [card, setCard] = useState<{ sid: string; rect: DOMRect }>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = (sid: string, el: Element, delay = 250) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCard({ sid, rect: el.getBoundingClientRect() }), delay)
  }
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setCard(undefined), 150) }
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!groups.length) return null
  const open = card && groups.find(([sid]) => sid === card.sid)

  return (
    <div className="stamps">
      {groups.map(([sid, g]) => {
        const st = stamps[sid]
        return (
          <button key={sid} className={'stamp' + (g.mine ? ' mine' : '')} aria-pressed={g.mine} aria-label={`:${st?.name}: ${g.count}`}
            onClick={() => toggleStamp(m, sid)}
            onMouseEnter={e => show(sid, e.currentTarget)} onMouseLeave={hide}
            // スマホは長押し (contextmenu) で見る
            onContextMenu={e => { e.preventDefault(); show(sid, e.currentTarget, 0) }}>
            {st && <img src={fileUrl(st.fileId)} alt="" />}
            <span>{g.count}</span>
          </button>
        )
      })}
      <button className="stamp add" title="スタンプ" onClick={e => onAdd(e.currentTarget)}><SmilePlus size={15} /></button>
      {open && <StampCard sid={open[0]} g={open[1]} rect={card.rect} meId={meId}
        onEnter={() => clearTimeout(timer.current)} onLeave={hide} />}
    </div>
  )
}

function StampCard({ sid, g, rect, meId, onEnter, onLeave }: {
  sid: string; g: StampGroup; rect: DOMRect; meId: string; onEnter: () => void; onLeave: () => void
}) {
  const st = useStore(s => s.stamps[sid])
  const users = useStore(s => s.users)
  const W = 240
  const below = rect.top < 280
  const style = {
    left: Math.max(8, Math.min(rect.left, innerWidth - W - 8)),
    ...(below ? { top: rect.bottom + 6 } : { bottom: innerHeight - rect.top + 6 }),
  }
  return (
    <div className="stamp-card" style={style} onMouseEnter={onEnter} onMouseLeave={onLeave} role="tooltip">
      <header>
        {st && <img src={fileUrl(st.fileId)} alt="" />}
        <code>:{st?.name}:</code>
        <span className="grow" />
        <b>{g.count}</b>
      </header>
      <ul>
        {g.who.map(w => (
          <li key={w.userId} className={w.userId === meId ? 'me' : ''}>
            <img src={userIcon(users[w.userId])} alt="" />
            <span className="who">{users[w.userId]?.displayName ?? '?'}</span>
            {w.count > 1 && <span className="times">×{w.count}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function Editor({ m }: { m: Message }) {
  const [v, setV] = useState(m.content)
  const ref = useRef<HTMLTextAreaElement>(null)
  const close = () => useStore.setState({ editing: undefined })
  const save = () => { if (v.trim()) editMessage(m, v.trim()); close() }
  useLayoutEffect(() => autosize(ref.current), [v])
  useEffect(() => { const el = ref.current!; el.focus(); el.setSelectionRange(v.length, v.length) }, [])
  return (
    <div className="editor">
      <textarea ref={ref} rows={1} value={v} onChange={e => setV(e.target.value)} onKeyDown={e => {
        if (e.key === 'Escape') close()
        // 投稿欄と同じく Enter は改行、⌘Enter / Ctrl+Enter で保存
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); save() }
      }} />
      <div className="editor-actions">
        <button className="ghost" onClick={close}>キャンセル <kbd>Esc</kbd></button>
        <button className="primary" onClick={save}>保存 <kbd>{navigator.platform.startsWith('Mac') ? '⌘↵' : 'Ctrl+↵'}</kbd></button>
      </div>
    </div>
  )
}

const metaCache = new Map<string, Promise<FileInfo>>()

function FileEmbed({ id }: { id: string }) {
  const [meta, setMeta] = useState<FileInfo | null>()
  const dlg = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    let p = metaCache.get(id)
    if (!p) metaCache.set(id, (p = api.getFileMeta(id).then(r => r.data)))
    p.then(setMeta, () => setMeta(null))
  }, [id])
  if (meta === undefined) return <div className="file-ph" />
  if (meta === null) return null
  if (meta.mime.startsWith('image/')) {
    const t = meta.thumbnails[0]
    return (
      <>
        <button className="img" onClick={() => dlg.current?.showModal()}>
          <img src={t && !meta.isAnimatedImage ? thumbUrl(id) : fileUrl(id)} width={t?.width} height={t?.height}
            loading="lazy" alt={meta.name} />
        </button>
        <dialog ref={dlg} className="lightbox" onClick={() => dlg.current?.close()}>
          <img src={fileUrl(id)} alt={meta.name} />
        </dialog>
      </>
    )
  }
  if (meta.mime.startsWith('video/')) return <video className="media" src={fileUrl(id)} controls preload="metadata" />
  if (meta.mime.startsWith('audio/')) return <audio src={fileUrl(id)} controls preload="metadata" />
  return (
    <a className="file-chip" href={fileUrl(id)} download={meta.name}>
      <FileText size={18} /><span>{meta.name}</span><small>{fmtSize(meta.size)}</small>
    </a>
  )
}

const fmtSize = (n: number) => n < 1024 ? n + ' B' : n < 1024 ** 2 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 ** 2).toFixed(1) + ' MB'

function QuoteEmbed({ id }: { id: string }) {
  const [m, setM] = useState<Message | null>()
  const user = useStore(s => m && s.users[m.userId])
  const path = useStore(s => m && s.paths[m.channelId])
  useEffect(() => { api.getMessage(id).then(r => setM(r.data), () => setM(null)) }, [id])
  if (!m) return null
  return (
    <blockquote className="quote" tabIndex={0} title="引用元へ移動"
      onClick={e => { if (!(e.target as HTMLElement).closest('a, button, .spoiler')) jumpTo(m) }}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) jumpTo(m) }}>
      <header>
        <img className="avatar xs" src={userIcon(user)} alt="" />
        <b>{user?.displayName}</b>
        {path && <a href={'/channels/' + path} onClick={e => { e.preventDefault(); openChannel(m.channelId) }}>#{path}</a>}
        <time>{new Date(m.createdAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}</time>
      </header>
      <div className="md" onClick={onMarkdownClick} dangerouslySetInnerHTML={{ __html: render(m.content).renderedText }} />
    </blockquote>
  )
}

const ogpCache = new Map<string, Promise<Ogp | null>>()

function OgpCard({ url }: { url: string }) {
  const [ogp, setOgp] = useState<Ogp | null>()
  useEffect(() => {
    let p = ogpCache.get(url)
    if (!p) ogpCache.set(url, (p = api.getOgp(url).then(r => r.data, () => null)))
    p.then(setOgp)
  }, [url])
  if (!ogp || !ogp.title) return null
  const img = ogp.images[0]
  return (
    <a className="ogp" href={ogp.url || url} target="_blank" rel="noopener noreferrer">
      {img && <img src={img.secureUrl ?? img.url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <span className="ogp-text">
        <b>{ogp.title}</b>
        {ogp.description && <span className="ogp-desc">{ogp.description}</span>}
        <span className="ogp-host">{new URL(ogp.url || url).host}</span>
      </span>
    </a>
  )
}

/* ---------- 一覧 (検索・ピン・クリップ・アクティビティ・プロフィール) のメッセージ ---------- */

type Card = Pick<Message, 'id' | 'userId' | 'channelId' | 'content' | 'createdAt'>

const when = (iso: string) => {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** クリックで元の位置へ飛ぶ */
export function MessageCard({ m }: { m: Card }) {
  const user = useStore(s => s.users[m.userId])
  const label = useStore(s => labelOf(s, m.channelId))
  return (
    <li className="card" tabIndex={0} onClick={e => { if (!(e.target as HTMLElement).closest('a')) jumpTo(m) }}
      onKeyDown={e => { if (e.key === 'Enter') jumpTo(m) }}>
      <header>
        <img className="avatar xs" src={userIcon(user)} alt="" />
        <b>{user?.displayName}</b>
        <span className="card-where">{label}</span>
        <time>{when(m.createdAt)}</time>
      </header>
      <div className="md clamp" onClick={onMarkdownClick} dangerouslySetInnerHTML={{ __html: render(m.content).renderedText }} />
    </li>
  )
}
