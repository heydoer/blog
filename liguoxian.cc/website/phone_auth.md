---
sidebarDepth: 3
---

# 手机验证码注册登陆实现

> 本文基于```python/flask```，实现一个通用的手机验证码注册、登陆功能，并提供相应的功能页面。

备注：文末附有完整代码

## 环境准备

|  依赖组件   | 版本（我的版本，仅供参考） |
|  -------  | ----  |
| **python**  | v3.8.2 | 
| **pip**  | v19.2.3 |
| **flask**  | v1.1.2 |
| **nginx**  | v1.14.2 |
| **git**  | v2.20.1 |

- 准备一个空工程
```shell
# 推荐使用 venv ，以方便环境隔离与项目部署。
export PROJ_PATH=$WEB_PATH/auth
mkdir -p $PROJ_PATH && cd $PROJ_PATH
python3 -m venv ./venv

# 指定flask v1.12，因为文档/社区比较成熟
./venv/bin/pip install Flask==1.1.2

```

- 准备```main.py```入口文件
```python
from flask import Flask

app = Flask(__name__)


@app.route('/')
def hello_world():
    return 'Hello, World!'

```

- flask run起来！
```shell
# 指定flask入口文件
export FLASK_APP=main.py

# 启动！
./venv/bin/flask run

# 输入如下日志，访问http://127.0.0.1:5000/ 输出"hello world"，说明flask工程已经准备完毕：
# 
# * Serving Flask app "main.py"
# * Environment: production
#   WARNING: This is a development server. Do not use it in a production deployment.
#   Use a production WSGI server instead.
# * Debug mode: off
# * Running on http://127.0.0.1:5000/ (Press CTRL+C to quit)
```


## 设计&实现

### 模块划分
可以将注册登陆流程简单划分为验证码验证与用户会话两个模块，如下：

![鉴权流程](/images/phone_auth_2.jpg)

本demo不关注业务逻辑层，所以我们仅实现手机验证码模块以及用户回话模块。

### 目录结构
在工程内构造如下目录结构:
```bash
$ tree -L 1
.
├── const.py 	# 常量定义
├── facade		# 定义session、phone_code模块上层API
├── main.py 	# 项目入口文件
├── model		# 数据模型
├── module		# 路由子模块
├── templates	# 页面模版
└── util		# 工具类
```

### 编码实现

#### facade

上文提到我们将编码拆分成短信验证、用户回话两个模块，为了对外统一API，我们先实现一个手机验证码登陆鉴权的门面类的单例。
```AuthFacade```类主要实现```post_phone_code/login```两个方法，分别提供推送短信验证码、验证登陆的功能。


*facade/phone_code_auth.py*
```python
# -*- coding: UTF-8 -*-
""" 手机验证码相关API.

门面类不提供具体实现方式
具体操作实现在验证码、回话的数据模型中
"""

from const import STATUS
from util import misc
from model.phone_code import PhoneCode
from model.user_session import UserSession


class AuthFacade:
    """ 鉴权操作对象 """

    def __init__(self):
        pass

    @staticmethod
    def post_phone_code(phone):
        """ 发送手机验证码 """
        if not misc.verify_phone_num(phone):
        	# 非法手机号，返回对应错误码
            return STATUS.PHONE_NUM_ILLEGAL

        # PhoneCode类需要提供post方法，并实现具体短信推送逻辑
        return PhoneCode(phone).post()

    @staticmethod
    def login(phone, code_num):
        """ 验证手机验证码 """
        if not PhoneCode(phone).verify(code_num):
        	# PhoneCode类需要实现verify方法，实现验证码校验逻辑
            return None

    	# 验证码验证通过，生成一个会话，验证会话登陆状态后，返回用于鉴权的token
        sess = UserSession(phone=phone)
        if not sess.is_login():
            return None
        return sess.get_token()

    @staticmethod
    def get_user_session(token):
        """ 根据token获取用户会话 """
        if not token:
            return None

        # UserSession类需要提供根据token生成会话的能力
        sess = UserSession(token=token)
        return sess if sess.is_login() else None


authImpl = AuthFacade()
```

#### 短信验证码

门面类依赖了```PhoneCode```类，该类负责手机验证码的数据和方法定义，由于其逻辑简单且内聚，我们暂时无需对其做数据/动作拆分。
```PhoneCode```类主要提供```post/verify```两个方法，分别对应验证码推送、验证。

*model/phone_code.py*
```python
# -*- coding: UTF-8 -*-
""" 手机验证码对象.
"""
import random
import time
import const
from util import misc
from collections import defaultdict

# 内存中的验证码缓存池，如果需要支持多点或持久化，可以使用redis/db
codes_pool = defaultdict(lambda: PhoneCode.InnerData())


class PhoneCode:
    """ 手机验证码 """

    class InnerData:
    	""" 手机验证码的数据模型 """
        created_at = 0	# 验证码生成时间
        phone = ''
        code = ''

        def available(self):
            # 验证码是否在有效期内
            return bool(self.phone) \
                   and time.time() < self.created_at + const.PhoneCode.verify_ttl

        def can_post(self):
            # 是否可以重新推送该手机验证码
            return not self.code or \
                   time.time() > self.created_at + const.PhoneCode.retry_ttl

    __data = None

    def __init__(self, phone):
        if not misc.verify_phone_num(phone):
            return

        self.__data = codes_pool[phone]

        if not self.__data.phone:
        	# 该手机不存在验证码，则插入一条空白验证码记录
            self.__data.phone = phone
            codes_pool[phone] = self.__data

    def post(self):
        """ 推送验证码 """
        if not self.__data.can_post():
            return const.STATUS.PHONE_CODE_POST_TOO_FREQUENTLY

        # 生成验证码，并刷新缓存
        self.__data.code = self.__gen_code()
        self.__data.created_at = int(time.time())
        codes_pool[self.__data.phone] = self.__data

        return misc.post_phone_code(self.__data.phone, self.__data.code)

    def verify(self, code):
        """ 验证码校验 """
        if not (self.__data.available()
                and self.__data.code
                and self.__data.code == code):
            return False
        # 验证通过后需要清楚缓存信息，避免多次验证
        del codes_pool[self.__data.phone]
        return True

    @staticmethod
    def __gen_code():
        """ 生成6位手机验证码 """
        # 方便测试，直接返回字面常量
        # return str(random.Random().randint(100000, 999999))
        return '000000'

```

