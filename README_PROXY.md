快速使用说明

1) 在本地安装依赖：

```bash
cd "d:\宏大立库\AGV\接口测试程序"
npm install
```

2) 启动代理：

```bash
npm start
```

代理默认监听 `http://localhost:3000`，接口路径：`POST /proxy`。

请求体（JSON）：
{
  "url": "http://目标IP:PORT/rcms/services/rest/hikRpcService/agvChargeTask",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": "{...}"  // 字符串或对象
}

3) 在 `api-tester.html` 中勾选“使用本地代理”，页面会把请求发送到代理并由代理转发到目标服务器，从而避免浏览器 CORS 限制。

注意：代理将允许任意主机访问（Access-Control-Allow-Origin: *），仅建议在本地测试环境使用，不要在生产环境公开此代理。