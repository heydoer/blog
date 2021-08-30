module.exports = {
  themeConfig: {
    lastUpdatedText: '更新于',
    contributorsText: '作者',
    navbar: [
      {
        text: "Home",
        link: "/"
      },
      {
        text: 'LDD',
        children: [
          {text: 'Hello World', link: '/ldd/01-HelloWorld.md'}, 
        ],
      },
      {
        text: 'Network',
        children: [],
      },
      {
        text: 'Misc',
        children: [
          {text: '30分钟搭建个人博客', link: '/misc/how_to_build_a_blog.md'},
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