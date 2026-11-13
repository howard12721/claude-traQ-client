/**
 * デスクトップ版 (Electron) で、トラックパッドの2本指の横スワイプで戻る/進む。
 * ブラウザでは Chrome/Safari が同じことを自前でやるので何もしない。
 * 右へスワイプ (deltaX < 0) で戻る、左へで進む。端から矢印が引き出され、しきい値を越えた瞬間に移動する
 * (指を離して慣性スクロールが止まるのを待つと 1 秒近く遅れて重く感じるため)。
 */
const THRESHOLD = 110 // px 相当の横移動量
const END_GAP = 120   // この間 wheel が来なければ指を離したとみなして矢印をしまう
const COOLDOWN = 700  // 発火後の慣性スクロールを無視する時間

type Nav = { canGoBack?: boolean; canGoForward?: boolean }
const nav = () => (window as unknown as { navigation?: Nav }).navigation

/** 横スクロールできる箱 (コードブロック・長い数式・表など) の上か。端まで来ていても箱の上なら戻る/進むはしない */
function overHorizontalScroller(target: EventTarget | null) {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    const ox = getComputedStyle(el).overflowX
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return true
  }
  return false
}

export function enableSwipeNavigation() {
  if (!navigator.userAgent.includes('Electron')) return
  const arrow = document.createElement('div')
  arrow.className = 'swipe-nav'
  arrow.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>'
  document.body.append(arrow)

  let acc = 0, ended: ReturnType<typeof setTimeout> | undefined, quietUntil = 0

  const paint = () => {
    const back = acc < 0
    const allowed = back ? nav()?.canGoBack ?? true : nav()?.canGoForward ?? true
    const p = Math.min(1, Math.abs(acc) / THRESHOLD)
    arrow.dataset.side = back ? 'left' : 'right'
    arrow.classList.toggle('ready', p >= 1 && allowed)
    arrow.classList.toggle('blocked', !allowed)
    arrow.style.setProperty('--p', String(acc === 0 ? 0 : p))
  }
  const reset = () => { acc = 0; paint() }
  const go = () => {
    const back = acc < 0
    // 戻れない/進めないときは移動せず、指を離したら矢印をしまう
    if (!(back ? nav()?.canGoBack ?? true : nav()?.canGoForward ?? true)) { clearTimeout(ended); ended = setTimeout(reset, END_GAP); return }
    if (back) history.back(); else history.forward()
    quietUntil = Date.now() + COOLDOWN
    // 矢印は確定の色を一瞬見せてから引っ込める
    clearTimeout(ended)
    ended = setTimeout(reset, 160)
  }

  addEventListener('wheel', e => {
    if (Date.now() < quietUntil || e.ctrlKey) return // ピンチ (ctrlKey) も無視
    // 横向きが十分に強いときだけ。縦スクロール中の揺れは拾わない
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) {
      if (acc !== 0 && Math.abs(e.deltaY) > 4) { acc = 0; paint() }
      return
    }
    if (overHorizontalScroller(e.target)) { if (acc !== 0) { acc = 0; paint() } return }
    acc = Math.max(-THRESHOLD, Math.min(THRESHOLD, acc + e.deltaX))
    paint()
    if (Math.abs(acc) >= THRESHOLD) return go()
    clearTimeout(ended)
    ended = setTimeout(reset, END_GAP)
  }, { passive: true })

  // ついでにマウスの戻る/進むボタンと ⌘[ / ⌘]
  addEventListener('mouseup', e => {
    if (e.button === 3) { e.preventDefault(); history.back() }
    if (e.button === 4) { e.preventDefault(); history.forward() }
  })
  addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
    if (e.key === '[') { e.preventDefault(); history.back() }
    if (e.key === ']') { e.preventDefault(); history.forward() }
  })
}
