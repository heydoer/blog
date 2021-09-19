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
        text: 'Golang',
        children: [
          {
            text: '深入学习',
            children: [
              {
                text: '通道',
                link: '/golang/chan.md',
              },
              {
                text: '协程',
                link: '/golang/goroutine.md',
              },
            ],
          }, 
          {
            text: '个人项目',
            children: [
              {
                text: '协程池 gopool',
                link: '/golang/gopool.md',
              },
              {
                text: '延时任务 delay',
                link: '/golang/delay_job.md',
              },
            ],
          }, 
        ],
      },
      {
        text: 'Website',
        children: [
          {text: '30分钟搭建个人博客', link: '/Website/how_to_build_a_blog.md'},
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