# Netpoll 实现简述

## 前言

netpoll是字节跳动开源的一款基于goland、面向rpc场景的高性能网络服务框架，源码与官方文档见: [github/cloudwego](https://github.com/cloudwego/netpoll)

由于官方已经提供了比较完备的使用文档，且设计文档也在同步整理中，故本文不再赘述```netpoll```的使用场景、基本用法、设计的理论知识等内容，仅直接从代码角度探讨netpoll的具体实现。

鉴于netpoll源码较多，本文进基于linux平台，就关键流程进行梳理，必要时会对源码进行一些删减或修改以方便阅读，故阅读时建议对照源码、自行斟酌。

本文参考netpoll版本为：[v0.0.4](https://github.com/cloudwego/netpoll/tree/v0.0.4)，该版本为书写本篇博客时的最新tag。

## 概述

netpoll 的源码实现大致可以划分为4个模块（不包括facade），由低级向高级分别是：

| module | desc |
| ------ | ---- |
| syscall | 系统调用相关 |
| poll& | 连接管理低级API |
| linkbuffer | 缓冲区管理相关 |
| connection | 连接管理高级API |

模块间大致的依赖关系如下:

![模块关系](/images/netpoll_1.jpg)

可以看到，netpoll的实现，从宏观角度来看，还是十分简洁的。

## 源码实现

### 目录结构

以下给出netpoll的目录结构（删除了bsd平台文件、竞态文件、测试文件、文档文件）：

```bash
$ tree -L 1
.
├── # facade
├── netpoll.go
├── netpoll_options.go
├── netpoll_server.go
├── 
├── # connection 连接管理高级API
├── connection.go
├── connection_errors.go
├── connection_errors_test.go
├── connection_impl.go
├── connection_lock.go
├── connection_onevent.go
├── connection_reactor.go
├── connection_test.go
├── 
├── # 链接管理低级API
├── net_dialer.go
├── net_listener.go
├── net_netfd.go
├── net_netfd_conn.go
├── net_polldesc.go
├── net_polldesc_test.go
├── net_sock.go
├── net_tcpsock.go
├── net_unixsock.go
├── fd_operator.go
├── fd_operator_cache.go
├── fd_operator_cache_test.go
├── poll.go
├── poll_default_linux.go
├── poll_loadbalance.go
├── poll_manager.go
├── 
├── # linkbuffer 缓存管理
├── nocopy.go
├── nocopy_linkbuffer.go
├── nocopy_readwriter.go
├── 
├── # syscall 系统调用
├── sys_epoll_linux.go
├── sys_epoll_linux_arm64.go
├── sys_exec.go
├── sys_keepalive_darwin.go
├── sys_keepalive_openbsd.go
├── sys_keepalive_unix.go
├── sys_sendmsg_linux.go
├── sys_sockopt_linux.go
└── sys_zerocopy_linux.go
```

后文将就上述模块划分，依次阐述各自的核心流程。

### 系统调用

这里指的系统调用并非宏观层面的syscall（这太多了，几乎所有go方法都依赖syscall），而是指netpoll进行网络交互的核心调用。

netpoll依赖的核心系统调用只有2个，非常简单，对应的glibc函数签名为：

```c

// 发送数据
ssize_t readv(int fd, const struct iovec *iov, int iovcnt);

// 接收数据
ssize_t sendmsg(int sockfd, const struct msghdr *msg, int flags);
```


具体实现在 *sys_exec.go* 与 *sys_send_msg_linux.go*:
```go
// sys_exec.go
func readv(fd int, bs [][]byte, ivs []syscall.Iovec) (n int, err error)

// sys_send_msg_linux
func sendmsg(fd int, bs [][]byte, ivs []syscall.Iovec, zerocopy bool) (n int, err error)
```

这两个调用虽然很简单，但这是netpoll最核心的两个系统调用，在cs完成连接建立后，netpoll的所有网络事件，都将由这两个调用驱动，形成一个IO闭环。

这个闭环我们可以在*poll_default_linux.go*里看到:

```go
// ...

func (p *defaultPoll) handler(events []epollevent) (closed bool) {
	for i := range events {
		var operator = *(**FDOperator)(unsafe.Pointer(&events[i].data))
		evt := events[i].events				
		switch {
		// ...
		case evt&syscall.EPOLLIN != 0: // epoll读事件
			// 获取读缓冲区
			var bs = operator.Inputs(p.barriers[i].bs)
			if len(bs) > 0 {
				var n, err = readv(operator.FD, bs, p.barriers[i].ivs) // syscall
				operator.InputAck(n)
				if err != nil && err != syscall.EAGAIN && err != syscall.EINTR { // 读失败，挂起
					hups = append(hups, operator)
					break
				}
			}
		case evt&syscall.EPOLLOUT != 0: // epoll写事件
			// 获取写缓冲区
			var bs, supportZeroCopy = operator.Outputs(p.barriers[i].bs)
			if len(bs) > 0 {
				var n, err = sendmsg(operator.FD, bs, p.barriers[i].ivs, supportZeroCopy) // syscall
				operator.OutputAck(n)
				if err != nil && err != syscall.EAGAIN { // 写失败，挂起
					hups = append(hups, operator)
					break
				}
			}
		}
	}
}

// ...
```

在*handler*方法里，其实已经告诉我们netpoll运作的基本原理，那就是 ***网络IO+缓冲管理*** ，套路和大多数网络驱动的实现驱动都是差不多的。

关于syscall的内容，源码还有很多细节可以深入挖掘，但作为一个宏观上的学习笔记，讲到这里就差不多了，下面我们学习另一个底层基础：缓冲管理。

### 缓存管理

### 低级连接管理

### 高级连接管理

## 总结
