import { useEffect, useRef, useState, type ReactNode } from 'react'
import { UserAccountState, type UserDetail, type UserStats } from '@traptitech/traq'
import {
  Activity, ArrowLeft, AtSign, BellRing, Bookmark, Bot, Crown, Eye, EyeOff, Hash, Home, IdCard, MessageCircle, MessageSquare, Minus,
  Camera, Pencil, Pin, Plus, Search, Settings, Trash2, UserPlus, UserRound, UserSearch, Users, X,
} from 'lucide-react'
import { api, fileUrl, userIcon } from './api'
import { render } from './markdown'
import { GoneTag, GradeBadge, MessageCard, onMarkdownClick } from './Message'
import { LastOnline } from './Overlays'
import { SearchPanel } from './Search'
import {
  GROUP_NAME, NONE, addGroupMember, changeGroupIcon, createGroup, deleteGroup, editGroup, isGone, notifyError, removeGroupMember,
  setGroupRole, toggleGroupAdmin, labelOf, loadPins, loadSubscribers, openChannel, openDM, openSettings, openSide, toggleMyTag, useStore, type Side } from './store'

type PanelSide = Exclude<Side, { kind: 'thread' }>
const ICON: Record<PanelSide['kind'], typeof Search> = {
  search: Search, pins: Pin, clips: Bookmark, activity: Activity, user: IdCard, group: Users, tag: Hash, members: Eye, users: UserSearch,
}

/** スレッド以外の右パネル */
export function SidePanel() {
  const side = useStore(s => s.side) as PanelSide
  const here = useStore(s => (s.current ? labelOf(s, s.current) : ''))
  const Icon = ICON[side.kind]
  return (
    <section className="channel side-panel">
      <header className="ch-head">
        <div className="head-main">
          {'back' in side && side.back
            ? <button className="icon-btn back" title="戻る" onClick={() => openSide(side.back)}><ArrowLeft size={18} /></button>
            : <Icon size={18} className="crumb-hash" />}
          {side.kind === 'users' ? <UsersHead side={side} />
            : <h1 className="crumbs"><span className="leaf">{{
              search: '検索', pins: 'ピン留め', clips: 'クリップ', activity: 'アクティビティ', user: 'プロフィール', group: 'グループ', tag: 'タグ',
              members: here,
            }[side.kind]}</span></h1>}
        </div>
        <button className="icon-btn" title="閉じる" onClick={() => openSide()}><X size={18} /></button>
      </header>
      <div className="side-body">
        {side.kind === 'search' && <SearchPanel side={side} />}
        {side.kind === 'pins' && <Pins />}
        {side.kind === 'clips' && <Clips />}
        {side.kind === 'activity' && <ActivityList />}
        {side.kind === 'user' && <Profile key={side.userId} userId={side.userId} />}
        {side.kind === 'group' && <GroupDetail key={side.groupId} side={side} />}
        {side.kind === 'tag' && <TagDetail key={side.tagId} side={side} />}
        {side.kind === 'members' && <Members />}
        {side.kind === 'users' && <UserSearchList side={side} />}
      </div>
    </section>
  )
}

/* ---------- ピン / クリップ / アクティビティ ---------- */

