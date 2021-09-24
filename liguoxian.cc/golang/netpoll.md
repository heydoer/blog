---
sidebarDepth: 3
---

# Netpoll 实现简述

## 前言

netpoll是字节跳动开源的一款基于goland、面向rpc场景的高性能网络服务框架，源码与官方文档见: [github/cloudwego](https://github.com/cloudwego/netpoll)

由于官方已经提供了比较完备的使用文档，且设计文档也在同步整理中，故本文不再赘述```netpoll```的使用场景、基本用法、设计的理论知识等内容，仅直接从代码角度探讨netpoll的具体实现。

鉴于netpoll源码较多，本文进基于linux平台，就关键流程进行梳理，必要时会对源码进行一些删减或修改以方便阅读，故阅读时建议对照源码、自行斟酌。

本文参考netpoll版本为：[v0.0.4](https://github.com/cloudwego/netpoll/tree/v0.0.4)，该版本为书写本篇博客时的最新tag。

## 概述

netpoll 的源码实现大致可以划分为4个模块，由低级向高级分别是：

| module | desc |
| ------ | ---- |
| syscall | 系统调用相关 |
| linkbuffer | 缓冲区管理相关 |
| poll&connection | 连接管理相关 |
| netpoll | facade API |

模块间大致的依赖关系如下:

![模块关系](/images/netpoll_1.jpeg)

可以看到，netpoll的实现，从宏观角度来看，还是十分简洁的。

## 源码实现

### 目录结构

以下给出netpoll的目录结构（删除了bsd平台文件、竞态文件、测试文件、文档文件）：

```bash
$ tree -L 1
.
├── # facade API
├── netpoll.go
├── netpoll_options.go
├── netpoll_server.go
├── 
├── # poll/connection 连接管理API
├── connection.go
├── connection_errors.go
├── connection_impl.go
├── connection_lock.go
├── connection_onevent.go
├── connection_reactor.go
├── net_dialer.go
├── net_listener.go
├── net_netfd.go
├── net_netfd_conn.go
├── net_polldesc.go
├── net_sock.go
├── net_tcpsock.go
├── net_unixsock.go
├── fd_operator.go
├── fd_operator_cache.go
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
├── # IO syscall 系统调用
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

#### resdv/sendmsg
这里指的系统调用并非宏观层面的syscall（这太多了，几乎所有go方法都依赖syscall），而是指netpoll进行网络交互的核心IO调用。

netpoll依赖的核心IO系统调用只有2个，非常简单，对应的glibc函数签名为：

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

#### netpoll应用
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

#### 总结
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

#### netpoll应用

netpoll对于*link_buffer*的依赖仅限于网络IO，即***系统调用***一小节中描述的这两个IO调用，但由于上层调用比较零散，将这一块完全串联起来需要到下一个模块的讲解。

我们仅需要有这个概念：
- 当服务需要读入数据，需要在该连接上通过*link_buffer*开辟一个空间来存储读入数据；
- 当服务需要写出数据，需要在该连接上通过*link_buffer*开辟一个空间来存储写出数据；
- 因此，针对每个连接，都需要维护2个*link_buffer*，一个用来读入数据、一个用来写出数据；

#### 总结

至此，我们应该可以很清晰脑补出*linkbuffer*读写时候底层所进行数据操作了。

仍然，netpoll的 *linkbuffer* 做了许多细节调优，比如使用大量对象缓存、slice精细化管理等，正是这些细节调优，使得*linkbuffer*具备更高的性能。


### 连接管理

> 本模块仅描述 Server 端的连接管理，Dialer 端的连接管理是 Server 端子集，后文不再赘述。

#### 概述

连接管理是netpoll中偏上层的模块，因此，不可避免会涉及到诸多底层概念（主要是epoll、syscall、link_buffer），其中*syscall/link_buffer*在上述两个模块已经整理，请确保已掌握*epoll*相关基础。

依旧先直接给出连接管理的大致结构图例（黑色表示实例、红色表示读方法调用、蓝色表示写方法调用）：

![linkbuffer结构](/images/netpoll_3.jpg)

原谅我拙劣的画工和表述能力，图中传递了如下几个概念，同时也是连接管理模块最核心的功能：

- 每个CS连接以*connection*实例作为管理，*connection*主要维护了socketFD和读写缓冲区，可以把*connection*理解成一个自带缓冲FD；
- netpoll 维护了一个*poll pool*，池中每个*poll*都管理着多个*connection*，实际上*poll*是一个封装好的epoll对象；
- 当 Server 需要读入数据时，需要阻塞至读缓冲存在足量数据，然后直接从缓冲区读出、无需主动调用*syscall_read*;
- 当 Server 需要写入数据时，先尝试直接调用*syscall_sendmsg*，失败则注册epoll写事件异步发送，但写接口会阻塞至epoll写返回；

连接管理几乎所有的功能点，都是围绕上述几个核心概念展开，后续将梳理主要流程。

⚠️：后续内容实现细节较多，本文会对代码做适当删减，以方便聚焦核心功能，请参考上述4点核心功能辅助理解。

#### connection

直接看*connection*对象结构定义：

```go
// netpoll/connection_impl.go

// connection 可以看作是一个自带缓冲、且内聚了对自身操作的一个FD对象
type connection struct {

	// socket FD
	fd 			

	// 关联poll，提供针对fd的操作，如 epoll_ctl 等					
	operator        *FDOperator 	

	// 当 poll 向FD读入数据时，通知上层“read(n)”接口判断接收数据长度，
	// 如果满足要求则返回，否则继续阻塞，
	readTrigger     chan struct{}   

	// 当前连接期待读取数据长度
	waitReadSize    int32	

	// 写事件返回，参考本节概述列出的核心功能		
	writeTrigger    chan error 	

	// 读缓冲	
	inputBuffer     *LinkBuffer 

	// 写缓冲	
	outputBuffer    *LinkBuffer 	

	// 这两个结构分别对应在进行 IO 操作时候直接操作的缓冲区
	// 实际上，这两个结构的缓冲区来自对应的 linkBuffer，复用了内存空间
	// 将这两个结构单独抽出来，是为了解耦底层缓冲组件，方便上层操作
	inputBarrier    *barrier 		
	outputBarrier   *barrier
}
```

正如上面描述所说，*connection* 内聚了缓冲管理和FD操作，缓冲管理上文我们介绍过了，而对FD的操作，实际上是在 *FDOperator* 中实现的：

```go
// netpoll/fd_operator.go

// FDOperator 集合了对FD的操作.
type FDOperator struct {
	// 和 connection.fd 是同一个，
	// 通常在初始化一个connection之后，就会将这个fd注册到poll上面监听
	FD int

	// 当FD可读的时候，需要依赖这个函数获取读缓冲（向inputBuffer申请开辟一个缓冲）
	Inputs   func(vs [][]byte) (rs [][]byte)
	// 当完成对Inputs申请的读缓冲的写入操作时，确认写入
	// （可以理解成对linkbuffer进行一次flush(n)操作，其中n是读缓冲真实写入的字节数）
	InputAck func(n int) (err error)

	// 类似Inputs/InputAck，调用场景在FD可写时候。
	Outputs   func(vs [][]byte) (rs [][]byte, supportZeroCopy bool)
	OutputAck func(n int) (err error)

	// 下一小节会介绍poll结构，可以抽象理解成一个epoll对象
	poll Poll
}

// Control 该方法等同于 epoll_ctl
func (op *FDOperator) Control(event PollEvent) error {
	return op.poll.Control(op, event)
}
```

Inputs/InputAck、Outputs/OutputAck 实现如下，请结合 linkbuffer 理解：

```go
// netpoll/connection_reactor.go

// inputs connection/FD可读，所以需要开辟读缓冲中的write空间
func (c *connection) inputs(vs [][]byte) (rs [][]byte) {
	// 当前需要读入的字节数
	n := int(atomic.LoadInt32(&c.waitReadSize))

	// c.inputBuffer.Len() 返回的是inputBuffer.length，即当前可读数据大小
	// 等待读-可读=仍需要开辟的缓冲大小
	n -= c.inputBuffer.Len()
	if n < pagesize {
		n = pagesize
	}

	// 开辟write缓冲区，
	// Book具体实现可以结合源码与本博客理解
	return c.inputBuffer.Book(n, vs)
}

// inputAck connection/FD已读，读缓冲区写入完毕，确认写入数据（让该缓冲数据可读）
func (c *connection) inputAck(n int) (err error) {
	if n < 0 {
		n = 0
	}

	leftover := atomic.AddInt32(&c.waitReadSize, int32(-n))

	// 类似 linkBuffer.flush(n)
	err = c.inputBuffer.BookAck(n, leftover <= 0)

	// 触发读事件，如果有上层接口调用了 connection.Read(n), 则阻塞将被返回，以便重新校验是否可读出需要大小的数据
	c.triggerRead()

	// Server端注册的回调函数
	c.onRequest()

	return err
}

// outputs connection/FD可写的时候，需要将写缓冲中未读内容返回
func (c *connection) outputs(vs [][]byte) (rs [][]byte, supportZeroCopy bool) {
	if !c.lock(writing) {
		return rs, c.supportZeroCopy
	}
	if c.outputBuffer.IsEmpty() { 
		// 没有数据可写到fd，返回，先等待写缓冲中有数据可读
		c.unlock(writing)
		// 将poll中的事件监听由读写转换成读，因为暂时没有内容可写
		c.rw2r()
		return rs, c.supportZeroCopy
	}

	// 将写缓冲区中所有未读数据返回
	rs = c.outputBuffer.GetBytes(vs)
	return rs, c.supportZeroCopy
}

// outputAck 在output返回可写的数据，并成功sendmsg后，需要确认写缓冲中的数据为已读，避免重复读
func (c *connection) outputAck(n int) (err error) {
	if n > 0 {
		// 设置n字节的数据为已读，并且释放掉已读数据空间
		c.outputBuffer.Skip(n)
		c.outputBuffer.Release()
	}

	// must unlock before check empty
	c.unlock(writing)

	if c.outputBuffer.IsEmpty() {
		// 将poll中的事件监听由读写转换成读，因为暂时没有内容可写
		c.rw2r()
	}
	return nil
}
```

*connection*还有各种Reader/Writer API，这里就不铺开描述了，大多是基于缓冲区与FD相关的操作，有了上述基础，可以自行阅读源码。

#### poll

先看*poll*结构定义：

```go
// netpoll/poll_default_linux.go

// defaultPoll 带有回调函数的epoll对象
type defaultPoll struct {
	// epoll fd，每个poll都可以看作是一个epoll对象，可以管理很多FD(connection)
	fd      int         

	// 事件触发时的回调方法，***系统调用*** 一章中的 syscall 调用场景，就是这个回调里的内容
	Handler func(events []epollevent) (closed bool)
}

```

然后顺带提一下*poll_manage*，这个对象管理了很多*poll*，每当有一个*connection*被建立，就会按照一定的均衡策略分配到一个*poll*中，相关代码在*netpoll/poll_manage.go*，比较简单这里就不描述了.

#### 总结

结合*poll*、*connection*，这里给出一个 Server 处理事件的流程图：

![linkbuffer结构](/images/netpoll_4.jpeg)

该流程图省略了大量细节，但已经足够表示netpoll Server端的核心工作机制，关于Client端本文表述很少，但是一旦理解Server，自然也就明白了Client了。

## 总结

其实 ***netpoll*** 并没有太多创新之处，更多是对各种技术站做了有机结合&调优。其主要依赖了：
- epoll 实现的IO多路复用；
- goroutine提供的超轻量级协程提高worker并发；
- golang slice与sync.pool实现的内存&资源复用；
- 系统调用调优，golang RawSysCall、NonBlock、ZeroCopy；
- 其他；

原理都是相通的，但细节是魔鬼，*netpoll*为业务屏蔽了大量的底层细节，使得在保持高性能同时，提供了简练易用且不失优雅的业务API。

但是明显的槽点还是有的，就个人主观视角来看，编码上有点臃肿，可能是为了保留足够拓展性、或者是历史问题，许多链路的调用轨迹都有点匪夷所思，导致代码阅读起来不尽舒适。

我个人对这份代码只能算是泛读，就不再进行更深入的讨论了。
