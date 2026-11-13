import { useEffect, useState, type FormEvent } from 'react'
import { api } from './api'
import { connect } from './realtime'
import { boot, syncRoute, undo, useStore } from './store'
import { Sidebar } from './Sidebar'
import { ChannelView, ThreadPanel, ViewerRail } from './ChannelView'
import { Palette, StampPicker, Toasts, UserCard } from './Overlays'
import { SidePanel } from './Panels'
import { Settings } from './Settings'

/** ログインできたら一度だけ: URL に合わせて開き、WebSocket とショートカットを用意する */
let started = false
function afterLogin() {
  syncRoute()
  if (started) return
  started = true
  connect()
  addEventListener('popstate', syncRoute)
  addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey
    const typing = e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')
    if (mod && e.key === 'k') { e.preventDefault(); useStore.setState(s => ({ palette: !s.palette })) }
    else if (mod && e.key === 'z' && !e.shiftKey && !typing) { e.preventDefault(); undo() }
  })
}

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready'>('loading')
  const start = () => boot().then(() => { afterLogin(); setPhase('ready') }, () => setPhase('login'))
  useEffect(() => { start() }, [])
  if (phase === 'loading') return <div className="splash"><span className="spinner" /></div>
  if (phase === 'login') return <Login onDone={start} />
  return <Shell />
}

function Login({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(0)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      await api.login(undefined, { name: String(f.get('name')), password: String(f.get('password')) })
      onDone()
    } catch { setFailed(n => n + 1) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      {/* 失敗するたびに key を変えて揺れのアニメーションをやり直す */}
      <form onSubmit={submit} key={failed} className={failed ? 'shake' : ''} aria-invalid={failed > 0}>
        <div className="wordmark">traQ</div>
        <input name="name" placeholder="traQ ID" autoComplete="username" autoFocus required />
        <input name="password" type="password" placeholder="パスワード" autoComplete="current-password" required />
        <button disabled={busy}>{busy ? <span className="spinner" /> : 'ログイン'}</button>
      </form>
    </div>
  )
}

function Shell() {
  const current = useStore(s => s.current)
  const navOpen = useStore(s => s.navOpen)
  const online = useStore(s => s.online)
  const side = useStore(s => s.side)
  const settings = useStore(s => s.settings)

  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      {!online && <div className="offline" title="再接続しています" />}
      <Sidebar />
      <div className="scrim" onClick={() => useStore.setState({ navOpen: false })} />
      <main className={!settings && side ? 'with-side' : ''}>
        {settings ? <Settings /> : current && <ChannelView key={current} id={current} />}
        {!settings && side?.kind === 'thread' && <ThreadPanel key={side.parent.id + (side.id ?? '')} side={side} />}
        {!settings && side && side.kind !== 'thread' && <SidePanel />}
        {!settings && current && <ViewerRail id={current} />}
      </main>
      <Palette />
      <StampPicker />
      <UserCard />
      <Toasts />
    </div>
  )
}
