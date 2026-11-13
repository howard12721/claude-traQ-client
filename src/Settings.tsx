import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { LoginSession } from '@traptitech/traq'
import { AtSign, Bell, BellRing, Camera, Home, LogOut, MessageCircle, Monitor, Moon, Plus, Shield, SmilePlus, Sun, SunMoon, Trash2, UserRound, X } from 'lucide-react'
import { api, fileUrl, userIcon } from './api'
import {
  NONE, changeIcon, closeSettings, createPalette, deletePalette, editPalette, editProfile, notifyError, openPicker, openSettings,
  setHome, setNotify, setTheme, toggleInPalette, useStore,
  type SettingsTab, type Theme,
} from './store'

const TABS: { id: SettingsTab; icon: ReactNode; label: string }[] = [
  { id: 'profile', icon: <UserRound size={17} />, label: 'プロフィール' },
  { id: 'palettes', icon: <SmilePlus size={17} />, label: 'スタンプパレット' },
  { id: 'appearance', icon: <SunMoon size={17} />, label: '表示' },
  { id: 'notification', icon: <Bell size={17} />, label: '通知' },
  { id: 'security', icon: <Shield size={17} />, label: 'セキュリティ' },
]

export function Settings() {
  const tab = useStore(s => s.settings)!
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof Element && e.target.closest('input, textarea, select'))) closeSettings()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  return (
    <section className="settings">
      <nav className="settings-nav">
        {TABS.map(t => (
          <a key={t.id} href={'/settings/' + t.id} aria-current={t.id === tab ? 'page' : undefined}
            onClick={e => { e.preventDefault(); openSettings(t.id) }}>
            {t.icon}<span>{t.label}</span>
          </a>
        ))}
        <span className="grow" />
        <button className="logout" onClick={() => api.logout().finally(() => location.assign('/'))}>
          <LogOut size={17} /><span>ログアウト</span>
        </button>
      </nav>
      <div className="settings-body">
        <button className="icon-btn settings-close" title="閉じる" onClick={closeSettings}><X size={20} /></button>
        {tab === 'profile' && <ProfileTab />}
        {tab === 'palettes' && <PalettesTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'notification' && <NotificationTab />}
        {tab === 'security' && <SecurityTab />}
      </div>
    </section>
  )
}

/** 左にラベル、右に入力。フォーカスが外れたら保存 (トーストから取り消せる) */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field-row"><span className="field-label">{label}</span>{children}</label>
}

function ProfileTab() {
  const me = useStore(s => s.me)!
  const paths = useStore(s => s.paths)
  const [name, setName] = useState(me.displayName)
  const [bio, setBio] = useState(me.bio)
  const [twitter, setTwitter] = useState(me.twitterId)
  // 取り消しで me が戻ったら入力欄も戻す
  useEffect(() => { setName(me.displayName); setBio(me.bio); setTwitter(me.twitterId) }, [me.displayName, me.bio, me.twitterId])
  const options = Object.entries(paths).sort((a, b) => a[1].localeCompare(b[1]))

  return (
    <div className="settings-page">
      <div className="profile-hero">
        <label className="user-icon big editable" title="アイコンを変更">
          <img src={userIcon(me)} alt="" />
          <Camera size={22} />
          <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) changeIcon(f); e.target.value = '' }} />
        </label>
        <div className="user-names"><b>{name || me.name}</b><span className="faint">@{me.name}</span></div>
      </div>
      <Field label="表示名">
        <input value={name} maxLength={32} placeholder={me.name} onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim() !== me.displayName) editProfile({ displayName: name.trim() }) }} />
      </Field>
      <Field label="自己紹介">
        <textarea rows={5} value={bio} maxLength={1000} onChange={e => setBio(e.target.value)}
          onBlur={() => { if (bio !== me.bio) editProfile({ bio }) }} />
      </Field>
      <Field label="ホーム">
        <span className="select-wrap">
          <Home size={15} />
          <select value={me.homeChannel ?? ''} onChange={e => setHome(e.target.value || null)}>
            <option value="">なし</option>
            {options.map(([id, p]) => <option key={id} value={id}>#{p}</option>)}
          </select>
        </span>
      </Field>
      <Field label="X (Twitter)">
        <span className="prefixed"><span>@</span>
          <input value={twitter} maxLength={15} pattern="[a-zA-Z0-9_]*" onChange={e => setTwitter(e.target.value)}
            onBlur={e => { if (twitter !== me.twitterId && e.currentTarget.validity.valid) editProfile({ twitterId: twitter }) }} />
        </span>
      </Field>
    </div>
  )
}

function PalettesTab() {
  const palettes = useStore(s => s.palettes)
  const [fresh, setFresh] = useState<string>()
  const add = () => createPalette().then(setFresh, () => notifyError('パレットを作成できませんでした'))
  return (
    <div className="settings-page wide">
      {palettes.map(p => <PaletteCard key={p.id} id={p.id} autoFocus={p.id === fresh} />)}
      <button className="palette-new" onClick={add}><Plus size={18} /> 新しいパレット</button>
    </div>
  )
}

