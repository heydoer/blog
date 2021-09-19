# 30分钟搭建个人博客

下文简述一种十分适合懒人搭建个人静态SPA博客的方式（基于vuepress），所有配置与编码均基于本站真实配置，请注意根据实际情况区分替换。

## 环境准备
以本站为例，服务端环境依赖如下（其他系统使用对应包管理工具安装组件最新版即可）：
|  组件   | 版本  | 安装方式 |
|  -------  | ----  | --------- |
| **Debian**  | 4.19.132-1 x86_64 GNU/Linux | 阿里云轻量级服务器提供的debian系统镜像|
| **nodejs**  | v14.17.5 | [Debian推荐安装方式](https://joshtronic.com/2020/04/21/how-to-install-nodejs-14-on-debian-sid/) |
| **yarn v1**  | v1.22.11 | ```sudo npm install -g yarn``` |
| **nginx**  | v1.14.2 | ```sudo apt get nginx``` |
| **git**  | v2.20.1 | ```sudo apt get git``` |

## 本地构建
- 初始化目录结构
```shell
mkdir ~/www && cd ~/www
git init && yarn init
yarn add -D vuepress@next

echo 'node_modules' >> .gitignore
echo '.temp' >> .gitignore
echo '.cache' >> .gitignore
echo 'dist' >> .gitignore
```

- 在*package.json*中新增如下命令
```json
{
  "scripts": {
    "dev": "vuepress dev liguoxian.cc",
    "build": "vuepress build liguoxian.cc"
  }
}
```

- 为了方便后文服务器编译部署，在根目录编写如下编译脚本 *publish.sh*：
```shell
vim ~/www/publish.sh
```
```shell
#!/bin/sh
yarn --network-timeout 100000 install
yarn build
```

- 编辑第一篇博客 *~/www/liguoxian.cc/第一篇博客.md*
```shell
mkdir ~/www/liguoxian.cc 
vim ~/www/liguoxian.cc/第一篇博客.md
```
```markdown
# 第一篇博客
Hello World
```

- 启动本地服务器
```shell
# 启动本地服务器，通过 http://localhost:8080 访问
# 可以监听文件改动实时渲染
yarn docs:dev
```

至此，本地构建博客所需要的流程已经全部准备完毕，对于 *vuepress* 的详细用法，可以在本文结尾链接处深入了解。

## 服务器构建
接下来构建一个集HTTP服务、git代码仓库、编译平台于一体的服务器。仅针对本文的场景而言，这其实很简单，结构如下：

![服务器组件结构](/images/1.jpg)

具体配置如下：
- GIT仓库与CI
```shell
# 新增git和www用户
sudo adduser www
sudo adduser git
sudo usermod -a -G www git

# 初始化远端代码仓库
git init --bare /home/git/www.git
# 此目录用作博客目录的编译空间
mkdir -p /home/git/repos
# 钩子配置
touch /home/git/www.git/hooks/post-update
# 把本地机器公钥添加到 /home/git/.ssh/authorized_keys 文件，方便访问
echo "你的本地ssh公钥" >> /home/git/.ssh/authorized_keys
```

- */home/git/www.git/hooks/post-update* 配置如下:
```shell
#!/bin/sh

REPOS_NAME="www"
SITE="liguoxian.cc"
CODE_DIR="/home/git/repos/$REPOS_NAME"
REPOS_DIR="/home/git/$REPOS_NAME.git"
DIST_DIR="/home/www/$SITE"

# 设置仓库工作路径，否则vuepress将不能正确获取作者、修改时间等提交信息
export GIT_DIR="$CODE_DIR/.git"
export GIT_WORK_TREE="$CODE_DIR"

# 同步仓库内容
if [ ! -d $CODE_DIR ]
then
  mkdir -p $CODE_DIR
  git clone $REPOS_DIR $CODE_DIR
else
  git --git-dir="$CODE_DIR/.git" --work-tree="$CODE_DIR" fetch origin master
  git --git-dir="$CODE_DIR/.git" --work-tree="$CODE_DIR" reset --hard origin/master
fi

# 编译并将dist目录拷贝到Nginx根目录
cd $CODE_DIR && sh $CODE_DIR/publish.sh
rm -rf $DIST_DIR && cp -R $CODE_DIR/$SITE/.vuepress/dist $DIST_DIR
```
- NGINX配置
```nginx
server {
        listen 80 default_server;
        listen [::]:80 default_server;

        root /home/www/www/liguoxian.cc;

        index index.html index.htm index.nginx-debian.html;

        server_name liguoxian.cc;

        location / {
                try_files $uri $uri/ index.html;
        }
}
```

## 发布文章
接下来从服务器回到本地写作环境中，将博客推送到服务端即可完成发布:
```shell
cd ~/www
# 绑定远端仓库
git remote add origin git@your_remote_ip:/home/git/www.git
# 同步本地文章
git add . && git commit -m "publish" --allow-empty && git push -f origin
```
一切正常，你将看到如下类似输出:
```shell
yarn run v1.22.11
$ git add . && git commit -m "publish" --allow-empty && git push -f origin
[master da6e964] publish
 2 files changed, 17 insertions(+), 11 deletions(-)
Enumerating objects: 22, done.
Counting objects: 100% (22/22), done.
Delta compression using up to 12 threads
Compressing objects: 100% (14/14), done.
Writing objects: 100% (15/15), 2.83 KiB | 1.42 MiB/s, done.
Total 15 (delta 9), reused 0 (delta 0)
remote: From /home/git/www
remote:  * branch            master     -> FETCH_HEAD
remote:    7140ad8..da6e964  master     -> origin/master
remote: HEAD is now at da6e964 publish
remote: yarn install v1.22.11
remote: [1/4] Resolving packages...
remote: success Already up-to-date.
remote: Done in 0.32s.
remote: yarn run v1.22.11
remote: $ vuepress build liguoxian.cc
remote: info Initializing VuePress and preparing data...
remote: - Compiling with webpack
remote: ✔ Compiling with webpack - done
remote: - Rendering pages
remote: - Rendering pages /
remote: - Rendering pages /%E7%AC%AC%E4%B8%80%E7%AF%87%E5%8D%9A%E5%AE%A2.html
remote: - Rendering pages /ldd/01-HelloWorld.html
remote: - Rendering pages /ldd/02-%E5%AD%97%E7%AC%A6%E8%AE%BE%E5%A4%87%E9%A9%B1%E5%8A%A8.html
remote: - Rendering pages /ldd/03-%E8%B0%83%E8%AF%95%E6%8A%80%E6%9C%AF.html
remote: - Rendering pages /misc/15%E5%88%86%E9%92%9F%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%8D%9A%E5%AE%A2.html
remote: - Rendering pages /404.html
remote: ✔ Rendering pages - done
remote: success VuePress build successfully!
remote: Done in 10.61s.
To liguoxian.cc:/home/git/www
   7140ad8..da6e964  master -> master
✨  Done in 12.17s.
```
至此，你的博客已经从本地成功部署至服务器。后续，你便可以在本地编辑 *markdown* 风格的博客文章，通过```git push```来提交至代码仓库，并进行发布。

## 总结
- 依托 *vuepress* 的模版构建能力，搭建了一个基于 .md 文件的静态博客站点、并实现本地实时预览功能； 
- 通过 *git* 钩子，我们做到了文章的提交-发布，实现持续交付；
- 通过简单的 *nginx* 配置，完成静态SPA博客的搭建；

## 参考
- [vuepress官方文档](https://v2.vuepress.vuejs.org/zh/guide/)







