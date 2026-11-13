import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Message } from '@traptitech/traq'
import {
  AtSign, Bot, CalendarDays, FileText, Hash, Image, Link, Music, Quote, Search, UserRound, Video, X,
} from 'lucide-react'
import { api, userIcon } from './api'
import { MessageCard } from './Message'
import { useShallow } from 'zustand/react/shallow'
import { openSide, useStore, type Side, type State } from './store'

/*
 * 検索欄の文字列がそのまま検索条件。ボタンは文字列のトークンを足したり消したりするだけ。
 *   from:@user  to:@user  in:#path  after:2024-01-01  before:2024-12-31
 *   has:image|video|audio|url|file  is:bot  cites:<メッセージID>  sort:new|old|updated
 */

const HAS = {
  image: { icon: <Image size={14} />, label: '画像' },
  video: { icon: <Video size={14} />, label: '動画' },
  audio: { icon: <Music size={14} />, label: '音声' },
  url: { icon: <Link size={14} />, label: 'URL' },
  file: { icon: <FileText size={14} />, label: 'ファイル' },
} as const
type Has = keyof typeof HAS
const SORT = { new: 'createdAt', old: '-createdAt', updated: 'updatedAt' } as const
type Sort = keyof typeof SORT

type Token = { raw: string; key: string; value: string; ok: boolean; label: ReactNode }
type Parsed = {
  word: string; from: string[]; to: string[]; in?: string; after?: string; before?: string
  has: Set<Has>; bot: boolean; cites?: string; sort: Sort; tokens: Token[]
}

const TOKEN = /^(from|to|in|after|before|has|is|cites|sort):(.*)$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 解析に使う名前の引き当て表。呼び出し側がストアから購読して渡す */
type Lookup = Pick<State, 'usersByName' | 'byPath' | 'dms' | 'users'>

export function parseQuery(q: string, s: Lookup): Parsed {
  const p: Parsed = { word: '', from: [], to: [], has: new Set(), bot: false, sort: 'new', tokens: [] }
  const words: string[] = []
  for (const raw of q.split(/\s+/).filter(Boolean)) {
    const m = raw.match(TOKEN)
    if (!m) { words.push(raw); continue }
    const key = m[1].toLowerCase(), value = m[2]
    const tok = (ok: boolean, label: ReactNode) => p.tokens.push({ raw, key, value, ok, label })
    if (key === 'from' || key === 'to') {
      const u = s.usersByName[value.replace(/^@/, '')]
      if (u) p[key].push(u.id)
      tok(!!u, <>{key === 'from' ? <UserRound size={13} /> : <AtSign size={13} />}{u && <img src={userIcon(u)} alt="" />}{value.replace(/^@/, '')}</>)
    } else if (key === 'in') {
      const name = value.replace(/^[#@]/, '')
      const id = value.startsWith('@')
        ? Object.keys(s.dms).find(d => s.users[s.dms[d]]?.name === name)
        : s.byPath[name]
      if (id) p.in = id
      tok(!!id, <><Hash size={13} />{name}</>)
    } else if (key === 'after' || key === 'before') {
      const ok = DATE.test(value)
      if (ok) p[key] = value
      tok(ok, <><CalendarDays size={13} />{value}{key === 'after' ? ' から' : ' まで'}</>)
    } else if (key === 'has') {
      const ok = value in HAS
      if (ok) p.has.add(value as Has)
      tok(ok, ok ? <>{HAS[value as Has].icon}{HAS[value as Has].label}</> : value)
    } else if (key === 'is') {
      const ok = value === 'bot'
      if (ok) p.bot = true
      tok(ok, <><Bot size={13} />BOT</>)
    } else if (key === 'cites') {
      const id = value.match(/[0-9a-f-]{36}$/)?.[0]
      if (id) p.cites = id
      tok(!!id, <><Quote size={13} />{id ? <CitedHead id={id} /> : '引用'}</>)
    } else if (key === 'sort') {
      const ok = value in SORT
      if (ok) p.sort = value as Sort
      // 並び順は下のスイッチで見せるのでチップにはしない
    }
  }
  p.word = words.join(' ')
  return p
}

/** 日付は「その日から」「その日まで」を含むように ISO にする */
const dayStart = (d: string) => new Date(d + 'T00:00:00').toISOString()
const dayAfter = (d: string) => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + 1); return t.toISOString() }

const PAGE = 30