#### 用户会话

用户会话对象主要负责管理用户的登录状态，我们使用jwt-token实现无差别（指诸如短信验证、账号密码等不同的登陆类型，最终生成无差别的token）的鉴权机制。
对于会话类，我们需要实现根据token或者手机号获取会话的能力。

与短信验证模块不同的是，用户会话往往或多或少依赖用户数据，而用户数据模型通常是一个应用的核心模型，所以我们需要将会话和用户模型区分开来，如下：

*model/user.py*
```python
# -*- coding: UTF-8 -*-
""" 用户对象.
"""


class User:
    """ 用户模型 """
    uid = 0
    phone = ''

    def __init__(self, uid=0, phone=''):
        self.__mock_fill_from_db(uid, phone)

    def exist(self):
        return bool(self.uid)

    # 创建一个用户
    def create(self):
        self.__mock_insert_into_db()

    def __mock_fill_from_db(self, uid=0, phone=''):
        # TODO 从数据库/缓存中读取用户数据
        self.uid = 1
        self.phone = '15600000000'

    def __mock_insert_into_db(self):
        # TODO 插入一条数据到db/缓存
        self.uid = 1
        self.phone = '15600000000'

```

*model/user_session.py*
```python
# -*- coding: UTF-8 -*-
""" 用户会话相关API.
"""

import time
import jwt
from model.user import User
from util import misc
from const import JWT


class UserSession:
    """ 用户会话 """
    user = None
    expired_at = 0

    # 新建一个用户会话
    def __init__(self, token=None, phone=None):
        if token:
            self.__init_by_token(token)
        elif phone:
            self.__init_by_phone(phone)

        if not self.user or not self.user.exist():
            self.user = None

    # 当前会话是否可用
    def is_login(self):
        return bool(self.user) \
               and not self.__is_expired()

    # 获取会话token
    def get_token(self):
        """ 返回token """
        if not self.is_login():
            return None
        return jwt.encode({
            'uid': self.user.uid,
            'expired_at': self.expired_at,
        }, key=JWT.key, algorithm=JWT.algorithm)

    # 会话是否过期
    def __is_expired(self):
        return time.time() >= self.expired_at

    def __init_by_phone(self, phone):
        self.expired_at = int(time.time()) + JWT.TTL
        phone = misc.encrypt_phone(phone)
        self.user = User(phone=phone)
        if not self.user.exist():  # 如果手机号不存在，则注册一个
            self.user.create()

    def __init_by_token(self, token):
        try:
            jwt_data = jwt.decode(token, JWT.key, algorithms=[JWT.algorithm])
        except jwt.exceptions.InvalidSignatureError:
            return

        if 'uid' not in jwt_data or 'expired_at' not in jwt_data:
            return

        self.user = User(uid=jwt_data['uid'])
        self.expired_at = int(jwt_data['expired_at'])

```

至此，短信验证码注册&登陆的核心逻辑已经实现完毕。

#### controller

接下来我们将上述提供的核心接口整合起来，提供如下控制器实现:

*module/auth*
```python
# -*- coding: UTF-8 -*-
""" 鉴权相关
"""

from flask import Blueprint
from flask import request
from const import STATUS
from facade.phone_code_auth import authImpl


app = Blueprint('auth', __name__)


# 请求手机验证码 JSON API
# req: {'phone': str}
@app.route('/phone_code', methods=['GET'])
def get_phone_code():
    req = request.get_json()

    if not req or 'phone' not in req or not req['phone']:
        return STATUS.PARAM_ERR.to_json()

    status = authImpl.post_phone_code(req['phone'])
    return status.to_json()


# 登陆/提交手机验证码 JSON API
# req: {'phone': str, 'code', str}
# resp: {'token': str}
@app.route('/phone_code', methods=['POST'])
def post_phone_code():
    req = request.get_json()

    if 'phone' not in req or not req['phone'] \
            or 'code' not in req or not req['code']:
        return STATUS.ERR.to_json()

    token = authImpl.login(req['phone'], req['code'])

    if not token:
        return STATUS.AUTH_FAIL.to_json()

    return STATUS.SUC.to_json(with_json={'token': token})

```

## 总结

本文提供了基于flask框架的短信验证码登陆的实现模版，本实现仅提供一种简易的实现思路，没有依赖过多三方组建，因此你可以很轻松去改造、迭代。

但本文实现仍有许多细节存在明显漏洞，比如：

- 没有过多考虑并发请求造成的一些逻辑漏洞；
- 没有实现分布式多点支持；
- 没有实现持久化、验证码缓存重启失效；
- 没有实现user模型实现，不提供一站式解决方案；
- ...

因此，如果是企业级、分布式、高QPS应用，不要使用它，网上有很多更好的解决方案。

但，如果只是个人站、或者对登陆操作QPS要求不高，仅为种token，使用这种方案作为一个单点登录的跳板，是非常合适的。


备注：本文档相关代码可以从 [github/heydoer](https://github.com/heydoer/flask_auth_demo) 获取。















