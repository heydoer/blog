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
| linkbuffer | 缓冲区管理相关 |
| poll&netFD | 连接管理低级API |
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
// netpoll/sys_exec.go
func readv(fd int, bs [][]byte, ivs []syscall.Iovec) (n int, err error)

// netpoll/sys_send_msg_linux.go
func sendmsg(fd int, bs [][]byte, ivs []syscall.Iovec, zerocopy bool) (n int, err error)
```

这两个调用虽然很简单，但这是netpoll最核心的两个系统调用，在cs完成连接建立后，netpoll的所有网络事件，都将由这两个调用驱动，形成一个IO闭环。

这个闭环我们可以在*netpoll/poll_default_linux.go*里看到:

```go
// netpoll/poll_default_linux.go

// ...

func (p *defaultPoll) handler(events []epollevent) (closed bool) {
	for i := range events { // 遍历epoll网络事件
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

### 缓冲区管理

#### 缓冲区概述
缓冲区是网络IO中，对于性能影响最大的模块之一，netpoll采用了*link_buffer*模型，依托golang的slice底层实现原理，实现了一个用户层的 *"zero copy"* 的缓冲（注意，这里的zero copy带双引号，作用域仅局限于用户层，与系统调用的zero copy概念没有关系，且，也并非所有用户态场景都实现了零拷贝）。

大多数link buffer的实现思路都是以链表形式管理多个小缓存，从而实现时间与空间能效的平衡，netpoll/link_buffer 基本设计思想也是一样的。

备注：无特殊说明，下文出现的 *link buffer* 指的是 *netpoll/link_buffer*。

首先给出*link_buffer*的结构图例：

![linkbuffer结构](/images/netpoll_2.jpeg)

上图给出了*linkbuffer*的核心结构，按照职责将其分为三个层次：

| module | responsibility |
| ------ | -------------- |
| linkbuffer | facade API |
| linkBufferNode | 管理缓冲的单元 |
| buffer pool | 管理分配的slice |

#### 核心实现

带着上述理解，代码就很简单了：

- ***linkbuffer***

```go
// netpoll/nocopy_linkbuffer.go

// LinkBuffer 实现了各种读写API的Facede类
type LinkBuffer struct {
	length     int32	// 当前可读数据大小
	mallocSize int 		// 总分配空间大小

	head  *linkBufferNode // 指向头节点，释放空间时候从head释放到read
	read  *linkBufferNode // 指向下一个待读入数据的节点（即此前的节点已经完全读取完毕）
	flush *linkBufferNode // 指向最后一个可读数据的节点（即该该节点永远不会在read之前）
	write *linkBufferNode // 指向下一个可写入数据的节点（flush和write之间的节点为已写入但不开放读）

	// 有一些场景需要额外开辟slice用于内存拷贝，
	// 这些新开辟的slice会暂时referred到这里，调用Realease方法时统一释放
	// 我不太清楚这么设计的初衷，猜测是为了降低GC负荷
	caches [][]byte 
}
```

- ***linkbuffernode***

```go
// netpoll/nocopy_linkbuffer.go

type linkBufferNode struct {
	buf      []byte          // 实际存储数据的slice，当该节点refer另一个节点时候，不需要分配空间
	off      int             // 已读offset，下一个读入数据的下标
	malloc   int             // 已写offset，下一个写入数据的下标

	// refer功能主要出现在需要“拷贝”一个node的场景
	refer    int32           // 引用计数，只有该节点不被其他节点refer时候才能释放
	readonly bool            // 节点是否只读，当该节点refer另一个节点时候，该值为true
	origin   *linkBufferNode // 当该节点refer另一个节点时候，指向其引用的节点

	next     *linkBufferNode // 指向下一个node节点的指针
}
```

- ***buffer pool***

*buffer pool* 使用的字节的开源工具包中的内存缓存 [github.com/bytedance/gopkg](https://github.com/bytedance/gopkg/tree/develop/lang/mcache)，其底层依托的是 *sync.pool*，实现很简单有兴趣可以直接去读源码。

下面给出netpoll里面的使用姿势：
```go
// netpoll/nocopy_linkbuffer.go

// mallocMax is 8MB
const mallocMax = block8k * block1k

// malloc limits the cap of the buffer from mcache.
func malloc(size, capacity int) []byte {
	// 大块缓存不走mcache，需要尽快归还操作系统
	if capacity > mallocMax {
		return make([]byte, size, capacity)
	}
	return mcache.Malloc(size, capacity)
}

// free limits the cap of the buffer from mcache.
func free(buf []byte) {
	// 大块缓存由外层代码解除引用，跟着GC返还系统
	if cap(buf) > mallocMax {
		return
	}
	mcache.Free(buf)
}

```

#### 总结

至此，我们应该可以很清晰脑补出*linkbuffer*读写时候底层所进行数据操作了。

仍然，netpoll的 *linkbuffer* 做了许多细节调优，比如使用大量对象缓存、slice精细化管理等，正是这些细节调优，使得*linkbuffer*具备更高的性能。


### 低级连接管理

### 高级连接管理

## 总结
