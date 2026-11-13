import { traQMarkdownIt } from '@traptitech/traq-markdown-it'
import '@traptitech/traq-markdown-it/index.css'
// 数式 ($...$ / $$...$$) は markdown-it 側で KaTeX の HTML になるので、見た目とフォントだけ読み込む
import 'katex/dist/katex.css'
import { fileUrl, ORIGIN } from './api'
import { useStore } from './store'

const s = () => useStore.getState()

export const md = new traQMarkdownIt({
  getUser: id => s().users[id],
  getChannel: id => s().channels[id],
  getUserGroup: id => s().groups[id],
  getMe: () => s().me,
  getStampByName: name => s().stampsByName[name],
  getUserByName: name => s().usersByName[name],
  generateUserHref: id => '#user:' + id,
  generateUserGroupHref: id => '#group:' + id,
  generateChannelHref: id => '/channels/' + (s().paths[id] ?? ''),
  generateStampHref: fileUrl,
}, [], ORIGIN)

const cache = new Map<string, ReturnType<typeof md.render>>()
// ponytail: 無制限キャッシュ。長時間開きっぱなしでメモリが気になったら LRU に
export const render = (text: string) => {
  let r = cache.get(text)
  if (!r) cache.set(text, (r = md.render(text)))
  return r
}
