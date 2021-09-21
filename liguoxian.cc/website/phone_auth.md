# 手机验证码注册登陆实现

> 本文基于```python/flask```，实现一个通用的手机验证码注册、登陆功能，并提供相应的功能页面。

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

## 设计

以下给出基础的手机验证码登陆设计，一个基础的手机短信登陆设计主要分为三个模块，分别是：

- 功能设计（如何推送&校验短信）
- 鉴权设计（token如何设计）
- 风控设计（如何防刷）

本文设计的登陆模块完整流程如下：

![注册&登陆流程](/images/phone_auth_1.jpeg)

## 编码实现

### 功能

本小节将实现手机短信推送&校验的功能。

### 鉴权

本小节实现jwt鉴权流程。

### 风控

本小节实现一些风控防刷机制。















