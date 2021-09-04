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
        text: 'Golang',
        children: [
          {
            text: '深入学习',
            children: [
              {
                text: '语言实现',
                link: '/golang/golang-source-code-introduction.md',
              },
              {
                text: '通道 chan',
                link: '/golang/golang-source-code-introduction.md',
              },
            ],
          }, 
          {
            text: '个人项目',
            children: [
              {
                text: '协程池 gopool',
                link: '/golang/golang-source-code-introduction.md',
              },
              {
                text: '延时任务 delay',
                link: '/golang/golang-source-code-introduction.md',
              },
            ],
          }, 
        ],
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