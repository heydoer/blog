# Plan9 汇编入门指南

## 背景
作为一款教科书式的os，如果不是*golang*，估计很多人都没听过p9（实际上大部分在用go的人也没听过），那是因为这个系统确实很冷门，以至于现在只沦落为极客们用来把玩探索的"玩具"，几乎没有太多使用价值了。

我们看下p9的 [wikipedia](https://en.wikipedia.org/wiki/Plan_9_from_Bell_Labs) ，发现这个东西实在是太屌了，出自UNIX之父 [Ken Thompson](https://en.wikipedia.org/wiki/Plan_9_from_Bell_Labs)  和一众贝尔实验室大神之手。这个项目有很多创新之举，比如彻底贯彻UNIX万物皆文件的理念，将几乎所有系统都被抽象为无差别的文件对象（这可远比vfs要彻底的多了），又比如首次使用了utf8（没错utf8也是这群人搞的），再比如设计了全新的汇编器等等……

作为几乎同一个时代的产物，p9为何输给了linux，网络上关于此有意思的争论很多（大多是引战贴），观点无外乎是糟糕的商业化、高高在上的学院风、彻底另起炉灶不切实际的野心等等。不管怎么说，p9作为一个os确实是彻头彻底的失败了，无论是作为企业还是个人，确实再没有太多深入学习这个东西的刚需了。

但有意思的是，随着*golang*在国内的兴起，p9的搜索量也跟着蹭蹭往上窜。

了解go历史的人都知道，golang很多设计理念源于p9，甚至连核心开发都是同一拨老逗比，最重要的是，golang这玩意儿根本就是在p9上开发的，和p9用的同一套汇编风格，更不得了的是，go在1.5之后已经完全摆脱了C，实现了自举。

这意味着你要彻底搞懂golang（从标准库到runtime再到asm），不需要学c了，学go和go-asm就好了，但又因为go-asm和plan9-asm用的一套风格，所以你不得不把plan9再挖出来鞭个尸……

万幸的是，只要你有其他平台的asm基础，p9的汇编其实比较好学，后文主要整理p9 asm的基础知识，搞定这个，golang的asm就不在话下了。

*tips：看p9和golang的吉祥物，就知道这俩货的关系不简单*

<img src="/images/plan9_3.png" alt="" style="" />

## 环境准备

> NOTE: 对于p9来说，VirtualBox不是一个很好的选择，因为vb每个发行版的表现可能都有一些差异，为了规避各种大小的坑，可能需要用户对vb进行一些复杂设置才能让p9保持良好的运行状态，其实更推荐使用诸如```kvm | VMMare | qemu | xen``` 这些虚拟机，他们与p9配合可以更加贴近实机。

本文仅为了学习p9的基础汇编知识，不涉及太多网络、硬件等底层交互，所以为了方便，使用*virtual box*就好了。

1. 安装[p9 iso](https://9p.io/plan9/download/plan9.iso.bz2), 你也可以选择其他主流发行版 [9front](http://9front.org/propaganda/) | [其他](https://9p.io/wiki/plan9/download/) ；
1. 安装[Virtual Box](https://www.virtualbox.org/wiki/Downloads) ，找到自己平台最新版本iso包，傻瓜式安装即可（本文使用v6.1.26）；
1. 创建一个虚拟机，本文参考配置为：*type of "Other/Unknown" ｜ 256 MB RAM ｜ 2 GB VDI* ；
1. 创建完毕后，进一步设置：存储》创建一个虚拟光盘》选择之前下载的iso；
1. 启动该虚拟机，选择安装到硬盘（如果选择直接从CD启动，后续还需要手动进行文件分区挂载等操作，比较麻烦），然后按照提示一路默认配置直到提示重启；
1. 启动系统，user选项选择*glenda*，其他默认配置即可；

> 更多安装信息参考 <https://9p.io/wiki/plan9/installation_instructions/>

启动完毕后，plan9看上去就是这个样子的，这样，我们就拥有了一个用于学习p9-asm的操作环境：

<img src="/images/p9_1.png" alt="plan9 roi" />

⚠️：RIO是p9的桌面管理系统，acme是其文件编辑器，二者和我们常见的操作方式都有很大区别，建议阅读以下文档，先摸索一阵子，以掌握必备基础操作知识：
- <https://9p.io/wiki/plan9/using_rio/index.html>
- <https://9p.io/wiki/plan9/Using_acme/index.html>

## hello world



## 汇编概述

## 指令集

## 范例

## 参考
- <https://9p.io/sys/doc/asm.html>
- <https://golang.org/doc/asm>
- <https://golang.design/under-the-hood/zh-cn/part1basic/ch01basic/asm/>
- <https://xargin.com/plan9-assembly/>
- <http://www.quanstro.net/newbie-guide.pdf>
- <https://www.zhihu.com/topic/19612343/hot>