export function SearchPanel({ side }: { side: Extract<Side, { kind: 'search' }> }) {
  const q = side.q
  const setQ = (next: string) => openSide({ ...side, q: next })
  const input = useRef<HTMLInputElement>(null)
  const lookup = useStore(useShallow(s => ({ usersByName: s.usersByName, byPath: s.byPath, dms: s.dms, users: s.users })))
  const p = parseQuery(q, lookup)
  const tokens = q.split(/\s+/).filter(Boolean)
  const without = (pred: (t: string) => boolean) => tokens.filter(t => !pred(t))
  const setToken = (key: string, value?: string) => {
    const rest = without(t => t.toLowerCase().startsWith(key + ':'))
    setQ([...rest, ...(value ? [`${key}:${value}`] : [])].join(' ') + ' ')
  }
  const toggleHas = (h: Has) =>
    setQ((p.has.has(h) ? without(t => t.toLowerCase() === 'has:' + h) : [...tokens, 'has:' + h]).join(' ') + ' ')
  const removeRaw = (raw: string) => setQ(without(t => t === raw).join(' ') + (tokens.length > 1 ? ' ' : ''))
  // 末尾の書きかけトークン (from:@ali など) に候補を出す
  const last = q.endsWith(' ') ? '' : tokens.at(-1) ?? ''
  // ボタンで書きかけのトークンを置き、続きは候補から選んでもらう
  const startToken = (prefix: string) => {
    const base = /^(from|to|in):[@#]?$/i.test(last) ? tokens.slice(0, -1) : tokens
    setQ([...base, prefix].join(' '))
    input.current?.focus()
  }
  const [dates, setDates] = useState(!!(p.after || p.before))

  return (
    <div className="search-panel">
      {/* 上から 検索欄 → ボタン列 は常に同じ位置。候補は重ねて出し、増えたり減ったりするものはその下に置く */}
      <div className="search-box-wrap">
        <label className="search-box">
          <Search size={16} />
          <input ref={input} autoFocus value={q} placeholder="メッセージを検索" spellCheck={false}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') openSide() }} />
          <button className="icon-btn" title="消す" style={{ visibility: q ? 'visible' : 'hidden' }}
            onClick={() => { setQ(''); input.current?.focus() }}><X size={15} /></button>
        </label>
        <Suggest last={last} onPick={tok => setQ([...tokens.slice(0, -1), tok].join(' ') + ' ')} />
      </div>

      <div className="filter-tools">
        <button title="送った人 (from:@)" aria-pressed={p.from.length > 0} onClick={() => startToken('from:@')}><UserRound size={16} /></button>
        <button title="メンション先 (to:@)" aria-pressed={p.to.length > 0} onClick={() => startToken('to:@')}><AtSign size={16} /></button>
        <button title="チャンネル (in:#)" aria-pressed={!!p.in} onClick={() => startToken('in:#')}><Hash size={16} /></button>
        <button title="期間 (after: / before:)" aria-pressed={dates || !!(p.after || p.before)} onClick={() => setDates(d => !d)}><CalendarDays size={16} /></button>
        <span className="tool-sep" />
        {(Object.keys(HAS) as Has[]).map(h => (
          <button key={h} title={`${HAS[h].label}付き (has:${h})`} aria-pressed={p.has.has(h)} onClick={() => toggleHas(h)}>{HAS[h].icon}</button>
        ))}
        <button title="BOT の投稿 (is:bot)" aria-pressed={p.bot}
          onClick={() => setQ((p.bot ? without(t => t.toLowerCase() === 'is:bot') : [...tokens, 'is:bot']).join(' ') + ' ')}><Bot size={16} /></button>
        <span className="grow" />
        <span className="segmented" role="radiogroup" aria-label="並び順">
          {(['new', 'old', 'updated'] as Sort[]).map(so => (
            <button key={so} role="radio" aria-checked={p.sort === so} title={{ new: '新しい順', old: '古い順', updated: '更新順' }[so]}
              onClick={() => setToken('sort', so === 'new' ? undefined : so)}>
              {{ new: '新', old: '古', updated: '更新' }[so]}
            </button>
          ))}
        </span>
      </div>

      {dates && (
        <div className="date-range">
          <input type="date" value={p.after ?? ''} max={p.before} aria-label="この日から" onChange={e => setToken('after', e.target.value)} />
          <span className="faint">〜</span>
          <input type="date" value={p.before ?? ''} min={p.after} aria-label="この日まで" onChange={e => setToken('before', e.target.value)} />
        </div>
      )}

      {p.tokens.length > 0 && (
        <div className="filter-chips">
          {p.tokens.map(t => (
            <span key={t.raw} className={'filter-chip' + (t.ok ? '' : ' bad')} title={t.ok ? t.raw : `${t.raw} は使えません`}>
              {t.label}
              <button aria-label={`${t.raw} を外す`} onClick={() => removeRaw(t.raw)}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      <Results p={p} />
    </div>
  )
}

/** from:@ / to:@ / in:# を書きかけているときの候補 */
function Suggest({ last, onPick }: { last: string; onPick: (token: string) => void }) {
  const users = useStore(s => s.users)
  const paths = useStore(s => s.paths)
  const current = useStore(s => s.current)
  const m = last.match(/^(from|to|in):([@#]?)(.*)$/i)
  if (!m) return null
  const key = m[1].toLowerCase(), ql = m[3].toLowerCase()
  const items: { key: string; token: string; label: ReactNode }[] = key === 'in'
    ? [
      // いま開いているチャンネルを最初に
      ...(current && paths[current] && paths[current].toLowerCase().includes(ql) ? [current] : []),
      ...Object.keys(paths).filter(id => id !== current && paths[id].toLowerCase().includes(ql))
        .sort((a, b) => paths[a].length - paths[b].length),
    ].slice(0, 6).map(id => ({ key: id, token: `in:#${paths[id]}`, label: <><Hash size={14} className="faint" />{paths[id]}</> }))
    : Object.values(users)
      .filter(u => u.name.toLowerCase().includes(ql) || u.displayName.toLowerCase().includes(ql))
      .sort((a, b) => (+b.name.toLowerCase().startsWith(ql) - +a.name.toLowerCase().startsWith(ql)) || a.name.localeCompare(b.name))
      .slice(0, 6)
      .map(u => ({ key: u.id, token: `${key}:@${u.name}`, label: <><img src={userIcon(u)} alt="" />{u.displayName}<span className="faint">@{u.name}</span></> }))
  if (!items.length) return null
  return (
    <ul className="complete dropdown">
      {items.map(it => <li key={it.key} onMouseDown={e => { e.preventDefault(); onPick(it.token) }}>{it.label}</li>)}
    </ul>
  )
}

function Results({ p }: { p: Parsed }) {
  const [res, setRes] = useState<{ total: number; hits: Message[]; key: string } | null>()
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const hasFilter = !!(p.from.length || p.to.length || p.in || p.after || p.before || p.has.size || p.bot || p.cites)
  // 条件が同じなら再検索しない
  const key = JSON.stringify([p.word, p.from, p.to, p.in, p.after, p.before, [...p.has], p.bot, p.cites, p.sort])
  const fetchPage = (offset: number) => api.searchMessages(
    p.word || undefined, p.after && dayStart(p.after), p.before && dayAfter(p.before), p.in,
    p.to.length ? p.to : undefined, p.from.length ? p.from : undefined, p.cites, p.bot || undefined,
    p.has.has('url') || undefined, p.has.has('file') || undefined, p.has.has('image') || undefined,
    p.has.has('video') || undefined, p.has.has('audio') || undefined, PAGE, offset, SORT[p.sort],
  ).then(r => r.data)

  useEffect(() => {
    if (!p.word && !hasFilter) return setRes(undefined)
    let stale = false
    const t = setTimeout(() => {
      // 前の結果は消さずに薄くしておく (レイアウトを動かさない)
      setLoading(true)
      fetchPage(0).then(d => { if (!stale) setRes({ total: d.totalHits, hits: d.hits, key }) },
        () => { if (!stale) setRes({ total: -1, hits: [], key }) })
        .finally(() => { if (!stale) setLoading(false) })
    }, 300)
    return () => { stale = true; clearTimeout(t) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // 末尾が見えたら続きを読む
  useEffect(() => {
    if (!end.current || !res || res.hits.length >= res.total) return
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || more) return
      setMore(true)
      fetchPage(res.hits.length).then(d => setRes(r => r && r.key === key ? { ...r, hits: [...r.hits, ...d.hits] } : r))
        .finally(() => setMore(false))
    }, { root: end.current.closest('.side-body'), rootMargin: '0px 0px 300px 0px' })
    io.observe(end.current)
    return () => io.disconnect()
  }, [res, more]) // eslint-disable-line react-hooks/exhaustive-deps

  if (res === undefined) return loading ? <div className="loading-more"><span className="spinner" /></div> : <div className="side-empty"><Search size={56} /></div>
  if (res === null) return <div className="loading-more"><span className="spinner" /></div>
  if (res.total < 0) return <p className="side-note">検索できませんでした</p>
  return (
    <div className={'results' + (loading ? ' loading' : '')}>
      <div className="result-bar"><span><b>{res.total.toLocaleString()}</b> 件</span>{loading && <span className="spinner" />}</div>
      <ul className="cards flush">{res.hits.map(m => <MessageCard key={m.id} m={m} />)}</ul>
      {res.hits.length < res.total && <div ref={end} className="loading-more"><span className="spinner" /></div>}
    </div>
  )
}

/** cites: のチップに、引用元の書き出しを出す (読み込み済みのときだけ) */
function CitedHead({ id }: { id: string }) {
  const content = useStore(s => {
    for (const list of Object.values(s.messages)) { const m = list.find(x => x.id === id); if (m) return m.content }
  })
  if (!content) return <>引用</>
  const head = content.replace(/\s+/g, ' ')
  return <>「{head.slice(0, 16)}{head.length > 16 ? '…' : ''}」</>
}
