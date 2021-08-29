module.exports = {
  themeConfig: {
    navbar: [
      {
        text: 'LDD',
        children: [
          {text: 'Hello World', link: '/ldd/01-HelloWorld.md'}, 
          {text: '字符设备驱动', link: '/ldd/02-字符设备驱动.md'}, 
          {text: '调试技术', link: '/ldd/03-调试技术.md'},
        ],
      },
      {
        text: 'Network',
        children: [],
      },
      {
        text: 'Misc',
        children: [
          {text: '15分钟搭建个人博客', link: '/misc/15分钟搭建个人博客.md'}, 
        ],
      },
    ],
  },
  plugins: [
    [
      '@vuepress/plugin-search',
      {
        locales: {
          '/': {
            placeholder: 'Search',
          },
          '/zh/': {
            placeholder: '搜索',
          },
        },
      },
    ],
  ],
}