function useList<T>(load: () => Promise<T[]>, deps: unknown[]) {
  const [list, setList] = useState<T[]>()
  useEffect(() => {
    let stale = false
    setList(undefined)
    load().then(l => { if (!stale) setList(l) }, () => { if (!stale) setList([]) })
    return () => { stale = true }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return list
}

function Pins() {
  const current = useStore(s => s.current)
  const pins = useStore(s => (s.current ? s.pins[s.current] : undefined))
  useEffect(() => { if (current) loadPins(current).catch(() => {}) }, [current])
  if (!pins) return <div className="loading-more"><span className="spinner" /></div>
  if (!pins.length) return <Empty icon={<Pin size={28} />} />
  return <ul className="cards">{pins.map(p => <MessageCard key={p.message.id} m={p.message} />)}</ul>
}

function Clips() {
  const folders = useStore(s => s.clipFolders)
  // クリップを付け外しすると clipped が変わるので、それに合わせて取り直す
  const clipped = useStore(s => s.clipped)
  const [folder, setFolder] = useState(folders[0]?.id)
  const fid = folder ?? folders[0]?.id
  const clips = useList(() => fid ? api.getClips(fid, 100).then(r => r.data) : Promise.resolve([]), [fid, clipped])
  return (
    <>
      {folders.length > 1 && (
        <div className="chips">
          {folders.map(f => <button key={f.id} className={'scope' + (f.id === fid ? ' on' : '')} onClick={() => setFolder(f.id)}>{f.name}</button>)}
        </div>
      )}
      {!clips ? <div className="loading-more"><span className="spinner" /></div>
        : !clips.length ? <Empty icon={<Bookmark size={28} />} />
          : <ul className="cards">{clips.map(c => <MessageCard key={c.message.id} m={c.message} />)}</ul>}
    </>
  )
}

function ActivityList() {
  const [all, setAll] = useState(false)
  const list = useList(() => api.getActivityTimeline(50, all, true).then(r => r.data), [all])
  return (
    <>
      <div className="chips">
        <button className={'scope' + (!all ? ' on' : '')} onClick={() => setAll(false)}>購読中</button>
        <button className={'scope' + (all ? ' on' : '')} onClick={() => setAll(true)}><Hash size={13} />すべて</button>
      </div>
      {!list ? <div className="loading-more"><span className="spinner" /></div>
        : !list.length ? <Empty icon={<Activity size={28} />} />
          : <ul className="cards">{list.map(m => <MessageCard key={m.id} m={m} />)}</ul>}
    </>
  )
}

function Empty({ icon }: { icon: React.ReactNode }) {
  return <div className="side-empty">{icon}</div>
}

/* ---------- プロフィール ---------- */

const detailCache = new Map<string, Promise<UserDetail>>()

/** ユーザー詳細。自分なら編集がすぐ反映されるよう手元の me を返す */
export function useUserDetail(userId: string): UserDetail | undefined {
  const me = useStore(s => (s.me?.id === userId ? s.me : undefined))
  const [d, setD] = useState<UserDetail>()
  useEffect(() => {
    if (me) return
    let p = detailCache.get(userId)
    if (!p) {
      detailCache.set(userId, (p = api.getUser(userId).then(r => r.data)))
      p.catch(() => detailCache.delete(userId))
    }
    p.then(setD, () => {})
  }, [userId, me])
  return me ?? d
}

function Profile({ userId }: { userId: string }) {
  const user = useStore(s => s.users[userId])
  const isMe = useStore(s => s.me?.id === userId)
  const online = useStore(s => !!s.onlineUsers[userId])
  const groups = useStore(s => s.groups)
  const stamps = useStore(s => s.stamps)
  const d = useUserDetail(userId)
  const homePath = useStore(s => (d?.homeChannel ? s.paths[d.homeChannel] : undefined))
  const stats = useList<UserStats>(() => api.getUserStats(userId).then(r => [r.data]), [userId])?.[0]
  const posts = useList(() => api.searchMessages(undefined, undefined, undefined, undefined, undefined, [userId],
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, 20, 0, 'createdAt').then(r => r.data.hits), [userId])
  const [tab, setTab] = useState<'posts' | 'groups' | 'tags'>('posts')
  if (!user) return null
  const groupNames = (d?.groups ?? []).map(id => groups[id]?.name).filter(Boolean)

  return (
    <div className="profile">
      <div className="profile-hero">
        <span className={'user-icon big' + (isGone(user) ? ' gone' : '')}>
          <img src={userIcon(user)} alt="" />
          {online && <span className="online" />}
        </span>
        <div className="user-names">
          <b>{user.displayName}</b>
          <span className="faint">@{user.name}{user.bot ? <span className="bot">BOT</span> : <GradeBadge userId={user.id} />}{isGone(user) && <GoneTag />}</span>
          {!online && d?.lastOnline && <LastOnline iso={d.lastOnline} />}
        </div>
      </div>
      <div className="card-actions">
        {isMe
          ? <button className="primary" onClick={() => openSettings('profile')}><Settings size={15} /> 編集</button>
          : <button className="primary" onClick={() => openDM(userId)}><MessageCircle size={15} /> DM</button>}
      </div>
      {d?.bio && <Bio text={d.bio} />}
      <dl className="facts">
        {homePath && (
          <div><dt title="ホームチャンネル"><Home size={15} /></dt>
            <dd><a href={'/channels/' + homePath} onClick={e => { e.preventDefault(); openChannel(d!.homeChannel!) }}>#{homePath}</a></dd></div>
        )}
        {d?.twitterId && (
          <div><dt title="X (Twitter)"><AtSign size={15} /></dt>
            <dd><a href={'https://x.com/' + d.twitterId} target="_blank" rel="noopener noreferrer">{d.twitterId}</a></dd></div>
        )}
        {stats && (
          <div><dt title="投稿数"><MessageSquare size={15} /></dt><dd><b>{stats.totalMessageCount.toLocaleString()}</b></dd></div>
        )}
      </dl>
      {stats && stats.stamps.length > 0 && (
        <div className="stamp-stats" title="よく使うスタンプ">
          {[...stats.stamps].sort((a, b) => b.count - a.count).slice(0, 10).map(st => stamps[st.id] && (
            <span key={st.id} className="stamp" title={`:${stamps[st.id].name}:`}>
              <img src={fileUrl(stamps[st.id].fileId)} alt="" /><span>{st.count}</span>
            </span>
          ))}
        </div>
      )}
      {/* グループ・タグは数が多いので、投稿と並べたタブの奥にしまう */}
      <div className="profile-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'posts'} title="最近の投稿" onClick={() => setTab('posts')}><MessageSquare size={15} /></button>
        <button role="tab" aria-selected={tab === 'groups'} title="グループ" onClick={() => setTab('groups')}>
          <Users size={15} /><span>{groupNames.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'tags'} title="タグ" onClick={() => setTab('tags')}>
          <Hash size={15} /><span>{d?.tags.length ?? 0}</span>
        </button>
      </div>
      {tab === 'posts' && (!posts ? <div className="loading-more"><span className="spinner" /></div>
        : posts.length ? <ul className="cards">{posts.map(m => <MessageCard key={m.id} m={m} />)}</ul> : <Empty icon={<MessageSquare size={28} />} />)}
      {tab === 'groups' && <ChipList group items={(d?.groups ?? []).filter(id => groups[id]).map(id => ({
        key: id, label: groups[id].name, open: () => openSide({ kind: 'group', groupId: id, back: { kind: 'user', userId } }),
      }))} />}
      {tab === 'tags' && <ChipList items={(d?.tags ?? []).map(t => ({
        key: t.tagId, label: t.tag, open: () => openSide({ kind: 'tag', tagId: t.tagId, back: { kind: 'user', userId } }),
      }))} />}
    </div>
  )
}

/** 自己紹介はメッセージと同じ記法で描画する (スタンプ・メンション・リンク) */
export function Bio({ text, clamp }: { text: string; clamp?: boolean }) {
  return <div className={'bio md' + (clamp ? ' clamp3' : '')} onClick={onMarkdownClick}
    dangerouslySetInnerHTML={{ __html: render(text).renderedText }} />
}

type Chip = { key: string; label: string; open: () => void }

/** 多いときだけ絞り込み欄を出す。押すと詳細へ */
function ChipList({ items, group }: { items: Chip[]; group?: boolean }) {
  const [q, setQ] = useState('')
  if (!items.length) return <Empty icon={group ? <Users size={28} /> : <Hash size={28} />} />
  const shown = items.filter(x => x.label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="chip-list">
      {items.length > 12 && <input className="side-search" value={q} onChange={e => setQ(e.target.value)} placeholder="絞り込み" />}
      <div className="tags">
        {shown.map(x => <button key={x.key} className={'tag' + (group ? ' group' : '')} onClick={x.open}>{x.label}</button>)}
      </div>
    </div>
  )
}

/** ユーザーの一覧。押すとプロフィールへ (戻るでここに帰ってくる) */
function UserList({ ids, back, note, filter = true }: { ids: string[]; back: Side; note?: (id: string) => ReactNode; filter?: boolean }) {
  const users = useStore(s => s.users)
  const online = useStore(s => s.onlineUsers)
  const [q, setQ] = useState('')
  const ql = q.toLowerCase()
  const shown = ids.filter(id => users[id] && (users[id].name.toLowerCase().includes(ql) || users[id].displayName.toLowerCase().includes(ql)))
  return (
    <>
      {filter && ids.length > 12 && <input className="side-search" value={q} onChange={e => setQ(e.target.value)} placeholder="絞り込み" />}
      <ul className="user-list">
        {shown.map(id => (
          <li key={id}>
            <button className={'user-row' + (isGone(users[id]) ? ' gone' : '')} onClick={() => openSide({ kind: 'user', userId: id, back })}>
              <span className="user-icon"><img className="avatar" src={userIcon(users[id])} alt="" />{online[id] && <span className="online" />}</span>
              <span className="user-names"><b>{users[id].displayName}</b><span className="faint">@{users[id].name}</span></span>
              {note?.(id)}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function GroupDetail({ side }: { side: Extract<Side, { kind: 'group' }> }) {
  const g = useStore(s => s.groups[side.groupId])
  const users = useStore(s => s.users)
  const meId = useStore(s => s.me!.id)
  const [name, setName] = useState(g?.name ?? '')
  const [desc, setDesc] = useState(g?.description ?? '')
  const [type, setType] = useState(g?.type ?? '')
  // 取り消しやほかの端末での変更を入力欄にも反映する
  useEffect(() => { if (g) { setName(g.name); setDesc(g.description); setType(g.type) } }, [g?.name, g?.description, g?.type])
  if (!g) return <Empty icon={<Users size={28} />} />
  const canEdit = g.admins.includes(meId)
  const admins = new Set(g.admins)
  const roles = Object.fromEntries(g.members.map(m => [m.id, m.role]))
  // 管理者を先に、あとは名前順
  const ids = [...new Set([...g.admins, ...g.members.map(m => m.id)])]
    .sort((a, b) => (+admins.has(b) - +admins.has(a)) || (users[a]?.name ?? '').localeCompare(users[b]?.name ?? ''))
  const icon = g.icon ? <img className="group-icon" src={fileUrl(g.icon)} alt="" /> : <span className="group-icon"><Users size={36} /></span>
  const badName = !GROUP_NAME.test(name)

  return (
    <div className="profile">
      <div className="profile-hero">
        {canEdit ? (
          <label className="user-icon editable" title="アイコンを変更">
            {icon}<Camera size={20} />
            <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) changeGroupIcon(g.id, f); e.target.value = '' }} />
          </label>
        ) : icon}
        <div className="user-names">
          {canEdit ? (
            <input className="inline-edit name" value={name} maxLength={30} aria-label="グループ名" aria-invalid={badName}
              onChange={e => setName(e.target.value)}
              onBlur={() => { if (!badName && name !== g.name) editGroup(g.id, { name }); else setName(g.name) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur() }} />
          ) : <b>{g.name}</b>}
          <span className="faint group-meta">
            {canEdit ? (
              <input className="inline-edit type" value={type} maxLength={30} placeholder="種類" aria-label="種類"
                onChange={e => setType(e.target.value)} onBlur={() => { if (type !== g.type) editGroup(g.id, { type }) }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur() }} />
            ) : g.type && <span className="tag">{g.type}</span>}
            <Users size={13} /> {g.members.length}
          </span>
        </div>
        {canEdit && <button className="icon-btn danger-icon" title="グループを削除" onClick={() => deleteGroup(g.id)}><Trash2 size={17} /></button>}
      </div>
      {canEdit ? (
        <textarea className="inline-edit bio" rows={2} value={desc} maxLength={100} placeholder="説明"
          onChange={e => setDesc(e.target.value)} onBlur={() => { if (desc !== g.description) editGroup(g.id, { description: desc }) }} />
      ) : g.description && <Bio text={g.description} />}
      {canEdit && <MemberAdder group={g} />}
      {canEdit ? (
        <ul className="user-list members">
          {ids.map(id => <MemberRow key={id} groupId={g.id} userId={id} role={roles[id] ?? ''} admin={admins.has(id)}
            member={id in roles} back={side} isMe={id === meId} />)}
        </ul>
      ) : (
        <UserList ids={ids} back={side} note={id => (
          <span className="member-note">
            {roles[id] && <span className="faint">{roles[id]}</span>}
            {admins.has(id) && <Crown size={14} className="admin-mark" aria-label="管理者" />}
          </span>
        )} />
      )}
    </div>
  )
}

/** 管理者用のメンバー行。役割はその場で編集、王冠で管理者の切り替え、× で外す */
function MemberRow({ groupId, userId, role, admin, member, back, isMe }: {
  groupId: string; userId: string; role: string; admin: boolean; member: boolean; back: Side; isMe: boolean
}) {
  const u = useStore(s => s.users[userId])
  const online = useStore(s => !!s.onlineUsers[userId])
  const [r, setR] = useState(role)
  const [arm, setArm] = useState(false)
  useEffect(() => setR(role), [role])
  if (!u) return null
  // 自分の管理者権限を外すと元に戻せないことがあるので、2回押しで確定する
  const crown = () => { if (admin && isMe && !arm) return setArm(true); setArm(false); toggleGroupAdmin(groupId, userId) }
  return (
    <li className="member-row">
      <button className={'user-row' + (isGone(u) ? ' gone' : '')} onClick={() => openSide({ kind: 'user', userId, back })}>
        <span className="user-icon"><img className="avatar" src={userIcon(u)} alt="" />{online && <span className="online" />}</span>
        <span className="user-names"><b>{u.displayName}</b><span className="faint">@{u.name}</span></span>
      </button>
      {member && (
        <input className="role-input" value={r} placeholder="役割" maxLength={100} aria-label={`@${u.name} の役割`}
          onChange={e => setR(e.target.value)} onBlur={() => setGroupRole(groupId, userId, r.trim())}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur() }} />
      )}
      <button className={'icon-btn crown' + (admin ? ' on' : '') + (arm ? ' armed' : '')} aria-pressed={admin}
        title={arm ? 'もう一度押すと自分が管理者から外れます' : admin ? '管理者から外す' : '管理者にする'}
        onClick={crown} onBlur={() => setArm(false)}><Crown size={15} /></button>
      {member && <button className="icon-btn danger-icon" title="グループから外す" onClick={() => removeGroupMember(groupId, userId)}><X size={15} /></button>}
    </li>
  )
}

/** ユーザー名で探してメンバーに足す */
function MemberAdder({ group }: { group: { id: string; members: { id: string }[] } }) {
  const users = useStore(s => s.users)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const ql = q.trim().toLowerCase().replace(/^@/, '')
  const inGroup = new Set(group.members.map(m => m.id))
  const cands = !ql ? [] : Object.values(users)
    .filter(u => u.state === UserAccountState.active && !inGroup.has(u.id)
      && (u.name.toLowerCase().includes(ql) || u.displayName.toLowerCase().includes(ql)))
    .sort((a, b) => (+b.name.toLowerCase().startsWith(ql) - +a.name.toLowerCase().startsWith(ql)) || a.name.localeCompare(b.name))
    .slice(0, 6)
  const add = (id: string) => { addGroupMember(group.id, id); setQ(''); setSel(0) }
  const i = Math.min(sel, cands.length - 1)
  return (
    <div className="member-adder">
      <label className="adder-input"><UserPlus size={16} />
        <input value={q} placeholder="メンバーを追加" onChange={e => { setQ(e.target.value); setSel(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSel((i + (e.key === 'ArrowDown' ? 1 : cands.length - 1)) % Math.max(1, cands.length)) }
            else if (e.key === 'Enter' && cands[i] && !e.nativeEvent.isComposing) add(cands[i].id)
            else if (e.key === 'Escape') setQ('')
          }} />
      </label>
      {cands.length > 0 && (
        <ul className="complete static" role="listbox">
          {cands.map((u, j) => (
            <li key={u.id} role="option" aria-selected={j === i} onMouseEnter={() => setSel(j)} onMouseDown={e => { e.preventDefault(); add(u.id) }}>
              <img src={userIcon(u)} alt="" /><span>{u.displayName}</span><span className="faint">@{u.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TagDetail({ side }: { side: Extract<Side, { kind: 'tag' }> }) {
  const tag = useList(() => api.getTag(side.tagId).then(r => [r.data]), [side.tagId])?.[0]
  const me = useStore(s => s.me)!
  const mine = me.tags.some(t => t.tagId === side.tagId)
  if (!tag) return <div className="loading-more"><span className="spinner" /></div>
  return (
    <div className="profile">
      <div className="profile-hero">
        <span className="group-icon"><Hash size={36} /></span>
        <div className="user-names"><b>{tag.tag}</b><span className="faint group-meta"><Users size={13} /> {tag.users.length}</span></div>
      </div>
      <div className="card-actions">
        <button className={mine ? 'ghost' : 'primary'} onClick={() => toggleMyTag(tag.tag, side.tagId, mine)}>
          {mine ? <><Minus size={15} /> 自分から外す</> : <><Plus size={15} /> 自分にも付ける</>}
        </button>
      </div>
      <UserList ids={tag.users} back={side} />
    </div>
  )
}

/* ---------- チャンネルのメンバー (見ている人 / 購読者) ---------- */

const VIEW_ICON: Record<string, ReactNode> = {
  editing: <Pencil size={14} aria-label="入力中" />,
  monitoring: <Eye size={14} aria-label="見ている" />,
}

function Members() {
  const cid = useStore(s => s.current)!
  const viewers = useStore(s => s.viewers[cid] ?? NONE)
  const isDm = useStore(s => !!s.dms[cid])
  const subscribers = useStore(s => (isDm ? NONE : s.subscribers[cid]))
  useEffect(() => { if (!isDm) loadSubscribers(cid).catch(() => {}) }, [cid, isDm])
  const [tab, setTab] = useState<'viewers' | 'subscribers'>('viewers')
  // 入力中 → 見ている → 裏で開いているだけ、の順
  const order = (st: string) => (st === 'editing' ? 0 : st === 'monitoring' ? 1 : 2)
  const sorted = [...viewers].sort((a, b) => order(a.state) - order(b.state))
  const state = Object.fromEntries(viewers.map(v => [v.userId, v.state]))
  return (
    <div className="profile">
      <div className="profile-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'viewers'} title="見ている人" onClick={() => setTab('viewers')}>
          <Eye size={15} /><span>{viewers.length}</span>
        </button>
        {!isDm && (
          <button role="tab" aria-selected={tab === 'subscribers'} title="通知を受け取っている人" onClick={() => setTab('subscribers')}>
            <BellRing size={15} /><span>{subscribers?.length ?? '…'}</span>
          </button>
        )}
      </div>
      {tab === 'viewers' && (sorted.length
        ? <UserList ids={sorted.map(v => v.userId)} back={{ kind: 'members' }} note={id => (
          <span className={'view-state ' + state[id]}>{VIEW_ICON[state[id]] ?? <EyeOff size={14} aria-label="別のタブ" />}</span>
        )} />
        : <Empty icon={<Eye size={28} />} />)}
      {tab === 'subscribers' && (!subscribers ? <div className="loading-more"><span className="spinner" /></div>
        : subscribers.length ? <UserList ids={subscribers} back={{ kind: 'members' }} /> : <Empty icon={<BellRing size={28} />} />)}
    </div>
  )
}

/* ---------- ユーザー検索 ---------- */

function UsersHead({ side }: { side: Extract<Side, { kind: 'users' }> }) {
  return (
    <input className="side-search" autoFocus value={side.q} placeholder={side.who === 'groups' ? 'グループを検索' : 'ユーザーを検索'}
      onChange={e => openSide({ ...side, q: e.target.value })}
      onKeyDown={e => { if (e.key === 'Escape') openSide() }} />
  )
}

function UserSearchList({ side }: { side: Extract<Side, { kind: 'users' }> }) {
  const users = useStore(s => s.users)
  const online = useStore(s => s.onlineUsers)
  const who = side.who ?? 'people'
  const q = side.q.trim().toLowerCase().replace(/^@/, '')
  const top = useRef<HTMLDivElement>(null)
  // 条件を変えたら一覧の先頭から見せる
  useEffect(() => { top.current?.closest('.side-body')?.scrollTo({ top: 0 }) }, [q, side.online, who])
  // 人・BOT・グループは切り替え
  const hits = who === 'groups' ? [] : Object.values(users)
    // 凍結済みは検索語があるときだけ、最後に出す
    .filter(u => (u.state === UserAccountState.active || q) && u.bot === (who === 'bots') && (!side.online || online[u.id])
      && (!q || u.name.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)))
    .sort((a, b) => (+isGone(a) - +isGone(b)) || (+!!online[b.id] - +!!online[a.id])
      || (+b.name.toLowerCase().startsWith(q) - +a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
  // ponytail: 先頭 100 人だけ描画。絞り込めば十分届く
  const shown = hits.slice(0, 100)
  const seg = (v: typeof who, icon: ReactNode, label: string) => (
    <button role="radio" aria-checked={who === v} onClick={() => openSide({ ...side, who: v })}>{icon}{label}</button>
  )
  return (
    <div className="profile" ref={top}>
      <div className="chips flush">
        <span className="segmented" role="radiogroup" aria-label="種類">
          {seg('people', <UserRound size={13} />, '人')}
          {seg('bots', <Bot size={13} />, 'BOT')}
          {seg('groups', <Users size={13} />, 'グループ')}
        </span>
        {who !== 'groups' && (
          <button className={'scope' + (side.online ? ' on' : '')} aria-pressed={!!side.online}
            onClick={() => openSide({ ...side, online: !side.online })}><span className="online-dot" />オンライン</button>
        )}
        <span className="grow" />
        {who !== 'groups' && <span className="faint side-count-inline">{hits.length}</span>}
      </div>
      {who === 'groups' ? <GroupList side={side} q={q} />
        : shown.length ? <UserList ids={shown.map(u => u.id)} back={side} filter={false} /> : <Empty icon={<UserSearch size={28} />} />}
    </div>
  )
}

/** グループ一覧。自分が管理しているものを先に。先頭の行から新しく作れる */
function GroupList({ side, q }: { side: Side; q: string }) {
  const groups = useStore(s => s.groups)
  const meId = useStore(s => s.me!.id)
  const [name, setName] = useState<string>()
  const [busy, setBusy] = useState(false)
  const list = Object.values(groups)
    .filter(g => !q || g.name.toLowerCase().includes(q) || g.type.toLowerCase().includes(q))
    .sort((a, b) => (+b.admins.includes(meId) - +a.admins.includes(meId))
      || (+b.members.some(m => m.id === meId) - +a.members.some(m => m.id === meId)) || a.name.localeCompare(b.name))
    .slice(0, 100)
  const bad = name !== undefined && name !== '' && !GROUP_NAME.test(name)
  const submit = async () => {
    if (!name || bad) return
    setBusy(true)
    try {
      const id = await createGroup(name)
      setName(undefined)
      openSide({ kind: 'group', groupId: id, back: side })
    } catch { notifyError('グループを作成できませんでした。同じ名前が無いか確認してください') } finally { setBusy(false) }
  }
  return (
    <>
      {name === undefined
        ? <button className="palette-new small" onClick={() => setName('')}><Plus size={16} /> 新しいグループ</button>
        : (
          <label className={'adder-input' + (bad ? ' bad' : '')}><Users size={16} />
            <input autoFocus value={name} disabled={busy} placeholder="グループ名" maxLength={30} aria-invalid={bad}
              onChange={e => setName(e.target.value)} onBlur={() => { if (!name) setName(undefined) }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); if (e.key === 'Escape') setName(undefined) }} />
            {busy && <span className="spinner" />}
          </label>
        )}
      {list.length ? (
        <ul className="user-list">
          {list.map(g => (
            <li key={g.id}>
              <button className="user-row" onClick={() => openSide({ kind: 'group', groupId: g.id, back: side })}>
                {g.icon ? <img className="avatar group-thumb" src={fileUrl(g.icon)} alt="" /> : <span className="group-thumb"><Users size={16} /></span>}
                <span className="user-names"><b>{g.name}</b><span className="faint">{g.type && <span className="tag">{g.type}</span>} {g.members.length}</span></span>
                {g.admins.includes(meId) && <Crown size={14} className="admin-mark" aria-label="管理しているグループ" />}
              </button>
            </li>
          ))}
        </ul>
      ) : <Empty icon={<Users size={28} />} />}
    </>
  )
}