/** パレット1つ分。名前はその場で編集、スタンプはドラッグで並べ替え、× で外す */
function PaletteCard({ id, autoFocus }: { id: string; autoFocus: boolean }) {
  const p = useStore(s => s.palettes.find(x => x.id === id))!
  const stamps = useStore(s => s.stamps)
  const [name, setName] = useState(p.name)
  const [over, setOver] = useState<number>()
  const drag = useRef<number>(undefined)
  useEffect(() => setName(p.name), [p.name])
  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...p.stamps]
    next.splice(to, 0, ...next.splice(from, 1))
    editPalette(id, { stamps: next })
  }
  return (
    <section className="palette-card">
      <header>
        <input className="inline-edit name" value={name} maxLength={30} aria-label="パレット名" autoFocus={autoFocus}
          onFocus={e => { if (autoFocus) e.currentTarget.select() }}
          onChange={e => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== p.name) editPalette(id, { name: name.trim() }); else setName(p.name) }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur() }} />
        <span className="faint count">{p.stamps.length}/200</span>
        <button className="icon-btn danger-icon" title="パレットを削除" onClick={() => deletePalette(id)}><Trash2 size={17} /></button>
      </header>
      <div className="palette-grid" onDragOver={e => e.preventDefault()}>
        {p.stamps.map((sid, i) => stamps[sid] && (
          <span key={sid} className={'palette-stamp' + (over === i ? ' over' : '')} draggable title={`:${stamps[sid].name}:`}
            onDragStart={() => { drag.current = i }}
            onDragEnter={() => setOver(i)}
            onDragEnd={() => { drag.current = undefined; setOver(undefined) }}
            onDrop={() => { if (drag.current !== undefined) move(drag.current, i); setOver(undefined) }}>
            <img src={fileUrl(stamps[sid].fileId)} alt={stamps[sid].name} />
            <button aria-label={`:${stamps[sid].name}: を外す`} onClick={() => toggleInPalette(id, sid)}><X size={11} /></button>
          </span>
        ))}
        <button className="palette-add" title="スタンプを追加"
          onClick={e => openPicker(e.currentTarget, sid => toggleInPalette(id, sid),
            { multi: true, selected: s => s.palettes.find(x => x.id === id)?.stamps ?? NONE })}>
          <Plus size={18} />
        </button>
      </div>
    </section>
  )
}

const THEMES: { id: Theme; icon: ReactNode; label: string }[] = [
  { id: 'system', icon: <Monitor size={16} />, label: 'システム' },
  { id: 'light', icon: <Sun size={16} />, label: 'ライト' },
  { id: 'dark', icon: <Moon size={16} />, label: 'ダーク' },
]

function AppearanceTab() {
  const theme = useStore(s => s.theme)
  return (
    <div className="settings-page">
      <div className="themes" role="radiogroup" aria-label="テーマ">
        {THEMES.map(t => (
          <button key={t.id} role="radio" aria-checked={theme === t.id} className={'theme-pick ' + t.id} onClick={() => setTheme(t.id)}>
            <span className="theme-mock" aria-hidden><i /><i /><i /></span>
            <span className="theme-label">{t.icon}{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ on, onChange, disabled, children }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={'toggle-row' + (disabled ? ' disabled' : '')}>
      <span>{children}</span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

function NotificationTab() {
  const notify = useStore(s => s.notify)
  const [citation, setCitation] = useState<boolean>()
  const supported = 'Notification' in window
  const denied = supported && Notification.permission === 'denied'
  useEffect(() => { api.getMyNotifyCitation().then(r => setCitation(r.data.notifyCitation)) }, [])
  const changeCitation = (v: boolean) => {
    setCitation(v)
    api.changeMyNotifyCitation({ notifyCitation: v }).catch(() => { setCitation(!v); notifyError('設定を保存できませんでした') })
  }
  return (
    <div className="settings-page">
      <Toggle on={notify && !denied} disabled={!supported || denied} onChange={setNotify}>
        <b>デスクトップ通知</b>
        {denied ? <span className="warn">ブラウザで通知がブロックされています</span> : (
          <span className="triggers" aria-label="メンション・DM・すべて通知のチャンネル">
            <AtSign size={14} /><MessageCircle size={14} /><BellRing size={14} />
          </span>
        )}
      </Toggle>
      <Toggle on={!!citation} disabled={citation === undefined} onChange={changeCitation}>
        <b>引用されたら通知</b>
      </Toggle>
    </div>
  )
}

function SecurityTab() {
  const [sessions, setSessions] = useState<LoginSession[]>()
  const [arm, setArm] = useState<string>()
  useEffect(() => { api.getMySessions().then(r => setSessions(r.data.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)))) }, [])
  // サーバー側で取り消せない操作なので、トーストではなく2段階で確定する
  const revoke = (id: string) => {
    if (arm !== id) return setArm(id)
    api.revokeMySession(id).then(() => setSessions(s => s?.filter(x => x.id !== id)), () => notifyError('ログアウトさせられませんでした'))
    setArm(undefined)
  }
  return (
    <div className="settings-page">
      <PasswordForm />
      <ul className="sessions">
        {sessions?.map(s => (
          <li key={s.id}>
            <Monitor size={18} className="faint" />
            <span className="grow">{new Date(s.issuedAt).toLocaleString('ja-JP')}</span>
            <button className={arm === s.id ? 'danger-btn' : 'ghost'} onClick={() => revoke(s.id)} onBlur={() => setArm(undefined)}>
              {arm === s.id ? 'もう一度押すとログアウト' : 'ログアウトさせる'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PasswordForm() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    setState('busy')
    try {
      await api.changeMyPassword({ password: String(f.get('current')), newPassword: String(f.get('next')) })
      form.reset()
      setState('done')
    } catch { setState('error') }
  }
  return (
    <form className={'password' + (state === 'error' ? ' shake' : '')} onSubmit={submit}>
      <input name="current" type="password" placeholder="現在のパスワード" autoComplete="current-password" required
        aria-invalid={state === 'error'} />
      <input name="next" type="password" placeholder="新しいパスワード" autoComplete="new-password" required minLength={10} maxLength={32} />
      <button className="primary" disabled={state === 'busy'}>{state === 'done' ? '変更しました' : 'パスワードを変更'}</button>
    </form>
  )
}
