import oocGrammar from '../packages/language/syntaxes/object-oriented-c.tmLanguage.json'
import type { LanguageRegistration } from 'shiki'
import { defineConfig } from '@rspress/core'

const oocLanguage: LanguageRegistration = {
  ...(oocGrammar as unknown as LanguageRegistration),
  aliases: ['ooc'],
}

export default defineConfig({
  root: __dirname,
  route: {
    extensions: ['.md', '.mdx'],
  },
  base: '/ooc/',
  lang: 'zh-CN',
  description: 'OOC (Object Oriented C)，一门极简的消息传递语言',
  title: 'OOC',
  markdown: {
    shiki: {
      langs: ['tsx', 'ts', 'js', oocLanguage],
    },
  },
  themeConfig: {
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/wy2010344/ooc',
      },
    ],
  },
})
